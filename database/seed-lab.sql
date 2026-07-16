-- Lab seed for mushroom_houses + devices.
-- No secrets. MQTT PSK lives in EMQX + device NVS only.
--
-- Replace placeholders before running:
--   :device_id  e.g. mushroom_s3_aabbccddeeff
--   :house_id   e.g. house_01
--
-- Example via docker:
--   docker exec -i mushroom_db psql -U mushroom_user -d mushroom_iot_db < database/seed-lab.sql

BEGIN;

INSERT INTO mushroom_houses (id, name)
VALUES ('house_01', 'Nha nam 01')
ON CONFLICT (id) DO NOTHING;

-- Lab example row — update device_id / mqtt_username to the MAC-derived identity.
INSERT INTO devices (
  device_id,
  house_id,
  enabled,
  display_name,
  mqtt_username,
  token
) VALUES (
  'mushroom_s3_a1b2c3d4e5f6',
  'house_01',
  TRUE,
  'ESP32 lab house 01',
  'mushroom_s3_a1b2c3d4e5f6',
  NULL
)
ON CONFLICT (device_id) DO UPDATE SET
  house_id = EXCLUDED.house_id,
  enabled = EXCLUDED.enabled,
  display_name = EXCLUDED.display_name,
  mqtt_username = EXCLUDED.mqtt_username,
  updated_at = NOW();

COMMIT;
