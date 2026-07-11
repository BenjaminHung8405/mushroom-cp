# Mushroom CP — Context Handoff cho Phase 2

> Mục đích: dùng file này làm context khi mở chat mới để tiếp tục Phase 2 (health/stale, enrollment/E2E) mà không cần đọc lại toàn bộ lịch sử.
>
> **Không có secret** trong file này. Đọc `.env` local trực tiếp nếu cần cấu hình thực tế.

## 1. Mục tiêu kiến trúc đã chốt

Luồng production target:

```text
ESP32 Core 1 (edge safety control)
  → EMQX MQTT
  → NestJS (registry cache / TimescaleDB / REST + SSE)
  → Next.js mushroom-ui (read-only telemetry dashboard)
```

Nguyên tắc bắt buộc:

1. **Edge owns safety:** Core 1 tự tính hysteresis ON/OFF relay; backend chỉ gửi advisory target/setpoint. Mất MQTT/backend không được làm mist/heater kẹt ON.
2. **No HTTP reconnect auth:** ESP32 dùng MQTT PSK provisioned trong NVS; không gọi `POST /auth/token` trên reconnect hot path.
3. **Registry O(1):** MQTT ingress lookup `deviceId → houseId` trong in-memory `Map`; DB chỉ bootstrap/cache-miss.
4. **Bucketed history:** UI không được tải raw telemetry 5 giây. Backend dùng TimescaleDB `time_bucket()` theo `Asia/Ho_Chi_Minh`.
5. **One firmware binary:** device ID derive từ MAC hoặc NVS override; không hardcode device ID trong firmware source.

## 2. Git / trạng thái hiện tại

- Branch: `main`
- Phase 0–1 đã commit:
  - `6ac3fd18 feat(iot): add local edge control & device registry`
- Phase 3 UI **đã code nhưng chưa commit** lúc viết handoff này.
- `.env` local đã mở trong IDE; không đưa/commit secret.
- Có sửa local intentional ở `mushroom-iot-firmware/include/config.h`:
  - `DEFAULT_BACKEND_URL` và `DEFAULT_MQTT_BROKER` đang là `192.168.1.136`.
  - Giữ lại nếu đó là IP LAN hiện tại.

Kiểm tra trước khi làm tiếp:

```bash
git status --short
git log --oneline -5
```

## 3. Phase 0–1 đã hoàn thành (commit `6ac3fd18`)

### 3.1 Firmware: identity + PSK

- [config.cpp](mushroom-iot-firmware/src/config.cpp)
  - `resolve_device_identity()`:
    1. ưu tiên `device_id` trong NVS;
    2. fallback `mushroom_s3_<STA MAC lowercase no colon>`;
    3. persist best-effort vào NVS.
  - ép invariant: `MQTT_CLIENT_ID_VAL == MQTT_USER_VAL == deviceId`.
- [storage.cpp](mushroom-iot-firmware/src/storage.cpp), [storage.h](mushroom-iot-firmware/include/storage.h)
  - thêm `save/load/has/clear_device_id`.
- [mqtt_client.cpp](mushroom-iot-firmware/src/mqtt_client.cpp)
  - MQTT connect dùng `MQTT_PASSWORD_VAL` (PSK NVS), không dùng `AUTH_JWT_TOKEN`.
  - reject nếu MQTT username khác client/device ID.
- [wifi_manager.cpp](mushroom-iot-firmware/src/wifi_manager.cpp)
  - Wi-Fi state không còn chờ/fetch JWT từ backend trước khi `STA_CONNECTED`.
  - reconnect Wi-Fi/backend outage không còn tạo `/auth/token` storm.

### 3.2 Firmware: Edge safety controller

- New [local_control.h](mushroom-iot-firmware/include/local_control.h)
- New [local_control.cpp](mushroom-iot-firmware/src/local_control.cpp)

Có:

- advisory setpoint TTL (`120s` default);
- fallback local target: temp `30°C`, RH `80%`, CO₂ `1000 ppm`, min temp `28°C`;
- mist hysteresis `±2%`, `MIST_MAX_ON_MS=120s`, `MIST_MIN_OFF_MS=60s`;
- heater hysteresis `±0.5°C`, max-on `300s`;
- fan dùng temp / CO₂, fail-safe fan ON khi không có cả temp + CO₂;
- current humidity invalid → mist OFF ngay (không reuse stale humidity để tiếp tục phun);
- MQTT raw boolean actuator command bị ignore: Core 1 là authority.

