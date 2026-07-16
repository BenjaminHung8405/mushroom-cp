#!/bin/sh
set -eu

exec /usr/sbin/mosquitto -c /etc/mosquitto/mosquitto.conf
