#!/usr/bin/env python3
import json
import os
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = 'http://127.0.0.1:3000'
OUT = '/www/wwwroot/cursor-x/test-results/formal-delivery-role-and-write-tests.json'


def now_ms():
    return time.perf_counter() * 1000.0


def request(method, path, token=None, body=None, timeout=30):
    url = BASE_URL + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer {0}'.format(token)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = now_ms()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            duration = round(now_ms() - started, 2)
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {'raw': raw}
            return {'ok': True, 'status': resp.status, 'duration_ms': duration, 'body': parsed}
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace')
        duration = round(now_ms() - started, 2)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {'raw': raw}
        return {'ok': False, 'status': e.code, 'duration_ms': duration, 'body': parsed}
    except Exception as e:
        duration = round(now_ms() - started, 2)
        return {'ok': False, 'status': 0, 'duration_ms': duration, 'body': {'error': str(e)}}


def login(account, password):
    return request('POST', '/auth/login_admin', body={'account': account, 'password': password})


def percentile(values, pct):
    seq = sorted(values)
    if not seq:
        return None
    if len(seq) == 1:
        return seq[0]
    k = (len(seq) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(seq) - 1)
    if f == c:
        return seq[f]
    return seq[f] * (c - k) + seq[c] * (k - f)


def pressure(name, method, path, token=None, body=None, requests=24, concurrency=6):
    results = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(request, method, path, token, body) for _ in range(requests)]
        for future in as_completed(futures):
            results.append(future.result())
    elapsed = max(time.time() - started, 0.001)
    ds = [r['duration_ms'] for r in results]
    return {
        'name': name,
        'count': len(results),
        'ok_count': sum(1 for r in results if r['ok']),
        'fail_count': sum(1 for r in results if not r['ok']),
        'avg_ms': round(sum(ds) / len(ds), 2),
        'p95_ms': round(percentile(ds, 95), 2),
        'p99_ms': round(percentile(ds, 99), 2),
        'max_ms': round(max(ds), 2),
        'throughput_rps': round(len(results) / elapsed, 2),
        'sample_failures': [r for r in results if not r['ok']][:3],
    }


def build_role_result(name, account, password, checks):
    lg = login(account, password) or {'ok': False, 'body': {}, 'status': 0, 'duration_ms': 0}
    result = {'account': account, 'login': lg, 'checks': []}
    token = None
    if isinstance(lg, dict) and lg.get('ok'):
        body = lg.get('body') or {}
        if isinstance(body, dict):
            data = body.get('data') or {}
            if isinstance(data, dict):
                token = data.get('token')
    def safe_request(method, path, token=None, body=None):
        return request(method, path, token=token, body=body) or {'ok': False, 'status': 0, 'duration_ms': 0, 'body': {'error': 'empty_result'}}

    if token:
        for method, path, body in checks:
            result['checks'].append({'method': method, 'path': path, 'result': safe_request(method, path, token=token, body=body)})
    return result


def try_candidates(name, candidates, checks):
    attempts = []
    for account, password in candidates:
        role_result = build_role_result(name, account, password, checks)
        attempts.append(role_result)
        if role_result['login'].get('ok'):
            return {'success': True, 'selected': role_result, 'attempts': attempts}
    return {'success': False, 'selected': None, 'attempts': attempts}


def main():
    report = {'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'roles': {}, 'write_pressure': {}}

    report['roles']['sys_admin'] = build_role_result(
        'sys_admin',
        '12345678911',
        'ws12345678911',
        [
            ('GET', '/admin/stats/summary', None),
            ('GET', '/attendance/sessions?page=1&page_size=10', None),
            ('GET', '/warnings/class-view/students?page=1&page_size=10', None),
            ('POST', '/jobs/process_ended_sessions', {}),
        ],
    )

    report['roles']['student'] = build_role_result(
        'student',
        '202600200201',
        '123456789',
        [
            ('GET', '/student/profile', None),
            ('GET', '/student/today', None),
            ('GET', '/student/warnings', None),
            ('GET', '/student/notifications', None),
        ],
    )

    report['roles']['teacher'] = try_candidates(
        'teacher',
        [('18181919245', '18181919245'), ('123456123', '123456123'), ('123456126', '123456126'), ('1002661661w', '1002661661w')],
        [
            ('GET', '/teacher/profile', None),
            ('GET', '/teacher/sessions?page=1&page_size=10', None),
            ('GET', '/teacher/courses', None),
        ],
    )

    report['roles']['head_teacher'] = try_candidates(
        'head_teacher',
        [('123456123', '123456123'), ('1002661661w', '1002661661w')],
        [
            ('GET', '/head-teacher/stats', None),
            ('GET', '/head-teacher/warnings', None),
            ('GET', '/head-teacher/leave-requests', None),
        ],
    )

    report['roles']['class_monitor'] = try_candidates(
        'class_monitor',
        [('18055117374', '18055117374'), ('202524120155', '123456789'), ('202524120155', '202524120155')],
        [
            ('GET', '/class-monitor/stats', None),
            ('GET', '/class-monitor/warnings', None),
            ('GET', '/class-monitor/members', None),
        ],
    )

    admin_token = report['roles']['sys_admin']['login'].get('body', {}).get('data', {}).get('token') if report['roles']['sys_admin']['login'].get('ok') else None
    if admin_token:
        report['write_pressure']['jobs_process_ended_sessions'] = pressure('jobs_process_ended_sessions', 'POST', '/jobs/process_ended_sessions', token=admin_token, body={}, requests=12, concurrency=3)
        report['write_pressure']['jobs_process_and_generate_warnings'] = pressure('jobs_process_and_generate_warnings', 'POST', '/jobs/process_and_generate_warnings', token=admin_token, body={}, requests=12, concurrency=3)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(OUT)


if __name__ == '__main__':
    main()
