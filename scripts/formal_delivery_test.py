#!/usr/bin/env python3
import json
import os
import re
import statistics
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin

import requests

BASE_URL = os.environ.get('WARNSYS_BASE_URL', 'http://127.0.0.1:3000').rstrip('/') + '/'
FRONT_BASE = os.environ.get('WARNSYS_FRONT_URL', 'https://www.xueyeyujing.asia').rstrip('/') + '/'
ACCOUNT = os.environ.get('WARNSYS_ADMIN_ACCOUNT', '12345678911')
PASSWORD = os.environ.get('WARNSYS_ADMIN_PASSWORD', 'ws12345678911')
OUT_DIR = os.environ.get('WARNSYS_TEST_OUT', '/www/wwwroot/cursor-x/test-results')
TIMEOUT = int(os.environ.get('WARNSYS_TIMEOUT', '25'))
VERIFY_TLS = os.environ.get('WARNSYS_VERIFY_TLS', 'false').lower() == 'true'

session = requests.Session()
session.verify = VERIFY_TLS
session.headers.update({'User-Agent': 'warnsys-delivery-test/1.0'})


def now_iso():
    return datetime.utcnow().isoformat() + 'Z'


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    d0 = sorted_vals[f] * (c - k)
    d1 = sorted_vals[c] * (k - f)
    return d0 + d1


def summarize_latencies(latencies):
    if not latencies:
        return {}
    s = sorted(latencies)
    return {
        'count': len(s),
        'avg_ms': round(sum(s) / len(s), 2),
        'min_ms': round(s[0], 2),
        'p50_ms': round(pct(s, 0.50), 2),
        'p90_ms': round(pct(s, 0.90), 2),
        'p95_ms': round(pct(s, 0.95), 2),
        'p99_ms': round(pct(s, 0.99), 2),
        'max_ms': round(s[-1], 2),
    }


def do_request(method, path, *, json_body=None, params=None, auth=True, base='api', allow_redirects=True):
    root = BASE_URL if base == 'api' else FRONT_BASE
    url = urljoin(root, path.lstrip('/'))
    headers = {}
    if auth and AUTH_TOKEN:
        headers['Authorization'] = 'Bearer ' + AUTH_TOKEN
    start = time.time()
    try:
        resp = session.request(method, url, json=json_body, params=params, timeout=TIMEOUT, headers=headers, allow_redirects=allow_redirects)
        elapsed = (time.time() - start) * 1000.0
        body_text = resp.text
        parsed = None
        try:
            parsed = resp.json()
        except Exception:
            parsed = None
        return {
            'ok': True,
            'method': method,
            'path': path,
            'url': url,
            'status': resp.status_code,
            'latency_ms': round(elapsed, 2),
            'json': parsed,
            'text_excerpt': body_text[:500],
            'headers': dict(resp.headers),
        }
    except Exception as e:
        elapsed = (time.time() - start) * 1000.0
        return {
            'ok': False,
            'method': method,
            'path': path,
            'url': url,
            'status': None,
            'latency_ms': round(elapsed, 2),
            'error': repr(e),
        }


def login_admin():
    payload = {'account': ACCOUNT, 'password': PASSWORD}
    result = do_request('POST', '/auth/login_admin', json_body=payload, auth=False)
    token = None
    roles = []
    user = None
    if result.get('json'):
        data = result['json'].get('data') or {}
        token = data.get('token') or data.get('access_token')
        roles = data.get('roles_full') or data.get('roles') or []
        user = data.get('user')
    return result, token, roles, user


def serial_probe(name, method, path, *, params=None, samples=5, auth=True, base='api'):
    runs = []
    for _ in range(samples):
        runs.append(do_request(method, path, params=params, auth=auth, base=base))
    latencies = [r['latency_ms'] for r in runs if r.get('status')]
    statuses = {}
    for r in runs:
        key = str(r.get('status'))
        statuses[key] = statuses.get(key, 0) + 1
    return {
        'name': name,
        'method': method,
        'path': path,
        'params': params or {},
        'runs': runs,
        'summary': summarize_latencies(latencies),
        'statuses': statuses,
    }


