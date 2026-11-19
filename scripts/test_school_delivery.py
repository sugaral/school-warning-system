#!/usr/bin/env python3
import json
import math
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

BASE = os.environ.get('WARNSYS_BASE', 'http://localhost:3000').rstrip('/')
ACCOUNT = os.environ.get('WARNSYS_ACCOUNT', '12345678911')
PASSWORD = os.environ.get('WARNSYS_PASSWORD', 'ws12345678911')
OUT = os.environ.get('WARNSYS_OUT', '/www/wwwroot/cursor-x/test-results-school-delivery.json')


def now_ms():
    return int(time.time() * 1000)


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [json_safe(v) for v in value]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        return None
    return value


def request_json(method, path, token=None, payload=None, timeout=120):
    url = BASE + path
    data = None
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            latency_ms = round((time.time() - start) * 1000, 2)
            text = raw.decode('utf-8', errors='replace')
            parsed = json.loads(text)
            return {
                'ok': True,
                'status': resp.status,
                'latency_ms': latency_ms,
                'json': parsed,
                'text': text,
            }
    except urllib.error.HTTPError as e:
        raw = e.read()
        latency_ms = round((time.time() - start) * 1000, 2)
        text = raw.decode('utf-8', errors='replace')
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None
        return {
            'ok': False,
            'status': e.code,
            'latency_ms': latency_ms,
            'json': parsed,
            'text': text,
            'error': str(e),
        }
    except Exception as e:
        latency_ms = round((time.time() - start) * 1000, 2)
        return {
            'ok': False,
            'status': None,
            'latency_ms': latency_ms,
            'json': None,
            'text': '',
            'error': repr(e),
        }


def summarize_latencies(samples):
    values = [float(x) for x in samples if x is not None]
    if not values:
        return {}
    values_sorted = sorted(values)
    def percentile(p):
        if len(values_sorted) == 1:
            return round(values_sorted[0], 2)
        idx = (len(values_sorted) - 1) * p
        lo = int(math.floor(idx))
        hi = int(math.ceil(idx))
        if lo == hi:
            return round(values_sorted[lo], 2)
        frac = idx - lo
        return round(values_sorted[lo] * (1 - frac) + values_sorted[hi] * frac, 2)
    return {
        'count': len(values_sorted),
        'min_ms': round(min(values_sorted), 2),
        'avg_ms': round(sum(values_sorted) / len(values_sorted), 2),
        'p50_ms': percentile(0.5),
        'p90_ms': percentile(0.9),
        'p95_ms': percentile(0.95),
        'max_ms': round(max(values_sorted), 2),
    }


def login():
    resp = request_json('POST', '/auth/login_admin', payload={'account': ACCOUNT, 'password': PASSWORD}, timeout=60)
    if not resp['ok']:
        raise RuntimeError('login failed: %s' % resp)
    data = resp['json'].get('data') or {}
    token = data.get('token') or data.get('access_token')
    if not token:
        raise RuntimeError('missing token: %s' % resp['text'])
    return token, resp


def get_total_from_payload(payload):
    data = (payload or {}).get('data') or {}
    if isinstance(data, dict):
        if 'total' in data:
            try:
                return int(data.get('total') or 0)
            except Exception:
                return 0
        if 'items' in data and isinstance(data['items'], list):
            return len(data['items'])
    if isinstance(data, list):
        return len(data)
    return 0


def list_session_ids(token, limit=200):
    resp = request_json('GET', '/attendance/sessions?status=all&pageSize=%d' % limit, token=token, timeout=120)
    if not resp['ok']:
        return []
    data = resp['json'].get('data')
    items = []
    if isinstance(data, dict):
        items = data.get('items') or []
    elif isinstance(data, list):
        items = data
    result = []
    for item in items:
        sid = item.get('id')
        if sid is not None:
            result.append(str(sid))
    return result


def cleanup_sessions(token):
    ids = list_session_ids(token, 200)
    if not ids:
        return {'removed': 0, 'ids': []}
    payload = {'session_ids': [int(x) for x in ids[:50]]}
    resp = request_json('POST', '/attendance/sessions/batch-delete', token=token, payload=payload, timeout=240)
    return {'removed': len(payload['session_ids']), 'ids': payload['session_ids'], 'response': resp}


