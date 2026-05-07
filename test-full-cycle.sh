#!/bin/bash
# 完整测试：创建签到 → 结束签到 → 检查预警 → 删除签到 → 验证预警清理
set -e

BASE="http://localhost:3000"
TOKEN=$(curl -s "$BASE/auth/login_admin" \
  -H "Content-Type: application/json" \
  -d '{"account":"12345678911","password":"ws12345678911"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('token','') or d.get('data',{}).get('access_token',''))")
echo "登录成功"

# 记录删除前的预警总数
BEFORE=$(curl -s "$BASE/warnings?page=1&pageSize=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('total',0))" 2>/dev/null)
echo "删除前预警总数: $BEFORE"

# 创建签到
BATCH=$(curl -s "$BASE/attendance/sessions/batch-create" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"count":1}')
SID=$(echo "$BATCH" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['session_ids'][0])")
echo "=== 1. 创建签到 ID=$SID ==="

# 结束签到（计时）
START=$(python3 -c "import time; print(int(time.time()*1000))")
END=$(curl -s "$BASE/attendance/sessions/$SID/end" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
ELAPSED=$(( $(python3 -c "import time; print(int(time.time()*1000))") - START ))
echo "=== 2. 结束签到 耗时=${ELAPSED}ms ==="
echo "$END" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  学生数={d[\"data\"][\"affectedStudents\"]}')" 2>/dev/null

# 检查预警
sleep 2
AFTER_END=$(curl -s "$BASE/warnings?page=1&pageSize=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('total',0))" 2>/dev/null)
CREATED=$((AFTER_END - BEFORE))
echo "=== 3. 结束后预警: $AFTER_END (新增 $CREATED) ==="

# 删除签到
echo "=== 4. 删除签到 ID=$SID ==="
DEL=$(curl -s "$BASE/attendance/sessions/$SID" -X DELETE \
  -H "Authorization: Bearer $TOKEN")
DELETED=$(echo "$DEL" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['deleted_warnings_count'])" 2>/dev/null)
echo "  删除的预警数: $DELETED"

# 检查删除后预警
sleep 2
AFTER_DEL=$(curl -s "$BASE/warnings?page=1&pageSize=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('total',0))" 2>/dev/null)
echo "=== 5. 删除后预警: $AFTER_DEL ==="

# 数据库检查
echo "=== 6. 数据库 ==="
docker exec warnsys-mysql mysql -uroot -pf20c6f5fa6e763cd warnsys -e "
SELECT 'class_sessions' as tbl, COUNT(*) as cnt FROM class_sessions
UNION ALL SELECT 'attendance_records', COUNT(*) FROM attendance_records
UNION ALL SELECT 'warnings', COUNT(*) FROM warnings
UNION ALL SELECT 'warning_current_states', COUNT(*) FROM warning_current_states;
" 2>&1 | grep -v Warning

# 结果判断
echo ""
EXPECTED=$((AFTER_END - CREATED))
if [ "$AFTER_DEL" -le "$EXPECTED" ]; then
  echo "=========================================="
  echo "  ✅ 测试通过"
  echo "  结束前: $BEFORE"
  echo "  结束后: $AFTER_END (新增 $CREATED)"
  echo "  删除后: $AFTER_DEL (删除 $DELETED)"
  echo "=========================================="
else
  echo "=========================================="
  echo "  ❌ 测试失败"
  echo "  预期删除后 <= $EXPECTED, 实际 $AFTER_DEL"
  echo "=========================================="
fi
