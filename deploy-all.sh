#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC} $*"; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    error "Neither 'docker compose' nor 'docker-compose' is available."
    exit 1
  fi
}

read_env() {
  local key="$1"
  local fallback="${2:-}"
  local env_file="$PROJECT_DIR/.env"

  if [[ ! -f "$env_file" ]]; then
    echo "$fallback"
    return 0
  fi

  local value
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d'=' -f2- || true)"
  if [[ -z "$value" ]]; then
    echo "$fallback"
  else
    echo "$value"
  fi
}

require_prerequisites() {
  command -v docker >/dev/null 2>&1 || {
    error "Docker is required."
    exit 1
  }

  if [[ ! -f "$PROJECT_DIR/.env" ]]; then
    error "Missing $PROJECT_DIR/.env. Copy from .env.example and fill in the values first."
    exit 1
  fi

  if [[ ! -f "$PROJECT_DIR/$COMPOSE_FILE" ]]; then
    error "Compose file '$COMPOSE_FILE' was not found."
    exit 1
  fi
}

wait_for_container() {
  local container_name="$1"
  local timeout_seconds="${2:-180}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if ! docker inspect "$container_name" >/dev/null 2>&1; then
      sleep 2
    else
      local status
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        info "$container_name is $status"
        return 0
      fi
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        error "$container_name is $status"
        docker logs --tail 50 "$container_name" || true
        exit 1
      fi
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      error "Timed out waiting for $container_name"
      docker logs --tail 50 "$container_name" || true
      exit 1
    fi
    sleep 2
  done
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-120}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      info "$url is reachable"
      return 0
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      error "Timed out waiting for $url"
      exit 1
    fi
    sleep 2
  done
}

remove_existing_containers() {
  step "Removing existing warnsys containers"
  compose down --remove-orphans >/dev/null 2>&1 || true
  docker rm -f \
    warnsys-mysql \
    warnsys-redis \
    warnsys-minio \
    warnsys-adminer \
    warnsys-backend \
    warnsys-frontend \
    >/dev/null 2>&1 || true
}

start_infra() {
  step "Starting MySQL, Redis, MinIO, and Adminer"
  compose up -d mysql redis minio adminer

  wait_for_container warnsys-mysql 240
  wait_for_container warnsys-redis 120
  wait_for_container warnsys-minio 180
}

init_minio() {
  step "Ensuring MinIO buckets exist"
  local minio_network
  minio_network="$(
    docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' warnsys-minio 2>/dev/null \
      | head -n 1 | tr -d '\r'
  )"

  if [[ -z "$minio_network" ]]; then
    warn "Could not detect MinIO network. Skipping explicit bucket initialization."
    return 0
  fi

  local minio_user minio_password minio_bucket warning_queue_bucket warning_dlq_bucket
  minio_user="$(read_env MINIO_ROOT_USER "")"
  minio_password="$(read_env MINIO_ROOT_PASSWORD "")"
  minio_bucket="$(read_env MINIO_BUCKET "warnsys-files")"
  warning_queue_bucket="$(read_env WARNING_QUEUE_SNAPSHOT_BUCKET "warnsys-warning-queue")"
  warning_dlq_bucket="$(read_env WARNING_QUEUE_DLQ_BUCKET "warnsys-warning-dlq")"

  if ! docker run --rm \
    --network "$minio_network" \
    --entrypoint /bin/sh \
    -e MINIO_ROOT_USER="$minio_user" \
    -e MINIO_ROOT_PASSWORD="$minio_password" \
    -e MINIO_BUCKET="$minio_bucket" \
    -e WARNING_QUEUE_SNAPSHOT_BUCKET="$warning_queue_bucket" \
    -e WARNING_QUEUE_DLQ_BUCKET="$warning_dlq_bucket" \
    minio/mc:RELEASE.2025-04-16T18-13-26Z \
    -ec '
      until /usr/bin/mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
        sleep 2
      done
      /usr/bin/mc mb --ignore-existing local/"$MINIO_BUCKET"
      /usr/bin/mc mb --ignore-existing local/"$WARNING_QUEUE_SNAPSHOT_BUCKET"
      /usr/bin/mc mb --ignore-existing local/"$WARNING_QUEUE_DLQ_BUCKET"
    '; then
    warn "MinIO bucket initialization failed. Continuing because the backend will retry bucket creation on startup."
  fi
}

