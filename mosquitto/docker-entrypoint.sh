#!/bin/sh
set -eu

PASSWD_FILE=/mosquitto/config/passwd
BACKEND_USER="${MQTT_BACKEND_USER:?MQTT_BACKEND_USER is required}"
BACKEND_PASS="${MQTT_BACKEND_PASS:?MQTT_BACKEND_PASS is required}"
DEVICE_USER="${MQTT_ESP32_USER:?MQTT_ESP32_USER is required}"
DEVICE_PASS="${MQTT_ESP32_PASS:?MQTT_ESP32_PASS is required}"

# Rebuild only when the mounted secret source changes. This image entrypoint is
# intentionally simple for a single-farm deployment; production enrollment can
# generate one password file per deployment through the deployment pipeline.
mosquitto_passwd -b -c "$PASSWD_FILE" "$BACKEND_USER" "$BACKEND_PASS"
mosquitto_passwd -b "$PASSWD_FILE" "$DEVICE_USER" "$DEVICE_PASS"
chmod 0600 "$PASSWD_FILE"
chown mosquitto:mosquitto "$PASSWD_FILE"

exec mosquitto -c /mosquitto/config/mosquitto.conf
