import json
import statistics
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = 'http://127.0.0.1:3000'
LOGIN = {'account': '12345678911', 'password': 'ws12345678911'}
CONCURRENCY = [1, 5, 10, 20]
REQUESTS_PER_LEVEL = 40


def percentile(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    idx = max(0, min(len(sorted_vals) - 1, int(round((len(sorted_vals) - 1) * p))))
    return sorted_vals[idx]


def post_json(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
        code = resp.status
    elapsed_ms = (time.time() - started) * 1000
    return code, len(body), elapsed_ms


def bench_login():
    report = []
    for c in CONCURRENCY:
        latencies = []
        errors = []
        started = time.time()
        with ThreadPoolExecutor(max_workers=c) as pool:
            futures = [pool.submit(post_json, '/auth/login_admin', LOGIN) for _ in range(REQUESTS_PER_LEVEL)]
            for fut in as_completed(futures):
                try:
                    code, _size, elapsed_ms = fut.result()
                    latencies.append(elapsed_ms)
                    if code >= 400:
                        errors.append('http_%s' % code)
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
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    bench_login()
