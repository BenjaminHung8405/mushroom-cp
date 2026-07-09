#!/bin/sh
##
## EMQX MQTT User Initialization Script (Fixed for EMQX 5.3.0)
##
## What this script does:
##   1. Waits for EMQX REST API to return HTTP 200 (plain-text endpoint).
##   2. Authenticates via /api/v5/login to get a JWT Bearer token.
##   3. Creates the built-in database authentication backend (idempotent).
##   4. Creates MQTT client accounts for NestJS backend and ESP32-S3 devices.
##   5. Changes the admin dashboard password from default "public" to a secure value.
##
## Lessons learned from EMQX 5.3.0:
##   - /api/v5/status returns plain text, NOT JSON. Use HTTP status code check.
##   - REST API requires JWT Bearer token (not Basic Auth with admin credentials).
##   - EMQX_DASHBOARD__BOOTSTRAP_USER_PASSWORD env var works for initial password.
##   - The authentication backend must be created before adding users to it.
##

EMQX_HOST="${EMQX_HOST:-mushroom-mqtt}"
EMQX_API="http://${EMQX_HOST}:18083/api/v5"

## NOTE: EMQX 5.3.0 default admin password is "public".
## The EMQX_ADMIN_PASS in .env is the TARGET password after this script runs.
## On first boot, we log in with "public", then change the password.
EMQX_ADMIN_USER="${EMQX_ADMIN_USER:-admin}"
EMQX_ADMIN_NEW_PASS="${EMQX_ADMIN_PASS:-changeme_admin_pass}"
EMQX_DEFAULT_PASS="public"  # EMQX 5.3.0 hardcoded default

MQTT_BACKEND_USER="${MQTT_BACKEND_USER:-nestjs_backend}"
MQTT_BACKEND_PASS="${MQTT_BACKEND_PASS:-changeme_backend_pass}"

MQTT_ESP32_USER="${MQTT_ESP32_USER:-esp32_mushroom_s3_01}"
MQTT_ESP32_PASS="${MQTT_ESP32_PASS:-changeme_esp32_pass}"

echo "=========================================="
echo "  EMQX MQTT User Initialization Script"
echo "  EMQX version: 5.3.0"
echo "=========================================="

## ========================================================
## STEP 1: Wait for EMQX HTTP API to be ready
## NOTE: /api/v5/status returns plain text, not JSON.
##       We check for HTTP 200 status code instead.
## ========================================================
echo "[1/4] Waiting for EMQX API to be ready at ${EMQX_API}..."
RETRIES=40
until [ "$(curl -s -o /dev/null -w "%{http_code}" "${EMQX_API}/status")" = "200" ]; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "[ERROR] EMQX did not become ready in time. Exiting."
    exit 1
  fi
  echo "  ... not ready yet, retrying in 5s (${RETRIES} retries left)"
  sleep 5
done
echo "[OK] EMQX API is responding!"

## ========================================================
## STEP 2: Get JWT Bearer token
## Try with the NEW password first (idempotent for re-runs).
## Fall back to default "public" on first boot.
## ========================================================
echo "[2/4] Obtaining JWT Bearer token..."

get_token() {
  local PASSWORD="$1"
  curl -s -X POST "${EMQX_API}/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"${EMQX_ADMIN_USER}\", \"password\": \"${PASSWORD}\"}" \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

# Try the configured password first (handles re-runs after first boot)
TOKEN=$(get_token "${EMQX_ADMIN_NEW_PASS}")
USED_PASSWORD="${EMQX_ADMIN_NEW_PASS}"

# Fall back to default EMQX password (first boot)
if [ -z "$TOKEN" ]; then
  echo "  -> Configured password didn't work, trying EMQX default..."
  TOKEN=$(get_token "${EMQX_DEFAULT_PASS}")
  USED_PASSWORD="${EMQX_DEFAULT_PASS}"
fi

if [ -z "$TOKEN" ]; then
  echo "[ERROR] Failed to obtain Bearer token with both passwords."
  echo "        Check EMQX_ADMIN_USER / EMQX_ADMIN_PASS in your .env file."
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
echo "[OK] Bearer token obtained (logged in as '${EMQX_ADMIN_USER}')."

## ========================================================
## STEP 3: Create Built-in Database Authentication Backend
## This is idempotent — 409 Conflict = already exists, that's fine.
## ========================================================
echo "[3/4] Setting up authentication backend (built_in_database)..."

AUTHN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${EMQX_API}/authentication" \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "mechanism": "password_based",
    "backend": "built_in_database",
    "user_id_type": "username",
    "password_hash_algorithm": {"name": "sha256", "salt_position": "suffix"}
  }')

case "$AUTHN_STATUS" in
  200|201)
    echo "  [CREATED] authentication backend: password_based:built_in_database"
    ;;
  409)
    echo "  [EXISTS]  authentication backend already configured."
    ;;
  *)
    echo "  [ERROR]   HTTP ${AUTHN_STATUS} — could not create authentication backend!"
    exit 1
    ;;
esac

## ========================================================
## STEP 4: Create MQTT User Accounts
## Idempotent: updates password if user already exists (409).
## ========================================================
echo "[4/4] Creating MQTT user accounts..."

create_mqtt_user() {
  local USER_ID="$1"
  local PASSWORD="$2"

  echo "  -> Upserting user: ${USER_ID}"
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    "${EMQX_API}/authentication/password_based%3Abuilt_in_database/users" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\": \"${USER_ID}\", \"password\": \"${PASSWORD}\"}")

  case "$HTTP_STATUS" in
    200|201)
      echo "     [CREATED] ${USER_ID}"
      ;;
    409)
      echo "     [EXISTS]  ${USER_ID} — updating password..."
      curl -s -o /dev/null -X PUT \
        "${EMQX_API}/authentication/password_based%3Abuilt_in_database/users/${USER_ID}" \
        -H "${AUTH_HEADER}" \
        -H "Content-Type: application/json" \
        -d "{\"password\": \"${PASSWORD}\"}"
      echo "     [UPDATED] ${USER_ID}"
      ;;
    *)
      echo "     [ERROR]   HTTP ${HTTP_STATUS} for user ${USER_ID}"
      ;;
  esac
}

create_mqtt_user "${MQTT_BACKEND_USER}"  "${MQTT_BACKEND_PASS}"
create_mqtt_user "${MQTT_ESP32_USER}"    "${MQTT_ESP32_PASS}"

## ========================================================
## STEP 5: Change Admin Dashboard Password (if on first boot)
## ========================================================
if [ "${USED_PASSWORD}" = "${EMQX_DEFAULT_PASS}" ] && [ "${EMQX_ADMIN_NEW_PASS}" != "${EMQX_DEFAULT_PASS}" ]; then
  echo ""
  echo "[5/5] Changing admin dashboard password from default to configured value..."
  CHANGE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${EMQX_API}/users/${EMQX_ADMIN_USER}/change_pwd" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "{\"old_pwd\": \"${EMQX_DEFAULT_PASS}\", \"new_pwd\": \"${EMQX_ADMIN_NEW_PASS}\"}")
  
  if [ "$CHANGE_STATUS" = "200" ]; then
    echo "  [OK] Admin password changed successfully."
  else
    echo "  [WARN] HTTP ${CHANGE_STATUS} — could not change admin password."
    echo "         Please change it manually in the EMQX Dashboard."
  fi
fi

echo ""
echo "=========================================="
echo "  Initialization complete!"
echo "  MQTT accounts ready:"
echo "    Backend : ${MQTT_BACKEND_USER}"
echo "    Device  : ${MQTT_ESP32_USER}"
echo "=========================================="
