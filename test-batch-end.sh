#!/usr/bin/env bash
set -e
BASE="http://localhost:3000"
TOKEN=$(curl -s -X POST "$BASE/auth/login_admin" -H 'Content-Type: application/json' -d '{"account":"12345678911","password":"${TEST_PASSWORD:?Set TEST_PASSWORD env var}"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)

echo "=== 清空签到 ==="
SESSIONS=$(curl -s "$BASE/attendance/sessions?status=all&pageSize=200" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d.get('data',{}).get('items',d.get('data',[]))
print(','.join(str(s['id']) for s in items[:50]))
" 2>/dev/null)
if [ -n "$SESSIONS" ]; then
  curl -s -X POST "$BASE/attendance/sessions/batch-delete" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"session_ids\":[$SESSIONS]}" > /dev/null
  echo "已清除"
fi

echo ""
echo "=== 创建10个签到 ==="
CREATE=$(curl -s -X POST "$BASE/attendance/sessions/batch-create" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"count":10,"expire_minutes":1}')
IDS=$(echo "$CREATE" | python3 -c "import sys,json; print(','.join(str(x) for x in json.load(sys.stdin)['data']['session_ids']))" 2>/dev/null)
echo "IDs: $IDS"

echo ""
echo "=== 立即批量结束 ==="
START=$(date +%s%3N)
END_RESULT=$(curl -s -X POST "$BASE/attendance/sessions/batch-end" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"session_ids\":[$IDS]}")
END_MS=$(( $(date +%s%3N) - START ))
echo "⏱  耗时: ${END_MS}ms ($(echo "scale=2; $END_MS/1000" | bc)秒)"
echo "结果: $(echo $END_RESULT | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f'请求{d.get(\"requested_count\",\"?\")} 结束{d.get(\"ended_count\",\"?\")}')" 2>/dev/null)"

echo ""
echo "=== 查预警（等5秒）==="
sleep 5
W=$(curl -s "$BASE/admin/warnings?page=1&pageSize=5" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('total',len(d.get('data',[]))))" 2>/dev/null)
echo "预警数: $W"
