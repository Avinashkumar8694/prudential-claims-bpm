#!/usr/bin/env bash
# Builds the production image, starts it against a throw-away Postgres, runs scripts/docker-smoke.mjs, tears everything down.
# Usage (from anywhere): jbpm-engine/scripts/docker-smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NET="orkestr-smoke-$$"; PG="$NET-pg"; ENG="$NET-eng"; PORT="${SMOKE_PORT:-4399}"
cleanup() { docker rm -f "$ENG" "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build -f "$ROOT/jbpm-engine/Dockerfile" -t orkestr-engine:smoke "$ROOT"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_USER=jbpm -e POSTGRES_PASSWORD=jbpm -e POSTGRES_DB=jbpm postgres:16-alpine >/dev/null
ADMIN_PASSWORD="Adm1n-$(openssl rand -hex 6)"
for i in $(seq 1 30); do docker exec "$PG" pg_isready -U jbpm >/dev/null 2>&1 && break; sleep 1; done
docker run -d --name "$ENG" --network "$NET" -p "$PORT:4000" -e STORE=pg -e PG_URL="postgresql://jbpm:jbpm@$PG:5432/jbpm" \
  -e JWT_SECRET="$(openssl rand -hex 24)" -e ADMIN_INITIAL_PASSWORD="$ADMIN_PASSWORD" -e DASHBOARD_URL=http://localhost:4200 orkestr-engine:smoke >/dev/null
for i in $(seq 1 40); do curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null || { docker logs "$ENG" | tail -20; echo "engine did not become healthy"; exit 1; }
BASE_URL="http://localhost:$PORT/api" ADMIN_PASSWORD="$ADMIN_PASSWORD" node "$ROOT/jbpm-engine/scripts/docker-smoke.mjs"
if docker logs "$ENG" 2>&1 | grep -q '"level":"error"'; then docker logs "$ENG" 2>&1 | grep '"level":"error"' | head -3; echo "error lines in the engine log"; exit 1; fi
