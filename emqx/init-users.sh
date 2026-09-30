#!/bin/sh
##
## EMQX Multi-Tenant MQTT User Initialization Script (EMQX 5.3+)
##
## What this script does:
##   1. Waits for EMQX REST API to return HTTP 200.
##   2. Authenticates via /api/v5/login to get a JWT Bearer token.
##   3. Creates the built-in database authentication backend (idempotent).
##   4. Creates/upserts MQTT user accounts for Mushroom and Aeroponics systems.
##   5. Changes the admin dashboard password if configured.
##

set -e

if [ -z "${EMQX_HOST}" ]; then
  if getent hosts mushroom-mqtt >/dev/null 2>&1 || ping -c 1 -t 1 mushroom-mqtt >/dev/null 2>&1 || ping -c 1 -W 1 mushroom-mqtt >/dev/null 2>&1; then
    EMQX_HOST="mushroom-mqtt"
  else
    EMQX_HOST="localhost"
  fi
fi
EMQX_API="http://${EMQX_HOST}:18083/api/v5"

EMQX_ADMIN_USER="${EMQX_ADMIN_USER:-admin}"
EMQX_ADMIN_NEW_PASS="${EMQX_ADMIN_PASS:-admin_mushroom_2026}"
EMQX_DEFAULT_PASS="public"

# Mushroom credentials
MQTT_MUSHROOM_USER="${MQTT_BACKEND_USER:-nestjs_backend}"
MQTT_MUSHROOM_PASS="${MQTT_BACKEND_PASS:-backend@123}"
MQTT_MUSHROOM_BOOTSTRAP_USER="${MQTT_BOOTSTRAP_USER:-provision_node}"
MQTT_MUSHROOM_BOOTSTRAP_PASS="${MQTT_BOOTSTRAP_SECRET:-pass@123}"
MQTT_MUSHROOM_ESP32_USER="${MQTT_ESP32_USER:-mushroom_s3_206ef1a1d324}"
MQTT_MUSHROOM_ESP32_PASS="${MQTT_ESP32_PASS:-b55f5baf-21d4-4ee4-b37f-05945a0f8464}"

# Aeroponics credentials
MQTT_AERO_BACKEND_USER="${MQTT_AERO_BACKEND_USER:-aero_backend}"
MQTT_AERO_BACKEND_PASS="${MQTT_AERO_BACKEND_PASS:-123456}"
MQTT_AERO_ADMIN_USER="${MQTT_ADMIN_USER:-mqtt_admin}"
MQTT_AERO_ADMIN_PASS="${MQTT_ADMIN_PASS:-123456}"
MQTT_AERO_CLIENT_USER="${MQTT_AERO_CLIENT_USER:-aero_client}"
MQTT_AERO_CLIENT_PASS="${MQTT_AERO_CLIENT_PASS:-123456}"
MQTT_AERO_DEVICE_USER="${MQTT_DEVICE_USER:-esp32_device}"
MQTT_AERO_DEVICE_PASS="${MQTT_DEVICE_PASS:-123456}"
MQTT_AERO_GATEWAY_USER="aero_s3_b81f3fbbcf3c"
MQTT_AERO_GATEWAY_PASS="123456"
MQTT_AERO_FIELD_USER="aero_s3_b81f3fb9a09c"
MQTT_AERO_FIELD_PASS="123456"

# Tuya Bridge dedicated accounts
MQTT_TUYA_BRIDGE_USER="tuya_bridge"
MQTT_TUYA_BRIDGE_PASS="123456"
MQTT_TUYA_SENSOR_USER="tuya_bridge_ph-w218-01"
MQTT_TUYA_SENSOR_PASS="123456"

echo "=========================================="
echo "  EMQX Multi-Tenant User Initialization"
echo "=========================================="

## ========================================================
## STEP 1: Wait for EMQX HTTP API to be ready
## ========================================================
echo "[1/4] Waiting for EMQX API to be ready at ${EMQX_API}..."
RETRIES=40
until [ "$(curl -s -o /dev/null -w "%{http_code}" "${EMQX_API}/status")" = "200" ]; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "[ERROR] EMQX did not become ready in time. Exiting."
    exit 1
  fi
  echo "  ... not ready yet, retrying in 3s (${RETRIES} retries left)"
  sleep 3
done
echo "[OK] EMQX API is responding!"

## ========================================================
## STEP 2: Get JWT Bearer token
## ========================================================
echo "[2/4] Obtaining JWT Bearer token..."

get_token() {
  local PASSWORD="$1"
  curl -s -X POST "${EMQX_API}/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"${EMQX_ADMIN_USER}\", \"password\": \"${PASSWORD}\"}" \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

TOKEN=$(get_token "${EMQX_ADMIN_NEW_PASS}")
USED_PASSWORD="${EMQX_ADMIN_NEW_PASS}"

if [ -z "$TOKEN" ]; then
  echo "  -> Trying EMQX default password..."
  TOKEN=$(get_token "${EMQX_DEFAULT_PASS}")
  USED_PASSWORD="${EMQX_DEFAULT_PASS}"
fi

if [ -z "$TOKEN" ]; then
  echo "[ERROR] Failed to obtain Bearer token with both passwords."
  exit 1
fi

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
echo "[OK] Bearer token obtained (logged in as '${EMQX_ADMIN_USER}')."

## ========================================================
## STEP 3: Create Built-in Database Authentication Backend
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
## ========================================================
echo "[4/4] Creating / Updating MQTT user accounts..."

upsert_mqtt_user() {
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

# Mushroom Accounts
upsert_mqtt_user "${MQTT_MUSHROOM_USER}"            "${MQTT_MUSHROOM_PASS}"
upsert_mqtt_user "${MQTT_MUSHROOM_BOOTSTRAP_USER}"  "${MQTT_MUSHROOM_BOOTSTRAP_PASS}"
upsert_mqtt_user "${MQTT_MUSHROOM_ESP32_USER}"      "${MQTT_MUSHROOM_ESP32_PASS}"

# Aeroponics Accounts
upsert_mqtt_user "${MQTT_AERO_BACKEND_USER}"        "${MQTT_AERO_BACKEND_PASS}"
upsert_mqtt_user "${MQTT_AERO_ADMIN_USER}"          "${MQTT_AERO_ADMIN_PASS}"
upsert_mqtt_user "${MQTT_AERO_CLIENT_USER}"         "${MQTT_AERO_CLIENT_PASS}"
upsert_mqtt_user "${MQTT_AERO_DEVICE_USER}"         "${MQTT_AERO_DEVICE_PASS}"
upsert_mqtt_user "${MQTT_AERO_GATEWAY_USER}"        "${MQTT_AERO_GATEWAY_PASS}"
upsert_mqtt_user "${MQTT_AERO_FIELD_USER}"          "${MQTT_AERO_FIELD_PASS}"

# Tuya Bridge Accounts
upsert_mqtt_user "${MQTT_TUYA_BRIDGE_USER}"         "${MQTT_TUYA_BRIDGE_PASS}"
upsert_mqtt_user "${MQTT_TUYA_SENSOR_USER}"         "${MQTT_TUYA_SENSOR_PASS}"

## ========================================================
## STEP 5: Change Admin Dashboard Password (if first boot)
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
  fi
fi

echo ""
echo "=========================================="
echo "  EMQX Initialization complete!"
echo "  All Mushroom, Aeroponics & Tuya accounts provisioned."
echo "=========================================="
