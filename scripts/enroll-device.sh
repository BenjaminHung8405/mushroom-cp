#!/usr/bin/env bash
##
## Enroll a single ESP32 device into EMQX + Postgres device registry.
##
## Usage:
##   DEVICE_PSK='...' ./scripts/enroll-device.sh <device_id> [house_id]
##
## Requirements:
##   - docker compose stack running (mushroom_mqtt, mushroom_db)
##   - root .env with EMQX_ADMIN_*, POSTGRES_*, EMQX_DASHBOARD_PORT
##
## Security:
##   - DEVICE_PSK is read from the environment only (never positional).
##   - PSK is never printed to stdout/stderr.
##   - Do NOT put PSK in NEXT_PUBLIC_* or frontend env files.
##
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

DEVICE_ID="${1:-}"
HOUSE_ID="${2:-house_01}"
HOUSE_NAME="${HOUSE_NAME:-Nha nam ${HOUSE_ID}}"
DISPLAY_NAME="${DISPLAY_NAME:-ESP32 ${DEVICE_ID}}"
# Escape single quotes for safe SQL interpolation.
HOUSE_NAME_ESC="${HOUSE_NAME//\'/\'\'}"
DISPLAY_NAME_ESC="${DISPLAY_NAME//\'/\'\'}"
DEVICE_PSK="${DEVICE_PSK:-}"

if [ -z "$DEVICE_ID" ]; then
  echo "Usage: DEVICE_PSK='...' $0 <device_id> [house_id]" >&2
  exit 1
fi

if ! printf '%s' "$DEVICE_ID" | grep -Eq '^[a-zA-Z0-9_-]{1,50}$'; then
  echo "[ERROR] device_id must match [a-zA-Z0-9_-]{1,50}" >&2
  exit 1
fi

if ! printf '%s' "$HOUSE_ID" | grep -Eq '^[a-zA-Z0-9_-]{1,50}$'; then
  echo "[ERROR] house_id must match [a-zA-Z0-9_-]{1,50}" >&2
  exit 1
fi

if [ -z "$DEVICE_PSK" ]; then
  echo "[ERROR] DEVICE_PSK env var is required (and must be non-empty)." >&2
  echo "        Example: DEVICE_PSK='secret' $0 mushroom_s3_aabbccddeeff" >&2
  exit 1
fi

EMQX_HOST="${EMQX_HOST:-localhost}"
EMQX_DASHBOARD_PORT="${EMQX_DASHBOARD_PORT:-18083}"
EMQX_API="http://${EMQX_HOST}:${EMQX_DASHBOARD_PORT}/api/v5"
EMQX_ADMIN_USER="${EMQX_ADMIN_USER:-admin}"
EMQX_ADMIN_PASS="${EMQX_ADMIN_PASS:-admin_mushroom_2026}"

POSTGRES_USER="${POSTGRES_USER:-mushroom_user}"
POSTGRES_DB="${POSTGRES_DB:-mushroom_iot_db}"
DB_CONTAINER="${DB_CONTAINER:-mushroom_db}"

echo "=========================================="
echo "  Enroll device"
echo "  device_id : ${DEVICE_ID}"
echo "  house_id  : ${HOUSE_ID}"
echo "=========================================="

## ── 1. EMQX JWT ────────────────────────────────────────────────────────
echo "[1/3] Obtaining EMQX admin token..."
TOKEN="$(
  curl -sS -X POST "${EMQX_API}/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"${EMQX_ADMIN_USER}\", \"password\": \"${EMQX_ADMIN_PASS}\"}" \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true
)"

if [ -z "$TOKEN" ]; then
  echo "[ERROR] Failed to obtain EMQX Bearer token." >&2
  echo "        Check EMQX_ADMIN_USER / EMQX_ADMIN_PASS and dashboard port ${EMQX_DASHBOARD_PORT}." >&2
  exit 1
fi
AUTH_HEADER="Authorization: Bearer ${TOKEN}"
echo "[OK] EMQX token obtained."