def pressure_probe(name, method, path, *, params=None, auth=True, concurrency=10, total=50, base='api'):
    started = time.time()
    results = []

    def one_call(_):
        return do_request(method, path, params=params, auth=auth, base=base)

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(one_call, i) for i in range(total)]
        for fut in as_completed(futures):
            results.append(fut.result())
    duration = time.time() - started
    latencies = [r['latency_ms'] for r in results if r.get('status')]
    status_counts = {}
    for r in results:
        key = str(r.get('status'))
        status_counts[key] = status_counts.get(key, 0) + 1
    summary = summarize_latencies(latencies)
    summary.update({
        'concurrency': concurrency,
        'total_requests': total,
        'duration_s': round(duration, 2),
        'rps': round(total / duration, 2) if duration > 0 else None,
        'success_rate': round((sum(1 for r in results if r.get('status') and 200 <= r['status'] < 400) / float(total)) * 100.0, 2),
        'status_counts': status_counts,
    })
    return {
        'name': name,
        'method': method,
        'path': path,
        'params': params or {},
        'summary': summary,
        'sample_failures': [r for r in results if not r.get('status') or r['status'] >= 400][:10],
    }


def extract_json_path(data, path_list, default=None):
    cur = data
    for key in path_list:
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return default
        if cur is None:
            return default
    return cur


def choose_existing_session_id():
    candidates = [
        do_request('GET', '/attendance/sessions', params={'page': 1, 'pageSize': 5}),
        do_request('GET', '/attendance/records', params={'page': 1, 'pageSize': 5}),
        do_request('GET', '/admin/schedules', params={'page': 1, 'pageSize': 5}),
    ]
    for resp in candidates:
        payload = resp.get('json') or {}
        data = payload.get('data')
        if isinstance(data, dict):
            for key in ['list', 'items', 'rows', 'records']:
                arr = data.get(key)
                if isinstance(arr, list) and arr:
                    first = arr[0]
                    if isinstance(first, dict):
                        for id_key in ['session_id', 'id']:
                            if first.get(id_key) is not None:
                                return str(first[id_key]), resp
        elif isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                for id_key in ['session_id', 'id']:
                    if first.get(id_key) is not None:
                        return str(first[id_key]), resp
    return None, candidates


def create_and_end_session_probe():
    result = {
        'create': None,
        'end': None,
        'session_id': None,
        'notes': [],
    }
    create_body = {
        'course_id': 1,
        'class_id': 1,
        'session_start': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'duration_minutes': 45,
    }
    create_resp = do_request('POST', '/attendance/sessions', json_body=create_body)
    result['create'] = create_resp
    sid = None
    data = (create_resp.get('json') or {}).get('data') or {}
    for key in ['session_id', 'id']:
        if data.get(key) is not None:
            sid = str(data.get(key))
            break
    if not sid:
        result['notes'].append('create did not return session_id/id; fallback to existing session lookup')
        sid, source = choose_existing_session_id()
        result['fallback_lookup'] = source
    result['session_id'] = sid
    if sid:
        result['end'] = do_request('POST', '/attendance/sessions/%s/end' % sid, json_body={})
    else:
        result['notes'].append('no session id available for end probe')
    return result


login_result, AUTH_TOKEN, roles_full, login_user = login_admin()

