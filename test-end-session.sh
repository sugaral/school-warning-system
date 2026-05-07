#!/bin/bash
# 测试签到结束速度
set -e

BASE="http://localhost:3000"

echo "=== 1. 登录 ==="
TOKEN=$(curl -s "$BASE/auth/login_admin" \
  -H "Content-Type: application/json" \
  -d '{"account":"12345678911","password":"ws12345678911"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token','') or d.get('data',{}).get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "登录失败，响应:"
  curl -s "$BASE/auth/login_admin" \
    -H "Content-Type: application/json" \
    -d '{"account":"12345678911","password":"ws12345678911"}'
  exit 1
fi
echo "登录成功 token=${TOKEN:0:30}..."

echo ""
echo "=== 2. 创建测试签到 (batch-create) ==="
BATCH_RESP=$(curl -s "$BASE/attendance/sessions/batch-create" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count":1}')
echo "$BATCH_RESP" | python3 -m json.tool 2>/dev/null || echo "$BATCH_RESP"

SESSION_ID=$(echo "$BATCH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); ids=d.get('data',{}).get('session_ids',[]); print(ids[0] if ids else '')" 2>/dev/null)
echo "签到ID: $SESSION_ID"

if [ -z "$SESSION_ID" ]; then
  echo "无法创建签到"
  exit 1
fi

echo ""
echo "=== 3. 结束签到 (计时) ==="
START_MS=$(python3 -c "import time; print(int(time.time()*1000))")

END_RESP=$(curl -s "$BASE/attendance/sessions/$SESSION_ID/end" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

END_MS=$(python3 -c "import time; print(int(time.time()*1000))")
ELAPSED=$((END_MS - START_MS))

echo "API 响应:"
echo "$END_RESP" | python3 -m json.tool 2>/dev/null || echo "$END_RESP"

echo ""
echo "=========================================="
echo "  结束签到 API 耗时: ${ELAPSED}ms"
echo "=========================================="

echo ""
echo "=== 4. 等待3秒后检查后端日志 ==="
sleep 3
echo "--- 签到结束相关日志 ---"
docker logs warnsys-backend --since 30s 2>&1 | grep -E "endSession|fast|async|finalize|批量优化|预警.*完成|预警.*耗时|session.*ended" | tail -20

echo ""
echo "=== 5. 检查预警生成日志 ==="
docker logs warnsys-backend --since 30s 2>&1 | grep -E "预警.*学生|预警.*批量|预警.*完成|generateWarning" | tail -10

echo ""
echo "=== 测试完成 ==="
