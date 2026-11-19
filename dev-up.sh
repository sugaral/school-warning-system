#!/usr/bin/env bash
# ============================================================
#  学业预警系统 · 本地一键启动（§12.1 第 4 条）
# ------------------------------------------------------------
#  作用：docker compose up -d --build → 等待 healthy → 打印全部访问地址与账号
#  用法：./dev-up.sh            （首次或代码变更后加 --build 已在脚本内）
#        ./dev-up.sh --no-build （跳过构建，加快重启）
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
  esac
done

# ---------- 0. 前置检查 ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ 未检测到 docker，请先安装 Docker Desktop / Docker Engine" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker 守护进程未运行，请先启动 Docker" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "→ 未找到 .env，从 .env.example 生成"
  cp .env.example .env
fi

# ---------- 1. 构建 ----------
if [ "$NO_BUILD" -eq 0 ]; then
  echo "→ 构建镜像（backend / frontend；worker 复用 backend 镜像）..."
  docker compose build backend frontend
else
  echo "→ 跳过构建（--no-build）"
fi

# ---------- 2. 启动 ----------
echo "→ 启动全栈（依赖顺序由 healthcheck 条件保证）..."
docker compose up -d

# ---------- 3. 等待 healthy ----------
echo "→ 等待服务就绪（最多 300 秒）..."
DEADLINE=$(( $(date +%s) + 300 ))
while :; do
  UNHEALTHY=$(docker compose ps --format '{{.Name}} {{.State}} {{.Health}}' \
    | awk '$2=="running" && $3!="healthy" && $3!="" {print $1}' | wc -l | tr -d ' ')
  NOT_RUNNING=$(docker compose ps --format '{{.Name}} {{.State}}' \
    | awk '$2!="running" && $2!="exited" {print $1}' | wc -l | tr -d ' ')

  if [ "$UNHEALTHY" -eq 0 ] && [ "$NOT_RUNNING" -eq 0 ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "⚠ 等待超时，当前状态：" >&2
    docker compose ps >&2
    echo "  请查看日志：docker compose logs --tail=80 backend worker" >&2
    exit 1
  fi
  sleep 3
done

# ---------- 4. 汇总 ----------
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env | cut -d= -f2 || echo 3000)
FRONTEND_PORT=$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2 || echo 8080)
MINIO_CONSOLE_PORT=$(grep -E '^MINIO_CONSOLE_PORT=' .env | cut -d= -f2 || echo 9101)
ADMINER_PORT=$(grep -E '^ADMINER_PORT=' .env | cut -d= -f2 || echo 8081)
MYSQL_PORT=$(grep -E '^MYSQL_PORT=' .env | cut -d= -f2 || echo 3307)
REDIS_PORT=$(grep -E '^REDIS_PORT=' .env | cut -d= -f2 || echo 6380)

echo
echo "============================================================"
echo " ✅ 学业预警系统已启动"
echo "============================================================"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
echo
echo " 访问地址"
echo "   管理端（前端）   http://localhost:${FRONTEND_PORT}"
echo "   后端 API         http://localhost:${BACKEND_PORT}"
echo "   接口文档         http://localhost:${BACKEND_PORT}/doc.html"
echo "   健康检查         http://localhost:${BACKEND_PORT}/health"
echo "   MinIO 控制台     http://localhost:${MINIO_CONSOLE_PORT}"
echo "   Adminer(DB)      http://localhost:${ADMINER_PORT}"
echo
echo " 默认账号（生产环境务必立即修改）"
echo "   系统管理员       13800138000 / admin123"
echo "   班主任           13800138001 / teacher123"
echo "   学工             13800138003 / staff123"
echo "   学生（示例）     20230003    / Student@2026"
echo
echo " 常用命令"
echo "   查看日志         docker compose logs -f backend worker"
echo "   停止（保留数据） ./dev-down.sh"
echo "   清库重建         ./dev-reset.sh"
echo "============================================================"