### 3.3 SHT30 defog + WDT

- [sensors.cpp](mushroom-iot-firmware/src/sensors.cpp), [sensors.h](mushroom-iot-firmware/include/sensors.h)
  - expose `is_sht30_defogging()`.
  - heater ON/cooldown đánh dấu sensor biased.
- Core 1 [core1_tasks.cpp](mushroom-iot-firmware/src/core1_tasks.cpp)
  - gọi local control mỗi sensor cycle;
  - defog hold: giữ last output khi heater active + cooldown 30s;
  - explicit `esp_task_wdt_add(nullptr)` + `esp_task_wdt_reset()`;
  - relay output apply qua actuator HAL.

### 3.4 Hardware safety requirement

- New [HARDWARE_DEPLOYMENT.md](mushroom-iot-firmware/HARDWARE_DEPLOYMENT.md)
- Bắt buộc external 10 kΩ pull-down trên GPIO relay 10/11/12/13: firmware LOW sau boot không đủ để tránh boot/reset/brown-in glitch.

### 3.5 Backend device registry + MQTT boundary

- New [device.entity.ts](mushroom-backend/src/device/entities/device.entity.ts)
- New [device-registry.service.ts](mushroom-backend/src/device/device-registry.service.ts)
  - bootstrap load all devices to Map;
  - `get/getEnabled` sync O(1);
  - `refreshOne` single-flight DB cache miss;
  - `touchLastSeen` async/non-blocking.
- New migration [1720656000000-create-devices.ts](mushroom-backend/src/database/migrations/1720656000000-create-devices.ts)
- [schema.sql](database/schema.sql) có bảng `devices` cho database volume mới.
- [mqtt.service.ts](mushroom-backend/src/mqtt/mqtt.service.ts)
  - strict topic `mushroom/device/{deviceId}/{status|telemetry}`;
  - payload <= 1024 bytes;
  - finite canonical metrics only: `temp_air`, `humidity_air`, `co2_level`;
  - unknown/disabled device drop + async cache refresh;
  - event chứa `deviceId`, mapped `houseId`, `receivedAt`.
- [telemetry.service.ts](mushroom-backend/src/telemetry/services/telemetry.service.ts)
  - không còn `houseId = deviceId`;
  - cache/SSE key theo `deviceId`;
  - log TimescaleDB bằng mapped `houseId`;
  - backend publish advisory MQTT setpoint target (`control_mode: edge_hysteresis`, TTL) thay vì direct relay authority.
- [acl.conf](emqx/acl.conf): backend ACL username đã sửa `backend` → `nestjs_backend`.

### 3.6 History API

- [telemetry.params.dto.ts](mushroom-backend/src/telemetry/dto/telemetry.params.dto.ts)
- [telemetry.controller.ts](mushroom-backend/src/telemetry/controllers/telemetry.controller.ts)
- [telemetry.service.ts](mushroom-backend/src/telemetry/services/telemetry.service.ts)

`GET /devices/:deviceId/telemetry/history?from=ISO&to=ISO&bucket=...`

- max range: 7 days;
- buckets allowed: `1 minute`, `5 minutes`, `15 minutes`, `1 hour`, `1 day`;
- default bucket theo query range;
- `time_bucket($1::interval, time AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
- route device ID resolve registry → house ID trước query;
- output aggregate, không raw 5s points.

### 3.7 Validation đã chạy cho Phase 0–1

```bash
pnpm --dir mushroom-backend build
pnpm --dir mushroom-backend test
# 13 suites, 72 tests pass

python3 -m platformio run -e uart -e otg -d mushroom-iot-firmware
# uart + otg pass

