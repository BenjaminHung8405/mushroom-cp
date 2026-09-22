-- Seed script for Mushroom CP development / production bootstrap
BEGIN;

INSERT INTO mushroom_houses (id, name, area_meters, pillar_count, created_at)
VALUES ('house_01', 'Nhà nấm thử nghiệm 01', '4x6', 35, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO devices (
  device_id,
  house_id,
  enabled,
  display_name,
  mqtt_username,
  token,
  owner_user_id,
  created_at,
  updated_at
) VALUES (
  'mushroom_s3_206ef1a1d324',
  'house_01',
  TRUE,
  'ESP32 S3 Mushroom Lab',
  'mushroom_s3_206ef1a1d324',
  'b55f5baf-21d4-4ee4-b37f-05945a0f8464',
  '00000000-0000-0000-0000-000000000000',
  NOW(),
  NOW()
)
ON CONFLICT (device_id) DO UPDATE SET
  house_id = EXCLUDED.house_id,
  enabled = EXCLUDED.enabled,
  display_name = EXCLUDED.display_name,
  mqtt_username = EXCLUDED.mqtt_username,
  token = EXCLUDED.token,
  updated_at = NOW();

COMMIT;
