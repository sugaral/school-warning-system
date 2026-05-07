#!/usr/bin/env python3
import json
import os
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
ADMIN_ACCOUNT = os.environ.get('ADMIN_ACCOUNT', '12345678911')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'ws12345678911')
OUTPUT_PATH = os.environ.get('OUTPUT_PATH', '/www/wwwroot/cursor-x/test-results/end-session-warning-latency.json')
TIMEOUT = int(os.environ.get('TEST_TIMEOUT', '30'))
POLL_SECONDS = int(os.environ.get('POLL_SECONDS', '15'))
CONCURRENCY = int(os.environ.get('END_PRESSURE_CONCURRENCY', '8'))
REQUESTS = int(os.environ.get('END_PRESSURE_REQUESTS', '24'))


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
            return {'ok': 200 <= resp.status < 300, 'status': resp.status, 'duration_ms': duration, 'body': parsed, 'path': path, 'method': method}
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace')
        duration = round(now_ms() - started, 2)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {'raw': raw}
        return {'ok': False, 'status': e.code, 'duration_ms': duration, 'body': parsed, 'path': path, 'method': method}
    except Exception as e:
        duration = round(now_ms() - started, 2)
        return {'ok': False, 'status': 0, 'duration_ms': duration, 'body': {'error': str(e)}, 'path': path, 'method': method}


def login_admin():
    return request('POST', '/auth/login_admin', body={'account': ADMIN_ACCOUNT, 'password': ADMIN_PASSWORD})


def pick_class_context(token):
    resp = request('GET', '/attendance/session-options', token=token)
    if not resp['ok']:
        return resp, None
    data = resp['body'].get('data') or {}
    classes = data.get('classes') or []
    if not classes:
        return resp, None
    target_class = classes[0]
    class_id = str(target_class.get('id'))
    course_resp = request('GET', '/attendance/session-options/courses?class_id={0}'.format(class_id), token=token)
    if not course_resp['ok']:
        return course_resp, None
    courses = (course_resp['body'].get('data') or {}).get('courses') or []
    if not courses:
        return course_resp, None
    target_course = courses[0]
    return None, {
        'class_id': class_id,
        'course_id': str(target_course.get('course_id') or target_course.get('id')),
        'org_id': str(target_class.get('org_id') or ''),
    }


def create_session(token, context):
    now = time.time() - 120
    start_time = time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(now))
    payload = {
        'org_id': context['org_id'],
        'class_id': context['class_id'],
        'course_id': context['course_id'],
        'start_time': start_time,
        'expire_minutes': 5,
    }
    return request('POST', '/attendance/sessions', token=token, body=payload)


def get_warning_count(token):
    resp = request('GET', '/warnings/class-view/students?page=1&page_size=100', token=token)
    count = None
    if resp['ok']:
        data = resp['body'].get('data')
        if isinstance(data, dict):
            for key in ['total', 'count', 'total_count']:
                if key in data and isinstance(data[key], int):
                    count = data[key]
                    break
            if count is None and isinstance(data.get('items'), list):
                count = len(data.get('items'))
        elif isinstance(data, list):
            count = len(data)
    return resp, count


def pressure_end_session(token, session_id, requests=REQUESTS, concurrency=CONCURRENCY):
    def one_call():
        return request('POST', '/attendance/sessions/{0}/end'.format(session_id), token=token)
    started = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(one_call) for _ in range(requests)]
        for future in as_completed(futures):
            results.append(future.result())
    elapsed = max(time.time() - started, 0.001)
    durations = [r['duration_ms'] for r in results]
    buckets = {}
    for r in results:
        buckets[str(r['status'])] = buckets.get(str(r['status']), 0) + 1
    return {
        'count': len(results),
        'status_buckets': buckets,
        'avg_ms': round(sum(durations) / len(durations), 2),
        'max_ms': round(max(durations), 2),
        'throughput_rps': round(len(results) / elapsed, 2),
        'sample_failures': [r for r in results if not r['ok']][:5],
    }


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    report = {'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'base_url': BASE_URL}
    login = login_admin()
    report['login'] = login
    if not login['ok']:
        open(OUTPUT_PATH, 'w').write(json.dumps(report, ensure_ascii=False, indent=2))
        print(OUTPUT_PATH)
        return
    token = login['body'].get('data', {}).get('token')
    err, context = pick_class_context(token)
    report['context_probe_error'] = err
    report['context'] = context
    if err or not context:
        open(OUTPUT_PATH, 'w').write(json.dumps(report, ensure_ascii=False, indent=2))
        print(OUTPUT_PATH)
        return

    before_resp, before_count = get_warning_count(token)
    report['warning_count_before'] = {'response': before_resp, 'count': before_count}

    created = create_session(token, context)
    report['create_session'] = created
    if not created['ok']:
        open(OUTPUT_PATH, 'w').write(json.dumps(report, ensure_ascii=False, indent=2))
        print(OUTPUT_PATH)
        return

    session_id = str(((created['body'].get('data') or {}).get('session_id')) or ((created['body'].get('data') or {}).get('id')) or '').strip()
    report['session_id'] = session_id
    if not session_id:
        report['single_end_session'] = {
            'ok': False,
            'status': 0,
            'duration_ms': 0,
            'body': {'error': 'create session response missing session_id/id'},
            'path': '/attendance/sessions/:id/end',
            'method': 'POST',
        }
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(OUTPUT_PATH)
        return

    end_resp = request('POST', '/attendance/sessions/{0}/end'.format(session_id), token=token)
    report['single_end_session'] = end_resp

    polls = []
    first_growth_second = None
    for sec in range(POLL_SECONDS + 1):
        polled, count = get_warning_count(token)
        polls.append({'second': sec, 'count': count, 'response': polled})
        if first_growth_second is None and before_count is not None and count is not None and count > before_count:
            first_growth_second = sec
            break
        time.sleep(1)
    report['warning_visibility_polls'] = polls
    report['first_growth_second'] = first_growth_second

    pressure = pressure_end_session(token, session_id)
    report['end_session_pressure_same_session'] = pressure

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(OUTPUT_PATH)


if __name__ == '__main__':
    main()