git diff --check
# pass
```

## 4. Phase 3 UI — code hiện có, cần commit/check lại

Các file uncommitted UI expected:

- New [telemetry-api.ts](mushroom-ui/lib/telemetry-api.ts)
  - typed REST/SSE client;
  - `fetchTelemetrySnapshot`, `fetchTelemetryHistory`, `subscribeTelemetryStream`, `subscribeDeviceStatusStream`.
- New [real-telemetry-context.tsx](mushroom-ui/lib/real-telemetry-context.tsx)
  - live snapshot + SSE telemetry/status;
  - null state, no fake values;
  - exposes actuator booleans read-only.
- [page.tsx](mushroom-ui/app/page.tsx)
  - dashboard consumes real provider;
  - history chart uses `15 minutes` bucket for 24h;
  - dev sandbox only under `NODE_ENV=development`.
- [sensor-data-card.tsx](mushroom-ui/components/sensor-data-card.tsx)
  - temperature label changed to **Nhiệt độ không khí (SHT30)**;
  - null/empty state.
- [standard-actuators-control.tsx](mushroom-ui/components/standard-actuators-control.tsx)
  - boolean read-only status; no browser PWM/manual relay toggle.
- [header.tsx](mushroom-ui/components/header.tsx), [hardware-telemetry-widget.tsx](mushroom-ui/components/hardware-telemetry-widget.tsx)
  - consume real provider/LWT status.

Phase 3 check run:

```bash
pnpm --dir mushroom-ui build
# pass
```

Dev server was opened at `http://localhost:3000`; `GET /` returned 200.

### IMPORTANT outstanding mismatch (must resolve early in Phase 2)

Firmware identity is now dynamic MAC/NVS, but UI currently has:

```ts
export const DEFAULT_DEVICE_ID = 'esp32_mushroom_s3_01'
```

in [telemetry-api.ts](mushroom-ui/lib/telemetry-api.ts).

Before actual field E2E, replace this with `NEXT_PUBLIC_DEVICE_ID` (recommended) or a device selector/route. `.env.example` already documents `NEXT_PUBLIC_DEVICE_ID`. Do not assume `esp32_mushroom_s3_01` exists after MAC identity migration.

Suggested patch:

```ts
export const DEFAULT_DEVICE_ID =
  process.env.NEXT_PUBLIC_DEVICE_ID ?? 'esp32_mushroom_s3_01'
```

Then set the actual MAC-derived/NVS `device_id` in `mushroom-ui/.env.local` or Docker environment. Do not expose PSK to UI.

### Note on UI API endpoint

The client defaults to `http://localhost:3001` but obeys `NEXT_PUBLIC_API_URL`. Browser cannot resolve the Docker service name `mushroom-backend`; use host/reverse-proxy-reachable URL.

## 5. Phase 2 work to continue

### 5.1 Health / stale semantics (priority)

Goal: distinguish:

| State | Meaning |
|---|---|
| `online` | MQTT LWT says ESP32 connected |
| `offline` | EMQX LWT says disconnected |
| `stale` | LWT may still online but no valid telemetry > 3 publish cycles (15–20 seconds at current 5s cadence) |
| `unknown` | no status/snapshot yet |

Recommended implementation:

1. Backend:
   - Current `DeviceRegistryService.touchLastSeen()` updates last valid MQTT event (`status`/`telemetry`).
   - Add a `lastTelemetryAt` distinction if desired (do not use status timestamp as telemetry freshness).
   - Extend telemetry snapshot/API with `lastTelemetryAt` / freshness metadata OR let UI derive freshness from `snapshot.time`.
   - Consider persistence/registry column only if stale must survive process restart; current in-memory snapshot is enough for MVP UI.
2. UI:
   - In `RealTelemetryProvider`, derive stale with interval/timer:
     ```ts
     Date.now() - new Date(snapshot.time).getTime() > 20_000
     ```
   - Expose `'stale'` status or `isStale` alongside LWT status.
   - Header/hardware widget should show stale separately from offline, e.g. amber “Telemetry stale”.
   - Ensure interval cleanup on unmount.
3. Tests:
   - snapshot under threshold → not stale;
   - snapshot > 20 sec with online status → stale;
   - offline takes priority over stale.

### 5.2 Admin enrollment workflow (Phase 2 — done)

MVP enrollment is an ops script + seed SQL, not a full admin UI.

**Script:** `scripts/enroll-device.sh`

```bash
DEVICE_PSK='unique_secret' ./scripts/enroll-device.sh mushroom_s3_aabbccddeeff [house_01]
```

Steps performed by the script:
1. Login to EMQX REST API using root `.env` admin credentials.
2. Create/update EMQX built-in auth user (`user_id = device_id`, password = PSK).
3. Upsert `mushroom_houses` (if missing) + `devices` row via `docker exec … psql`.
4. Prints `NEXT_PUBLIC_DEVICE_ID=` value for UI env.

