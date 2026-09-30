#!/usr/bin/env bash
# Diagnostic script: xác định tại sao mushroom-mqtt bị unhealthy
# Chạy trên host VM:  bash scripts/mqtt-healthcheck.sh
set -uo pipefail

cd "$(dirname "$0")/.."

echo "===== 1. Docker service status ====="
docker compose ps mushroom-backend mushroom-mqtt

echo
echo "===== 2. Backend HTTP /health ====="
curl -sS -m 5 http://localhost:6002/api/backend/health || echo "curl failed"
echo

echo
echo "===== 3. Backend directly (container network) ====="
docker exec mushroom_mqtt wget -qO- --timeout=5 http://mushroom-backend:3001/health 2>&1 \
  || docker exec mushroom_mqtt sh -c 'wget -qO- --timeout=5 http://mushroom-backend:3001/health' 2>&1 \
  || echo "backend /health unreachable from mushroom_mqtt"
echo

echo
echo "===== 4. Backend MQTT auth endpoints ====="
for ep in auth superuser acl; do
  code=$(docker exec mushroom_mqtt wget -qS --timeout=5 -O /dev/null \
    --header='Content-Type: application/x-www-form-urlencoded' \
    --post-data='username=probe&password=probe&clientid=probe&topic=probe&acc=1' \
    "http://mushroom-backend:3001/api/mqtt/${ep}" 2>&1 | grep -o 'HTTP/[0-9.]* [0-9]*' | tail -1)
  echo "  /api/mqtt/${ep} -> ${code:-no-response}"
done

echo
echo "===== 5. Backend container logs (last auth/429/connection) ====="
docker compose logs --since=3m mushroom-backend 2>/dev/null \
  | grep -E "429|Throttl|MqttAuth|ECONNREFUSED|listen|Started|error" | tail -30

echo
echo "===== 6. Mosquitto container logs (last 3m) ====="
docker compose logs --since=3m mushroom-mqtt 2>/dev/null | tail -40

echo
echo "===== 7. Healthcheck test (mosquitto_pub as backend user) ====="
docker exec mushroom_mqtt sh -c \
  'mosquitto_pub -h 127.0.0.1 -p 1883 -u "$MQTT_BACKEND_USER" -P "$MQTT_BACKEND_PASS" -t "health/check" -m "ping"' \
  && echo "  PASS: mosquitto_pub succeeded" \
  || echo "  FAIL: mosquitto_pub exit=$?"

echo
echo "===== 8. Auth test: nestjs_backend vs device ====="
docker exec mushroom_mqtt sh -c \
  'mosquitto_pub -h 127.0.0.1 -p 1883 -u "$MQTT_BACKEND_USER" -P "$MQTT_BACKEND_PASS" -t "health/check" -m "x" -d' 2>&1 | tail -5