run_migrations() {
  step "Running Prisma migrations"
  compose build migrate >/dev/null
  compose run --rm migrate
}

deploy_backend() {
  start_infra
  init_minio
  run_migrations

  step "Building and starting backend"
  compose build backend
  compose up -d backend
  wait_for_container warnsys-backend 180

  local backend_port
  backend_port="$(read_env BACKEND_PORT 3000)"
  wait_for_http "http://127.0.0.1:${backend_port}/health" 180
}

deploy_frontend() {
  step "Building and starting frontend"
  compose build frontend
  compose up -d frontend
  wait_for_container warnsys-frontend 180

  local frontend_port
  frontend_port="$(read_env FRONTEND_PORT 8080)"
  wait_for_http "http://127.0.0.1:${frontend_port}" 180
}

deploy_full_stack() {
  remove_existing_containers
  start_infra
  init_minio

  step "Building images"
  compose build backend frontend migrate >/dev/null

  run_migrations

  step "Starting backend and frontend"
  compose up -d backend frontend
  wait_for_container warnsys-backend 180
  wait_for_container warnsys-frontend 180

  local backend_port frontend_port
  backend_port="$(read_env BACKEND_PORT 3000)"
  frontend_port="$(read_env FRONTEND_PORT 8080)"
  wait_for_http "http://127.0.0.1:${backend_port}/health" 180
  wait_for_http "http://127.0.0.1:${frontend_port}" 180
}

show_status() {
  compose ps
  echo
  echo "URLs:"
  echo "  Frontend: http://127.0.0.1:$(read_env FRONTEND_PORT 8080)"
  echo "  Backend:  http://127.0.0.1:$(read_env BACKEND_PORT 3000)/health"
  echo "  Adminer:  http://127.0.0.1:$(read_env ADMINER_PORT 8081)"
  echo "  MinIO:    http://127.0.0.1:$(read_env MINIO_API_PORT 9100)"
  echo "  Console:  http://127.0.0.1:$(read_env MINIO_CONSOLE_PORT 9101)"
}

show_logs() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    compose logs -f "$service"
  else
    compose logs -f
  fi
}

restart_services() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    compose restart "$service"
  else
    compose restart
  fi
}

stop_services() {
  compose down
}

show_help() {
  cat <<'EOF'
Usage: ./deploy-all.sh [command]

Commands:
  up         Remove old containers, recreate the full stack, and wait until frontend/backend are ready (default)
  infra      Start MySQL, Redis, MinIO, and Adminer only
  backend    Deploy backend only (includes infra, MinIO init, and migrations)
  frontend   Deploy frontend only
  migrate    Run MinIO bucket init and Prisma migrations
  status     Show current compose status and service URLs
  logs       Follow compose logs
  logs svc   Follow logs for one service, e.g. ./deploy-all.sh logs backend
  restart    Restart all services
  down       Stop the compose stack
  help       Show this help text
EOF
}

main() {
  require_prerequisites
  cd "$PROJECT_DIR"

  case "${1:-up}" in
    up)
      deploy_full_stack
      show_status
      ;;
    infra)
      start_infra
      show_status
      ;;
    backend)
      deploy_backend
      show_status
      ;;
    frontend)
      deploy_frontend
      show_status
      ;;
    migrate)
      start_infra
      init_minio
      run_migrations
      ;;
    status)
      show_status
      ;;
    logs)
      show_logs "${2:-}"
      ;;
    restart)
      restart_services "${2:-}"
      ;;
    down)
      stop_services
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      error "Unknown command: ${1}"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