def endpoint_smoke(token):
    endpoints = [
        ('health', 'GET', '/health', None),
        ('dashboard_summary', 'GET', '/admin/stats/summary', None),
        ('warnings_list', 'GET', '/warnings?page=1&page_size=10', None),
        ('warning_scan_status', 'GET', '/jobs/scan-status', None),
        ('reports_overview', 'GET', '/admin/reports/overview', None),
        ('attendance_list', 'GET', '/attendance/sessions?status=all&pageSize=20', None),
        ('attendance_options', 'GET', '/attendance/session-options', None),
        ('system_config', 'GET', '/admin/config', None),
    ]
    results = []
    for name, method, path, payload in endpoints:
        auth = None if name == 'health' else token
        resp = request_json(method, path, token=auth, payload=payload, timeout=180)
        item = {
            'name': name,
            'method': method,
            'path': path,
            'ok': resp['ok'],
            'status': resp['status'],
            'latency_ms': resp['latency_ms'],
        }
        if not resp['ok']:
            item['error'] = resp.get('error') or resp.get('text', '')[:500]
        results.append(item)
    return results


def repeated_latency(token):
    defs = [
        ('health', 'GET', '/health', None, None),
        ('login_admin', 'POST', '/auth/login_admin', {'account': ACCOUNT, 'password': PASSWORD}, None),
        ('dashboard_summary', 'GET', '/admin/stats/summary', None, token),
        ('warnings_list', 'GET', '/warnings?page=1&page_size=20', None, token),
        ('attendance_list', 'GET', '/attendance/sessions?status=all&pageSize=20', None, token),
        ('reports_overview', 'GET', '/admin/reports/overview', None, token),
        ('scan_status', 'GET', '/jobs/scan-status', None, token),
    ]
    result = {}
    for name, method, path, payload, auth_token in defs:
        samples = []
        failures = []
        for _ in range(5):
            resp = request_json(method, path, token=auth_token, payload=payload, timeout=180)
            if resp['ok']:
                samples.append(resp['latency_ms'])
            else:
                failures.append({'status': resp['status'], 'error': resp.get('error')})
        result[name] = {
            'summary': summarize_latencies(samples),
            'failures': failures,
        }
    return result


def workflow_attendance_and_warning(token):
    out = {}
    before = request_json('GET', '/warnings?page=1&page_size=1', token=token, timeout=120)
    before_total = get_total_from_payload(before.get('json')) if before['ok'] else None
    out['warnings_before'] = {'total': before_total, 'latency_ms': before['latency_ms'], 'ok': before['ok']}

    create = request_json('POST', '/attendance/sessions/batch-create', token=token, payload={'count': 1, 'expire_minutes': 1}, timeout=180)
    out['create_session'] = {'ok': create['ok'], 'status': create['status'], 'latency_ms': create['latency_ms']}
    session_id = None
    if create['ok']:
        ids = (((create['json'] or {}).get('data') or {}).get('session_ids') or [])
        if ids:
            session_id = str(ids[0])
            out['create_session']['session_id'] = session_id
    if not session_id:
        out['error'] = 'batch-create failed'
        return out

    details = request_json('GET', '/attendance/sessions/%s/attendance' % session_id, token=token, timeout=180)
    out['get_session_attendance'] = {'ok': details['ok'], 'status': details['status'], 'latency_ms': details['latency_ms']}

    qr = request_json('GET', '/attendance/sessions/%s/qr-state' % session_id, token=token, timeout=180)
    out['get_qr_state'] = {'ok': qr['ok'], 'status': qr['status'], 'latency_ms': qr['latency_ms']}

    end = request_json('POST', '/attendance/sessions/%s/end' % session_id, token=token, timeout=240)
    out['end_session'] = {'ok': end['ok'], 'status': end['status'], 'latency_ms': end['latency_ms']}

    time.sleep(3)
    after = request_json('GET', '/warnings?page=1&page_size=1', token=token, timeout=120)
    after_total = get_total_from_payload(after.get('json')) if after['ok'] else None
    out['warnings_after_end'] = {'total': after_total, 'latency_ms': after['latency_ms'], 'ok': after['ok']}
    if before_total is not None and after_total is not None:
        out['warning_delta_after_end'] = after_total - before_total

    delete = request_json('DELETE', '/attendance/sessions/%s' % session_id, token=token, timeout=300)
    out['delete_session'] = {'ok': delete['ok'], 'status': delete['status'], 'latency_ms': delete['latency_ms']}
    if delete['ok']:
        deleted_count = (((delete['json'] or {}).get('data') or {}).get('deleted_warnings_count'))
        out['delete_session']['deleted_warnings_count'] = deleted_count

    time.sleep(3)
    final = request_json('GET', '/warnings?page=1&page_size=1', token=token, timeout=120)
    final_total = get_total_from_payload(final.get('json')) if final['ok'] else None
    out['warnings_after_delete'] = {'total': final_total, 'latency_ms': final['latency_ms'], 'ok': final['ok']}
    if after_total is not None and final_total is not None:
        out['warning_delta_after_delete'] = final_total - after_total
    return out


