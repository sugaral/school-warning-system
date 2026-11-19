#!/usr/bin/env python3
import json
import os
import statistics
import subprocess
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
ADMIN_ACCOUNT = os.environ.get('ADMIN_ACCOUNT', '12345678911')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'ws12345678911')
OUTPUT_PATH = os.environ.get('OUTPUT_PATH', '/www/wwwroot/cursor-x/test-results/school-delivery-full-report.json')
CONCURRENCY = int(os.environ.get('TEST_CONCURRENCY', '12'))
PRESSURE_REQUESTS = int(os.environ.get('PRESSURE_REQUESTS', '48'))
TIMEOUT = int(os.environ.get('TEST_TIMEOUT', '30'))


def now_ms():
    return time.perf_counter() * 1000.0


def request(method, path, token=None, body=None, timeout=TIMEOUT):
    url = BASE_URL.rstrip('/') + path
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
            return {
                'ok': 200 <= resp.status < 300,
                'status': resp.status,
                'duration_ms': duration,
                'body': parsed,
                'path': path,
                'method': method,
            }
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace')
        duration = round(now_ms() - started, 2)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {'raw': raw}
        return {
            'ok': False,
            'status': e.code,
            'duration_ms': duration,
            'body': parsed,
            'path': path,
            'method': method,
        }
    except Exception as e:
        duration = round(now_ms() - started, 2)
        return {
            'ok': False,
            'status': 0,
            'duration_ms': duration,
            'body': {'error': str(e)},
            'path': path,
            'method': method,
        }


def percentile(values, pct):
    if not values:
        return 0.0
    seq = sorted(values)
    if len(seq) == 1:
        return seq[0]
    k = (len(seq) - 1) * (pct / 100.0)
    f = int(k)
    c = min(f + 1, len(seq) - 1)
    if f == c:
        return seq[f]
    d0 = seq[f] * (c - k)
    d1 = seq[c] * (k - f)
    return d0 + d1


def summarize(name, responses):
    durations = [r['duration_ms'] for r in responses]
    ok_count = sum(1 for r in responses if r['ok'])
    status_buckets = {}
    for r in responses:
        key = str(r['status'])
        status_buckets[key] = status_buckets.get(key, 0) + 1
    return {
        'name': name,
        'count': len(responses),
        'ok_count': ok_count,
        'fail_count': len(responses) - ok_count,
        'status_buckets': status_buckets,
        'min_ms': round(min(durations), 2) if durations else None,
        'avg_ms': round(sum(durations) / len(durations), 2) if durations else None,
        'p50_ms': round(statistics.median(durations), 2) if durations else None,
        'p95_ms': round(percentile(durations, 95), 2) if durations else None,
        'p99_ms': round(percentile(durations, 99), 2) if durations else None,
        'max_ms': round(max(durations), 2) if durations else None,
        'sample_failures': [r for r in responses if not r['ok']][:5],
    }


def pressure_test(name, method, path, token=None, body=None, requests=PRESSURE_REQUESTS, concurrency=CONCURRENCY):
    results = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(request, method, path, token, body) for _ in range(requests)]
        for future in as_completed(futures):
            results.append(future.result())
    elapsed = max(time.time() - started, 0.001)
    summary = summarize(name, results)
    summary['throughput_rps'] = round(len(results) / elapsed, 2)
    summary['concurrency'] = concurrency
    return summary


