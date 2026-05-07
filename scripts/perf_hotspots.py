import json
import statistics
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = 'http://127.0.0.1:3000'
LOGIN = {'account': '12345678911', 'password': 'ws12345678911'}
TARGETS = [
    ('warnings_active', '/warnings?scope=active&page=1&page_size=20'),
    ('warnings_history', '/warnings?scope=history&page=1&page_size=20'),
    ('stats_system', '/admin/stats/system'),
    ('audit_operations', '/admin/audit/operations?page=1&pageSize=20'),
]
CONCURRENCY = [1, 5, 10, 20]
REQUESTS_PER_LEVEL = 40


def login_token():
    payload = json.dumps(LOGIN).encode()
    req = urllib.request.Request(
        BASE + '/auth/login_admin',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode())
    return body['data']['token']


def one_request(path, headers):
    started = time.time()
    req = urllib.request.Request(BASE + path, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
        code = resp.status
    elapsed_ms = (time.time() - started) * 1000
    return code, len(raw), elapsed_ms


def percentile(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    idx = max(0, min(len(sorted_vals) - 1, int(round((len(sorted_vals) - 1) * p))))
    return sorted_vals[idx]


def bench_target(name, path, token):
    headers = {'Authorization': 'Bearer ' + token}
    report = []
    for c in CONCURRENCY:
        latencies = []
        errors = []
        started = time.time()
        with ThreadPoolExecutor(max_workers=c) as pool:
            futures = [pool.submit(one_request, path, headers) for _ in range(REQUESTS_PER_LEVEL)]
            for fut in as_completed(futures):
                try:
                    code, _size, elapsed_ms = fut.result()
                    latencies.append(elapsed_ms)
                    if code >= 400:
                        errors.append(f'http_{code}')
                except Exception as exc:
                    errors.append(type(exc).__name__)
        total_s = max(time.time() - started, 0.001)
        latencies.sort()
        report.append({
            'concurrency': c,
            'requests': REQUESTS_PER_LEVEL,
            'throughput_rps': round(len(latencies) / total_s, 2),
            'avg_ms': round(statistics.mean(latencies), 2) if latencies else None,
            'p50_ms': round(percentile(latencies, 0.50), 2) if latencies else None,
            'p95_ms': round(percentile(latencies, 0.95), 2) if latencies else None,
            'p99_ms': round(percentile(latencies, 0.99), 2) if latencies else None,
            'max_ms': round(max(latencies), 2) if latencies else None,
            'errors': errors,
            'error_count': len(errors),
        })
    return {'name': name, 'path': path, 'levels': report}


def main():
    token = login_token()
    results = []
    for name, path in TARGETS:
        results.append(bench_target(name, path, token))
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