def batch_workflow(token):
    out = {}
    cleanup_sessions(token)
    create = request_json('POST', '/attendance/sessions/batch-create', token=token, payload={'count': 10, 'expire_minutes': 1}, timeout=180)
    out['create_batch'] = {'ok': create['ok'], 'status': create['status'], 'latency_ms': create['latency_ms']}
    if not create['ok']:
        return out
    ids = (((create['json'] or {}).get('data') or {}).get('session_ids') or [])
    out['create_batch']['count'] = len(ids)
    if not ids:
        return out
    end = request_json('POST', '/attendance/sessions/batch-end', token=token, payload={'session_ids': ids}, timeout=300)
    out['batch_end'] = {'ok': end['ok'], 'status': end['status'], 'latency_ms': end['latency_ms']}
    delete = request_json('POST', '/attendance/sessions/batch-delete', token=token, payload={'session_ids': ids}, timeout=300)
    out['batch_delete'] = {'ok': delete['ok'], 'status': delete['status'], 'latency_ms': delete['latency_ms']}
    return out


def concurrent_probe(name, method, path, token, payload, concurrency, requests_count):
    latencies = []
    statuses = []
    failures = []
    lock = threading.Lock()

    def worker(_index):
        resp = request_json(method, path, token=token, payload=payload, timeout=300)
        with lock:
            statuses.append(resp['status'])
            if resp['ok']:
                latencies.append(resp['latency_ms'])
            else:
                failures.append({'status': resp['status'], 'error': resp.get('error') or resp.get('text', '')[:300]})

    started = time.time()
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = [ex.submit(worker, i) for i in range(requests_count)]
        for fut in as_completed(futs):
            fut.result()
    duration = time.time() - started
    rps = round((requests_count / duration), 2) if duration > 0 else None
    return {
        'name': name,
        'method': method,
        'path': path,
        'concurrency': concurrency,
        'requests': requests_count,
        'duration_s': round(duration, 2),
        'throughput_rps': rps,
        'success': len(latencies),
        'failed': len(failures),
        'status_counts': {str(k): statuses.count(k) for k in sorted(set(statuses), key=lambda x: str(x))},
        'latency_summary': summarize_latencies(latencies),
        'failure_samples': failures[:10],
    }


def pressure_tests(token):
    tests = []
    tests.append(concurrent_probe('health_read_50x10', 'GET', '/health', None, None, 10, 50))
    tests.append(concurrent_probe('dashboard_summary_60x10', 'GET', '/admin/stats/summary', token, None, 10, 60))
    tests.append(concurrent_probe('warnings_list_60x10', 'GET', '/warnings?page=1&page_size=20', token, None, 10, 60))
    tests.append(concurrent_probe('attendance_list_40x8', 'GET', '/attendance/sessions?status=all&pageSize=20', token, None, 8, 40))
    tests.append(concurrent_probe('login_admin_30x6', 'POST', '/auth/login_admin', None, {'account': ACCOUNT, 'password': PASSWORD}, 6, 30))
    return tests