def run_cmd(command):
    proc = subprocess.run(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    return {'exit_code': proc.returncode, 'output': proc.stdout[:30000]}


def detect_backend_container_name():
    proc = subprocess.run("docker ps --format '{{.Names}}'", shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    names = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    for name in names:
        if 'warnsys-backend' in name:
            return name
    return 'warnsys-backend'


def load_pages_inventory():
    pages_dir = Path('/www/wwwroot/cursor-x/admin-frontend/src/pages')
    return sorted(str(p.relative_to(pages_dir)) for p in pages_dir.rglob('*.vue'))


def load_controller_inventory():
    script = r'''from pathlib import Path
import re, json
root=Path('/www/wwwroot/cursor-x/backend/src')
controllers=[]
for p in root.rglob('*.controller.ts'):
    text=p.read_text(encoding='utf-8',errors='ignore')
    base_match=re.search(r"@Controller\('([^']+)'\)", text)
    base='/' + base_match.group(1) if base_match else ''
    routes=[]
    lines=text.splitlines()
    for line in lines:
        m=re.search(r"@(Get|Post|Put|Delete)\('([^']*)'\)", line)
        if m:
            method,path=m.group(1).upper(),m.group(2)
            full=base + ('/' + path if path else '')
            full=full.replace('//','/')
            routes.append({'method':method,'path':full})
    controllers.append({'file':str(p), 'base':base, 'route_count':len(routes), 'routes':routes})
print(json.dumps(controllers,ensure_ascii=False))'''
    proc = subprocess.run(['python3', '-c', script], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    if proc.returncode != 0:
        return {'error': proc.stdout}
    return json.loads(proc.stdout)


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    report = {
        'base_url': BASE_URL,
        'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'inventory': {},
        'environment': {},
        'smoke': {},
        'pressure': {},
        'write_path': {},
        'notes': [],
    }

    report['inventory']['frontend_pages'] = load_pages_inventory()
    controllers = load_controller_inventory()
    report['inventory']['backend_controllers'] = controllers
    report['inventory']['frontend_page_count'] = len(report['inventory']['frontend_pages'])
    report['inventory']['backend_controller_count'] = len(controllers) if isinstance(controllers, list) else None

    report['environment']['health'] = request('GET', '/health')
    login = request('POST', '/auth/login_admin', body={'account': ADMIN_ACCOUNT, 'password': ADMIN_PASSWORD})
    report['smoke']['login_admin'] = login
    if not login['ok']:
        report['notes'].append('admin login failed; aborting authenticated tests')
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(OUTPUT_PATH)
        return

    token = login['body'].get('data', {}).get('token')

    smoke_cases = [
        ('scan_status', 'GET', '/jobs/scan-status', None),
        ('stats_summary', 'GET', '/admin/stats/summary', None),
        ('stats_system', 'GET', '/admin/stats/system', None),
        ('stats_warning_trend', 'GET', '/admin/stats/warning-trend', None),
        ('attendance_sessions', 'GET', '/attendance/sessions?page=1&page_size=20', None),
        ('attendance_session_options', 'GET', '/attendance/session-options', None),
        ('warnings_courses', 'GET', '/warnings/courses', None),
        ('warnings_class_students', 'GET', '/warnings/class-view/students?page=1&page_size=20', None),
        ('students_export_accounts', 'GET', '/admin/students/export-accounts', None),
        ('student_admin_dashboard', 'GET', '/student-admin/dashboard', None),
        ('teacher_sessions', 'GET', '/teacher/sessions?page=1&page_size=20', None),
        ('teacher_profile', 'GET', '/teacher/profile', None),
        ('head_teacher_stats', 'GET', '/head-teacher/stats', None),
        ('class_monitor_stats', 'GET', '/class-monitor/stats', None),
        ('warning_cases_summary', 'GET', '/warning-cases/summary', None),
        ('reports_history', 'GET', '/admin/reports/history?page=1&page_size=20', None),
        ('reports_overview', 'GET', '/admin/reports/overview', None),
        ('audit_operations', 'GET', '/admin/audit/operations?page=1&page_size=20', None),
        ('audit_notifications', 'GET', '/admin/audit/notifications?page=1&page_size=20', None),
        ('audit_security', 'GET', '/admin/audit/security-events?page=1&page_size=20', None),
        ('config_email', 'GET', '/admin/config/email', None),
        ('roles_my', 'GET', '/admin/roles/my', None),
        ('permissions_my', 'GET', '/admin/permissions/my', None),
        ('feedback_list', 'GET', '/admin/feedback?page=1&page_size=20', None),
    ]

    for name, method, path, body in smoke_cases:
        report['smoke'][name] = request(method, path, token=token, body=body)

    report['pressure']['login_admin'] = pressure_test('login_admin', 'POST', '/auth/login_admin', body={'account': ADMIN_ACCOUNT, 'password': ADMIN_PASSWORD}, requests=24, concurrency=6)
    report['pressure']['stats_summary'] = pressure_test('stats_summary', 'GET', '/admin/stats/summary', token=token)
    report['pressure']['stats_system'] = pressure_test('stats_system', 'GET', '/admin/stats/system', token=token)
    report['pressure']['attendance_sessions'] = pressure_test('attendance_sessions', 'GET', '/attendance/sessions?page=1&page_size=20', token=token)
    report['pressure']['warnings_class_students'] = pressure_test('warnings_class_students', 'GET', '/warnings/class-view/students?page=1&page_size=20', token=token)
    report['pressure']['scan_status'] = pressure_test('scan_status', 'GET', '/jobs/scan-status', token=token)
    report['pressure']['teacher_sessions'] = pressure_test('teacher_sessions', 'GET', '/teacher/sessions?page=1&page_size=20', token=token)
    report['pressure']['audit_operations'] = pressure_test('audit_operations', 'GET', '/admin/audit/operations?page=1&page_size=20', token=token)
    report['pressure']['reports_history'] = pressure_test('reports_history', 'GET', '/admin/reports/history?page=1&page_size=20', token=token)

    sessions_resp = request('GET', '/attendance/sessions?page=1&page_size=5', token=token)
    report['write_path']['attendance_sessions_probe'] = sessions_resp
    session_ids = []
    if sessions_resp['ok']:
        data = sessions_resp['body'].get('data') or []
        for item in data:
            if str(item.get('status')) == 'active':
                session_ids.append(str(item.get('id')))
    if session_ids:
        target = session_ids[0]
        end_result = request('POST', '/attendance/sessions/{0}/end'.format(target), token=token)
        report['write_path']['single_end_session'] = end_result
        if end_result.get('ok'):
            poll_results = []
            for _ in range(15):
                polled = request('GET', '/warnings/class-view/students?page=1&page_size=20', token=token)
                poll_results.append(polled)
                time.sleep(1)
            report['write_path']['warnings_visibility_poll_after_end'] = summarize('warnings_visibility_poll_after_end', poll_results)
            report['write_path']['warnings_visibility_poll_samples'] = poll_results
    else:
        report['notes'].append('no active attendance session found for live end-session write-path test')

    report['environment']['docker_ps'] = run_cmd('docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"')
    backend_container = detect_backend_container_name()
    report['environment']['backend_container_name'] = backend_container
    report['environment']['recent_backend_logs'] = run_cmd('docker logs --tail 200 {0}'.format(backend_container))

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(OUTPUT_PATH)


if __name__ == '__main__':
    main()