**Seed SQL:** `database/seed-lab.sql` — example house + device upsert with no secrets.

Field sequence:
1. Flash identical firmware binary.
2. Read MAC-derived device ID from serial log or SoftAP portal.
3. Run `enroll-device.sh` to provision EMQX user + Postgres registry row.
4. Provision device NVS via SoftAP (Wi-Fi, broker IP, port, PSK).
5. Set `NEXT_PUBLIC_DEVICE_ID` in `mushroom-ui/.env.local` or Docker env.
6. Verify E2E: ESP32 → EMQX → NestJS → TimescaleDB → UI cards.

May add explicit Nest admin endpoint later, but **never** reintroduce `/auth/token` on reconnect.

### 5.3 Transport/security hardening (not done)

- MQTT currently plaintext `mqtt://` on host port 18883. Production needs `mqtts`/TLS, broker cert + ESP32 validation.
- Lock EMQX dashboard 18083 by firewall/VPN/admin allowlist.
- Restrict Nest CORS to known UI origin (check [main.ts](mushroom-backend/src/main.ts)).
- Ensure PSKs/tokens never in logs.

## 6. Phase 4 E2E checklist

Before saying production-ready:

1. Start Docker services:
   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```
2. Ensure migration is applied for an existing DB:
   ```bash
   pnpm --dir mushroom-backend migration:run
   ```
3. Create/verify a real `mushroom_houses` row then a matching `devices` row.
4. Provision board with actual MAC/NVS device ID + unique MQTT PSK.
5. Verify EMQX ACL:
   - device only publishes `mushroom/device/{its-user}/telemetry|status`;
   - device only subscribes its own setpoint;
   - `nestjs_backend` subscribes/publishes expected topics.
6. Verify end-to-end:
   ```text
   ESP32 SHT30 sample
     → EMQX topic
     → NestJS ingress/cache
     → TimescaleDB telemetry_logs
     → GET /devices/:id/telemetry
     → SSE /devices/:id/telemetry/stream
     → mushroom-ui card update
   ```
7. Test disconnect cases:
   - power/wifi loss → LWT offline UI;
   - kill backend/MQTT while mist active → edge max-on/hysteresis turns it off safely;
   - restore router/power → no NestJS auth stampede, direct MQTT reconnect only.
8. Test 24h history endpoint returns ~96 data points at bucket `15 minutes`, not raw 17k rows.
9. Measure same-LAN publish→UI latency target <2 sec after MQTT publish (firmware source cadence remains ~5 sec).

## 7. Known limitations / non-goals

- `fuzzy_engine.cpp` remains empty. Current safety controller is hardcoded hysteresis, intentionally.
- DS18B20/SCD30 firmware paths are mock; only SHT30 is physically implemented.
- No firmware store-and-forward. `receivedAt` is backend receive time; adding offline buffering later requires NTP + `sampled_at` protocol field and clock skew validation.
- UI batch/profile controls remain mostly local simulation; Phase 3 only replaced telemetry/actuator golden path.
- UI lint command fails because `eslint` is not found in installed UI dependencies/environment; UI production build passes.
- Current UI `next.config.mjs` still has `typescript.ignoreBuildErrors: true`; build compiled, but remove this config once type validation is intentionally enabled.

## 8. Recommended first commands in new chat

```bash
# inspect state
git status --short
git log --oneline -5

# make Phase 3 device identity configurable (first code fix)
# edit mushroom-ui/lib/telemetry-api.ts:
# DEFAULT_DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID ?? 'esp32_mushroom_s3_01'

# validate after changes
pnpm --dir mushroom-ui build
pnpm --dir mushroom-backend build
pnpm --dir mushroom-backend test
python3 -m platformio run -e uart -e otg -d mushroom-iot-firmware
```

## 9. Do not lose these operational warnings

- Do not put MQTT PSK in frontend env (`NEXT_PUBLIC_*`).
- Do not revert Core 1 control back to direct MQTT relay queue authority.
- Do not query PostgreSQL once per telemetry packet for device mapping.
- Do not return raw 5-second history data to browser.
- Do not treat retained MQTT `online` as proof sensors are fresh; Phase 2 stale state is required.
- Production relay boards require external pull-down resistors; see [HARDWARE_DEPLOYMENT.md](mushroom-iot-firmware/HARDWARE_DEPLOYMENT.md).