def collect_logs():
    try:
        proc = subprocess.run(['docker', 'logs', 'warnsys-backend', '--since', '5m'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=40)
        text = proc.stdout.decode('utf-8', errors='replace')
        lines = [line for line in text.splitlines() if 'error' in line.lower() or 'warn' in line.lower() or 'endSession' in line or '预警' in line]
        return lines[-80:]
    except Exception as e:
        return ['failed to collect docker logs: %r' % (e,)]


def evaluate(result):
    conclusions = []
    latency = result.get('latency_benchmarks', {})
    pressure = result.get('pressure_tests', [])
    workflow = result.get('workflow_tests', {})

    def get_avg(name):
        return (((latency.get(name) or {}).get('summary') or {}).get('avg_ms'))

    health_avg = get_avg('health')
    login_avg = get_avg('login_admin')
    dash_avg = get_avg('dashboard_summary')
    warnings_avg = get_avg('warnings_list')
    reports_avg = get_avg('reports_overview')
    end_ms = (((workflow.get('single_attendance_cycle') or {}).get('end_session') or {}).get('latency_ms'))
    batch_end_ms = (((workflow.get('batch_attendance_cycle') or {}).get('batch_end') or {}).get('latency_ms'))

    if health_avg is not None and health_avg < 50:
        conclusions.append('基础健康检查延迟优秀，可视为生产可用。')
    if login_avg is not None and login_avg < 250:
        conclusions.append('管理员登录延迟较低，满足高频登录或会话续期场景。')
    if dash_avg is not None and dash_avg < 1500:
        conclusions.append('管理端仪表盘汇总接口延迟可接受，适合校级正式使用。')
    if warnings_avg is not None and warnings_avg < 2000:
        conclusions.append('预警列表查询速度达到日常值班和辅导员使用要求。')
    if reports_avg is not None and reports_avg > 2500:
        conclusions.append('报表接口偏重，正式交付前建议继续做缓存/异步导出。')
    if end_ms is not None and end_ms < 500:
        conclusions.append('单个签到结束已经达到“秒响应”标准。')
    if batch_end_ms is not None and batch_end_ms < 1500:
        conclusions.append('批量结束签到在中小规模并发下表现良好。')

    failed_pressure = [p for p in pressure if p.get('failed', 0) > 0]
    if failed_pressure:
        conclusions.append('压力测试中存在失败请求，需要关注限流、连接池或个别慢查询。')
    else:
        conclusions.append('本轮读压与登录压测未出现失败，请求稳定性较好。')

    suitable = True
    if failed_pressure:
        suitable = False
    for key in ('dashboard_summary', 'warnings_list', 'reports_overview'):
        avg = get_avg(key)
        if avg is not None and avg > 3000:
            suitable = False
    if end_ms is not None and end_ms > 2000:
        suitable = False

    return {
        'suitable_for_formal_school_delivery': suitable,
        'conclusions': conclusions,
    }


def main():
    started_at = datetime.now().isoformat()
    token, login_resp = login()
    result = {
        'meta': {
            'base': BASE,
            'started_at': started_at,
            'account': ACCOUNT,
        },
        'precheck': {
            'login_latency_ms': login_resp['latency_ms'],
        },
    }
    result['cleanup_before'] = cleanup_sessions(token)
    result['smoke_tests'] = endpoint_smoke(token)
    result['latency_benchmarks'] = repeated_latency(token)
    result['workflow_tests'] = {
        'single_attendance_cycle': workflow_attendance_and_warning(token),
        'batch_attendance_cycle': batch_workflow(token),
    }
    result['pressure_tests'] = pressure_tests(token)
    result['backend_log_excerpt'] = collect_logs()
    result['evaluation'] = evaluate(result)
    result['meta']['finished_at'] = datetime.now().isoformat()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(json_safe(result), f, ensure_ascii=False, indent=2)
    print(json.dumps(json_safe(result), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
