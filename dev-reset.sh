#!/usr/bin/env bash
# ============================================================
#  学业预警系统 · 清库重建（§12.1 第 5 条）
# ------------------------------------------------------------
#  作用：down -v 删除全部数据卷 → 重新构建 → 重新 db push + seed
#  用途：自测反复跑、需要干净初始状态时
#  警告：**会永久删除所有数据**（学生/成绩/预警/上传文件）
#  用法：./dev-reset.sh [--yes]     # --yes 跳过二次确认（供 CI 使用）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SKIP_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=1 ;;
  esac
done

if [ "$SKIP_CONFIRM" -eq 0 ]; then
  echo "⚠️  该操作会删除全部数据卷（数据库、Redis、MinIO 文件），且不可恢复。"
  read -r -p "   确认继续？输入 yes 继续：" ans
  if [ "$ans" != "yes" ]; then
    echo "已取消"
    exit 0
  fi
fi

echo "→ 停止并删除数据卷..."
docker compose down -v --remove-orphans

echo "→ 重新构建镜像..."
docker compose build backend frontend

echo "→ 重新启动（migrate 容器会执行 db push + seed）..."
docker compose up -d

echo "→ 等待就绪..."
DEADLINE=$(( $(date +%s) + 300 ))
while :; do
  UNHEALTHY=$(docker compose ps --format '{{.Name}} {{.State}} {{.Health}}' \
    | awk '$2=="running" && $3!="healthy" && $3!="" {print $1}' | wc -l | tr -d ' ')
  if [ "$UNHEALTHY" -eq 0 ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "⚠ 等待超时" >&2
    docker compose ps >&2
    exit 1
  fi
  sleep 3
done

echo
echo "→ 校验 seed 结果（关键表行数，均应为非 0）..."
docker compose exec -T mysql sh -c '
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -D "$MYSQL_DATABASE" -N -e "
    SELECT \"users\", COUNT(*) FROM users
    UNION ALL SELECT \"classes\", COUNT(*) FROM classes
    UNION ALL SELECT \"student_profiles\", COUNT(*) FROM student_profiles
    UNION ALL SELECT \"courses\", COUNT(*) FROM courses
    UNION ALL SELECT \"warning_rules\", COUNT(*) FROM warning_rules;" 2>/dev/null'

echo
echo "✅ 已重置为干净状态。访问： http://localhost:8080"
echo "   提示：如需演示用的历史考勤/成绩数据（预警引擎需要），执行"
echo "         docker compose exec backend npx ts-node prisma/seed-demo-history.ts"
