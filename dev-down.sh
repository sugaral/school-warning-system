#!/usr/bin/env bash
# ============================================================
#  学业预警系统 · 停止（§12.1 第 5 条）
# ------------------------------------------------------------
#  作用：停止并移除容器，**保留数据卷**（数据库/Redis/MinIO 数据不丢）
#  用法：./dev-down.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "→ 停止并移除容器（保留数据卷）..."
docker compose down --remove-orphans

echo
echo "✅ 已停止。数据卷仍保留："
docker volume ls --filter name=warnsys --format '   {{.Name}}'
echo
echo "   重新启动： ./dev-up.sh --no-build"
echo "   清库重建： ./dev-reset.sh"