## ── 2. EMQX MQTT user upsert ───────────────────────────────────────────
echo "[2/3] Upserting EMQX MQTT user (password from DEVICE_PSK)..."
EMQX_USER_PAYLOAD="$(DEVICE_ID="$DEVICE_ID" DEVICE_PSK="$DEVICE_PSK" python3 - <<'PY'
import json
import os
print(json.dumps({"user_id": os.environ["DEVICE_ID"], "password": os.environ["DEVICE_PSK"]}))
PY
)"
HTTP_STATUS="$(
  curl -sS -o /dev/null -w "%{http_code}" -X POST \
    "${EMQX_API}/authentication/password_based%3Abuilt_in_database/users" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "${EMQX_USER_PAYLOAD}"
)"

case "$HTTP_STATUS" in
  200|201)
    echo "  [CREATED] EMQX user ${DEVICE_ID}"
    ;;
  409)
    EMQX_PASSWORD_PAYLOAD="$(DEVICE_PSK="$DEVICE_PSK" python3 - <<'PY'
import json
import os
print(json.dumps({"password": os.environ["DEVICE_PSK"]}))
PY
)"
    PUT_STATUS="$(
      curl -sS -o /dev/null -w "%{http_code}" -X PUT \
        "${EMQX_API}/authentication/password_based%3Abuilt_in_database/users/${DEVICE_ID}" \
        -H "${AUTH_HEADER}" \
        -H "Content-Type: application/json" \
        -d "${EMQX_PASSWORD_PAYLOAD}"
    )"
    if [ "$PUT_STATUS" != "200" ] && [ "$PUT_STATUS" != "201" ]; then
      echo "[ERROR] EMQX user exists but password update failed (HTTP ${PUT_STATUS})." >&2
      exit 1
    fi
    echo "  [UPDATED] EMQX user ${DEVICE_ID}"
    ;;
  *)
    echo "[ERROR] EMQX create user failed (HTTP ${HTTP_STATUS})." >&2
    exit 1
    ;;
esac

## ── 3. Postgres registry upsert ────────────────────────────────────────
echo "[3/3] Upserting Postgres device registry..."

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  echo "[ERROR] DB container '${DB_CONTAINER}' is not running." >&2
  exit 1
fi

SQL_OUT="$(
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA <<SQL
BEGIN;

INSERT INTO mushroom_houses (id, name)
VALUES ('${HOUSE_ID}', '${HOUSE_NAME_ESC}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO devices (
  device_id,
  house_id,
  enabled,
  display_name,
  mqtt_username
) VALUES (
  '${DEVICE_ID}',
  '${HOUSE_ID}',
  TRUE,
  '${DISPLAY_NAME_ESC}',
  '${DEVICE_ID}'
)
ON CONFLICT (device_id) DO UPDATE SET
  house_id = EXCLUDED.house_id,
  enabled = EXCLUDED.enabled,
  display_name = EXCLUDED.display_name,
  mqtt_username = EXCLUDED.mqtt_username,
  updated_at = NOW()
RETURNING device_id;

COMMIT;
SQL
)"

RETURNED_ID="$(printf '%s\n' "$SQL_OUT" | tr -d '[:space:]')"
if [ "$RETURNED_ID" != "$DEVICE_ID" ]; then
  echo "[ERROR] SQL upsert did not return device_id=${DEVICE_ID} (got: '${RETURNED_ID}')." >&2
  exit 1
fi
echo "  [OK] devices.device_id=${DEVICE_ID} house_id=${HOUSE_ID}"

echo ""
echo "=========================================="
echo "  Enrollment complete"
echo "  device_id : ${DEVICE_ID}"
echo "  house_id  : ${HOUSE_ID}"
echo ""
echo "  UI env (no secrets):"
echo "    NEXT_PUBLIC_DEVICE_ID=${DEVICE_ID}"
echo "    NEXT_PUBLIC_API_URL=http://localhost:3001"
echo ""
echo "  SoftAP NVS (on device):"
echo "    mqtt_broker=<LAN host IP>"
echo "    mqtt_port=18883"
echo "    mqtt_user=<leave blank or ${DEVICE_ID}>"
echo "    mqtt_pass=<same DEVICE_PSK used above>"
echo ""
echo "  Optional cache refresh:"
echo "    docker restart mushroom_backend"
echo "=========================================="