smoke_targets = [
    ('health', 'GET', '/health', None, False, 'api'),
    ('frontend-login-page', 'GET', '/login', None, False, 'front'),
    ('dashboard-summary', 'GET', '/admin/stats/summary', None, True, 'api'),
    ('warnings-list', 'GET', '/warnings', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('warnings-active', 'GET', '/warnings', {'page': 1, 'pageSize': 20, 'scope': 'active'}, True, 'api'),
    ('warnings-history', 'GET', '/warnings', {'page': 1, 'pageSize': 20, 'scope': 'history'}, True, 'api'),
    ('approvals-list', 'GET', '/approvals', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('attendance-records', 'GET', '/attendance/records', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('attendance-sessions', 'GET', '/attendance/sessions', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('students-admin', 'GET', '/admin/students', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('classes-admin', 'GET', '/admin/classes', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('teachers-admin', 'GET', '/admin/teachers', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('course-classes-admin', 'GET', '/admin/course-classes', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('schedules-admin', 'GET', '/admin/schedules', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('audit-operations', 'GET', '/admin/audit/operations', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('audit-notifications', 'GET', '/admin/audit/notifications', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('audit-security-events', 'GET', '/admin/audit/security-events', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('reports-export-records', 'GET', '/reports/export-records', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('system-config', 'GET', '/admin/config', None, True, 'api'),
    ('roles', 'GET', '/admin/roles', None, True, 'api'),
    ('permissions', 'GET', '/admin/permissions', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('feedback-center', 'GET', '/admin/feedback', {'page': 1, 'pageSize': 20}, True, 'api'),
    ('warning-cases', 'GET', '/warning-cases', {'page': 1, 'pageSize': 20}, True, 'api'),
]

smoke_results = []
for name, method, path, params, auth, base in smoke_targets:
    smoke_results.append(serial_probe(name, method, path, params=params, auth=auth, base=base))

pressure_targets = [
    ('health-pressure', 'GET', '/health', None, False, 'api', 20, 100),
    ('dashboard-pressure', 'GET', '/admin/stats/summary', None, True, 'api', 12, 60),
    ('warnings-active-pressure', 'GET', '/warnings', {'page': 1, 'pageSize': 20, 'scope': 'active'}, True, 'api', 12, 60),
    ('warnings-history-pressure', 'GET', '/warnings', {'page': 1, 'pageSize': 20, 'scope': 'history'}, True, 'api', 12, 60),
    ('attendance-records-pressure', 'GET', '/attendance/records', {'page': 1, 'pageSize': 20}, True, 'api', 12, 60),
    ('audit-operations-pressure', 'GET', '/admin/audit/operations', {'page': 1, 'pageSize': 20}, True, 'api', 8, 40),
    ('login-pressure', 'POST', '/auth/login_admin', None, False, 'api', 8, 24),
]

pressure_results = []
for name, method, path, params, auth, base, concurrency, total in pressure_targets:
    if name == 'login-pressure':
        started = time.time()
        results = []
        def login_once(_):
            return do_request('POST', '/auth/login_admin', json_body={'account': ACCOUNT, 'password': PASSWORD}, auth=False)
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = [ex.submit(login_once, i) for i in range(total)]
            for fut in as_completed(futures):
                results.append(fut.result())
        duration = time.time() - started
        lats = [r['latency_ms'] for r in results if r.get('status')]
        sc = {}
        for r in results:
            key = str(r.get('status'))
            sc[key] = sc.get(key, 0) + 1
        summary = summarize_latencies(lats)
        summary.update({'concurrency': concurrency, 'total_requests': total, 'duration_s': round(duration, 2), 'rps': round(total / duration, 2), 'success_rate': round((sum(1 for r in results if r.get('status') and 200 <= r['status'] < 400) / float(total)) * 100.0, 2), 'status_counts': sc})
        pressure_results.append({'name': name, 'method': method, 'path': path, 'summary': summary, 'sample_failures': [r for r in results if not r.get('status') or r['status'] >= 400][:10]})
    else:
        pressure_results.append(pressure_probe(name, method, path, params=params, auth=auth, base=base, concurrency=concurrency, total=total))

write_probe = create_and_end_session_probe()

report = {
    'generated_at': now_iso(),
    'base_url': BASE_URL,
    'front_url': FRONT_BASE,
    'login': {
        'result': login_result,
        'token_present': bool(AUTH_TOKEN),
        'roles_full': roles_full,
        'user': login_user,
    },
    'smoke_results': smoke_results,
    'pressure_results': pressure_results,
    'write_probe': write_probe,
}

stamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
out_path = os.path.join(OUT_DIR, 'formal_delivery_report_' + stamp + '.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(out_path)
