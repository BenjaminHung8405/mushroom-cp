# Kế hoạch kiến trúc: IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning (v2.2)

> **Đồng bộ source ngày 2026-07-21.** Tên thư mục được giữ để không làm hỏng liên kết cũ, nhưng firmware hiện tại **không còn TPC/Slow PWM**. `relay_control::applyDirectOutputs()` biến demand fuzzy thành relay ON/OFF trực tiếp, có hysteresis `0.25 / 0.15`; Core 1 tick mỗi 50 ms và đọc cảm biến mỗi 5 giây. Vì vậy v2.2 không được triển khai tham số `lamp_pwm_cycle_s` hoặc `lamp_min_on_s`.

## 1. Mục tiêu và phạm vi

Xây dựng luồng **khuyến nghị → operator phê duyệt → desired/reported sync** để tinh chỉnh có kiểm soát các tham số fuzzy/direct-relay của từng ESP32-S3. Backend và UI chỉ là control plane; Core 1 luôn là authority cuối cùng của safety và GPIO.

Hệ thống phải:

- Tính KPI từ telemetry có setpoint và trạng thái relay do Edge xác nhận.
- Sinh advisory deterministic, có version ruleset, không tự áp dụng.
- Persist desired/reported state và audit trong PostgreSQL; hỗ trợ thiết bị/WAN offline bằng MQTT QoS 1 + retained desired.
- Chống flash wear, duplicate command/ACK và race Core 0/Core 1.
- Giữ nguyên các interlock hiện hữu: blackout Mist 11:00–13:30 hoặc khi thời gian không usable, bio-bounds, max-ON 3 phút, cooldown 30 giây, lamp over-temperature và mist over-humidity.

### Ngoài phạm vi

- TPC, PWM tần số cao, chu kỳ ON/OFF tối thiểu cho đèn, hoặc thay đổi SSR/phần cứng.
- Tuning blackout, bio threshold (`ThTOP`, `ThBOT`, `HmTOP`, `HmBOT`), pin mapping, manual override hay `SystemProtector`.
- Auto-apply, seasonal/outdoor heuristics và thay đổi crop profile/setpoint trong cùng command tuning.

---

## 2. Hiện trạng cần tôn trọng

| Thành phần | Hiện trạng source | Hướng tích hợp v2.2 |
| --- | --- | --- |
| Firmware control | `core/core1_tasks.cpp`: tick 50 ms; fuzzy/adaptive gain chạy mỗi tick; sensor sample mỗi 5 s. | Dynamic tuning được Core 1 nhận ở đầu tick, áp dụng trước fuzzy/arbitration. Không thêm task điều khiển song song. |
| Relay | `core/actuator_controller.cpp`: direct ON/OFF với hysteresis chung `FUZZY_ON_THRESHOLD=0.25`, `FUZZY_OFF_THRESHOLD=0.15`; active-LOW. | Không gọi GPIO từ MQTT/Core 0 và không mô tả đây là PWM. Nếu cần tuning hysteresis, tách threshold riêng cho Mist thay vì làm thay đổi tất cả relay ngoài ý muốn. |
| Fuzzy/adaptive | `FuzzyController::arbitrateOutputs()` dùng `AdaptiveTuner::GainsPod` (`HLamp`, `HWat`, `Mist`), hard clamp [0,1]. HWat không lắp đặt và luôn OFF. | Chỉ tune scale cho HLamp/Mist; tuyệt đối không thêm HWat vào UI/recommendation. |
| Safety | `SystemProtector` và `hardwareProtectionOverride()` ở Core 1. Time confidence `Uncertain` khiến Mist bị blackout. | Tuning luôn đi trước protector; protector và final GPIO boundary luôn thắng. |
| MQTT | Tenant hiện tại: `{tenant}/esp32/{deviceId}/...`; firmware dùng `PubSubClient`, callback được copy sang `g_network_worker_queue` depth 16. | Không dùng `devices/{deviceId}/...`. Bổ sung topic dedicated vào dispatcher, subscription và ACL HTTP hiện hữu. |
| Config sync sẵn có | Baseline/crop profile đang đi qua `{tenant}/esp32/{id}/down/command`, NVS + queue depth 1 + command ACK; backend có in-memory `configSync`. | Reuse pattern Core 0 persist → Core 1 queue, nhưng dynamic tuning cần Device Shadow **durable** riêng; không thay thế config-sync baseline/profile. |
| Data | PostgreSQL lưu live telemetry + setpoint/context. Influx `mushroom_iot` hiện chỉ được `OfflineSyncService` ghi cho offline burst và thiếu full setpoint/actuator history. | Chưa đủ dữ liệu để suy luận KPI 24h đáng tin cậy. Phải hoàn chỉnh ingestion trước khi tạo Influx Task/recommender. |
| UI | Next.js có selected-device context, same-origin proxy `/api/backend/*`, SSE telemetry/config-sync và `RealTelemetryProvider`. | Thêm panel vào dashboard, reuse selected device + proxy/SSE; không tạo base URL hoặc EventSource độc lập. |

---

## 3. Kiến trúc đích

```text
Edge telemetry (live + offline replay, setpoint + final relay states)
                         |
                         v
          InfluxDB mushroom_iot raw controller history
                         |
                         v
       Influx Task hourly -> mushroom_analytics / kpi_metrics_1h
                         |
                         v
NestJS ControlAnalyticsService -> TuningRecommenderEngine (advisory)
             |                                 |
             v                                 v
 PostgreSQL device_tuning_configurations + tuning_audit_logs
             ^                                 |
             |                    Next.js TuningAdvisoryPanel (approve)
             |                                 |
             +------ MQTT desired, QoS 1, retained ------+
                                                           v
ESP32 Core 0: parse/validate -> durable tuning NVS -> queue depth 1
                                                           v
ESP32 Core 1 tick: adopt tuning -> fuzzy/arbitration -> protector -> direct relay GPIO
                                                           |
             +----- MQTT reported, QoS 1 -----------------+
             v
NestJS transaction: validate ACK -> durable state -> SSE -> UI
             |
             +-- clear retained desired only if it is still newest pending command
```

### Luồng chuẩn

1. UI lấy KPI/recommendation cho `selectedDeviceId`; nếu coverage không đủ, chỉ hiển thị lý do và không cho apply recommendation.
2. Operator xác nhận diff. Backend xác thực device, tạo `command_id` UUID, ghi row `PENDING` + audit trong transaction, rồi publish desired retained QoS 1.
3. Core 0 nhận desired qua worker queue, kiểm tra schema, `device_id`, UUID, kiểu JSON, bounds và điều kiện liên trường.
4. Khi hợp lệ, `TuningConfigManager` chỉ ghi NVS nếu semantic config đổi; sau persistence thành công mới `xQueueOverwrite()` config sang Core 1 và publish reported `ACCEPTED`.
5. Core 1 nhận bản sao POD ở đầu control tick. Fuzzy/direct-relay tạo demand, sau đó manual latch, `SystemProtector`, blackout defense-in-depth và `writeRelays()` quyết định output cuối.
6. Backend chỉ đổi thành `IN_SYNC` khi reported hợp lệ, thuộc đúng device và canonical config khớp desired. SSE phát sau commit.
7. Backend clear retained payload bằng empty retained publish chỉ khi `command_id` vẫn là pending mới nhất của device; ACK cũ không được xóa desired mới.

---

## 4. Contract tuning và MQTT

### 4.1 Tập tham số v1

Các key dưới đây là **contract mới cần được firmware hiện thực**; chúng map vào control path hiện tại, không phải các key `ke_temp`, `ku_lamp`, `lamp_pwm_cycle_s` của bản plan cũ.

| Key | Default | Hard bounds | Áp dụng ở Core 1 |
| --- | ---: | ---: | --- |
| `lamp_gain_scale` | 1.00 | 0.80–1.20 | Nhân demand `HLamp` sau adaptive gain, trước clamp/protector. |
| `mist_gain_scale` | 1.00 | 0.80–1.20 | Nhân demand `Mist` sau adaptive gain, trước clamp/protector. |
| `mist_on_threshold` | 0.25 | 0.20–0.35 | Ngưỡng bật chỉ cho Mist direct relay. |
| `mist_off_threshold` | 0.15 | 0.10–0.20 | Ngưỡng giữ/tắt chỉ cho Mist direct relay. |

Ràng buộc:

- Mọi số phải là JSON number hữu hạn; reject `NaN`, `Infinity`, string number, null và missing key.
- `mist_off_threshold < mist_on_threshold`; không silently clamp remote command.
- `lamp_gain_scale`/`mist_gain_scale` chỉ điều chỉnh demand đã có. Kết quả vẫn clamp `[0,1]`; `SystemProtector` có thể ép relay OFF/ON.
- Hysteresis lamp/fan hiện tại giữ hard-coded `0.25/0.15`; tách helper `resolveBinaryDemand(demand, state, on, off)` để Mist dùng threshold dynamic mà không thay đổi hành vi lamp/fan.
- Một command chứa đầy đủ effective config (snapshot), không phải patch. Điều này đơn giản hóa retained message, recovery và canonical comparison.

### 4.2 MQTT topic theo namespace hiện tại

| Direction | Topic | QoS / retain | Quyền |
| --- | --- | --- | --- |
| Desired | `{tenant}/esp32/{deviceId}/down/tuning/desired` | QoS 1, retain=true | Backend publish; device subscribe/read. |
| Reported | `{tenant}/esp32/{deviceId}/up/tuning/reported` | QoS 1, retain=false | Device publish; backend subscribe/read. |

`{tenant}` là `IOT_TENANT` (mặc định `mushroom`), không hard-code topic hay device ID mẫu.

Mosquitto hiện dùng HTTP ACL (`MqttAuthService`) và backend user là superuser. Bổ sung test ACL để device chỉ có thể đọc/write dưới tenant/device tree của chính nó; backend mới được publish desired. Không dựa vào file `mosquitto.acl` vì runtime đang dùng `mosquitto-go-auth` HTTP backend.

### 4.3 Payload

```json
{
  "schema_version": 1,
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_id": "mushroom_s3_206ef1a",
  "issued_at": "2026-07-21T09:00:00.000Z",
  "config": {
    "lamp_gain_scale": 1.05,
    "mist_gain_scale": 1.00,
    "mist_on_threshold": 0.28,
    "mist_off_threshold": 0.16
  }
}
```

```json
{
  "schema_version": 1,
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_id": "mushroom_s3_206ef1a",
  "status": "ACCEPTED",
  "reason_code": null,
  "reported_config": {
    "lamp_gain_scale": 1.05,
    "mist_gain_scale": 1.00,
    "mist_on_threshold": 0.28,
    "mist_off_threshold": 0.16
  },
  "persisted": true,
  "reported_at": "2026-07-21T09:00:04.000Z"
}
```

`status`: `ACCEPTED`, `REJECTED`, `DUPLICATE`. `REJECTED` dùng reason code ổn định: `INVALID_SCHEMA`, `DEVICE_MISMATCH`, `INVALID_UUID`, `OUT_OF_RANGE`, `CROSS_FIELD_INVALID`, `PERSISTENCE_FAILED`, `CONTROL_QUEUE_UNAVAILABLE`.

---

## 5. Data, analytics và recommender

### 5.1 Điều kiện tiên quyết: complete controller history

Không tạo KPI từ Influx hiện tại vì `OfflineSyncService` chỉ ghi offline records `temperature_c`, `humidity_percent`, `mist_state`, `lamp_state`, `boot_count`, `delta_time_s`; không có setpoint hiệu lực đầy đủ, fan/blackout hay live telemetry.

Trước analytics cần:

1. Tạo `ControlHistoryInfluxWriter` trong backend, subscribe `MqttService.telemetry$`, ghi mọi telemetry live vào bucket `INFLUXDB_BUCKET` (mặc định `mushroom_iot`) với `device_id`, data quality, measured temperature/humidity, Core-1-reported target/source/revision và final relay states.
2. Mở rộng offline schema chỉ khi firmware có thể cung cấp target/revision đáng tin cậy. Nếu không thể backfill, gắn segment offline `data_quality=degraded` và không dùng nó cho RMSE/recommendation; vẫn có thể hiển thị timeline.
3. Chỉ dùng target Core 1 report hoặc crop-profile revision resolvable tại timestamp. Không suy ra setpoint bằng giá trị hiện tại của batch.
4. Cấu hình bucket analytics mới qua biến môi trường `INFLUXDB_ANALYTICS_BUCKET=mushroom_analytics`; không giả định bucket này đã tồn tại trong `docker-compose.yml`. Thêm provisioning/script vận hành tương ứng.

### 5.2 Influx Task và `ControlAnalyticsService`

Task hourly (offset 5 phút) ghi `kpi_metrics_1h`. Mỗi row/tag theo `device_id`, `control_source`, `config_revision` khi có; lưu phần tử gộp được:

- temperature/humidity: `sample_count`, `sum_squared_error`, `min`, `max`, duration threshold;
- relay: `switch_count`, `on_duration_s`, `on_session_count`, `on_duration_sum_s` cho Mist/Lamp;
- coverage: expected vs valid sample count và `data_quality`.

`ControlAnalyticsService` đặt tại `mushroom-backend/src/analytics/services/`, query aggregate cho window 24h/crop batch. Escape Flux string như helper `escapeFluxString()` hiện có; không interpolate raw device ID. RMSE rolling = `sqrt(sum_squared_error / sample_count)`, không average RMSE theo giờ.

KPI v1: `tempRmse`, `humidRmse`, `mistSwitchCountPerHour`, `lampDutyCyclePercent`, `lampAvgOnDurationSec`, `overshootDurationSec`, `undershootDurationSec`, `dataCoveragePercent`. Recommendation bị chặn khi thiếu coverage, target không xác minh, device offline kéo dài hoặc event relay không trusted.

### 5.3 Recommender deterministic

`TuningRecommenderEngine` là pure service có `ruleset_version`, trả `INSUFFICIENT_DATA`/conflict rõ ràng. Rule phải chỉ đề xuất key firmware hỗ trợ:

| Điều kiện đủ dữ liệu | Advisory v1 |
| --- | --- |
| `mistSwitchCountPerHour > 10` | Tăng `mist_on_threshold` một bước nhỏ và/hoặc giảm `mist_off_threshold`, luôn giữ hysteresis hợp lệ. |
| `tempRmse > 1.5` + lamp duty thấp | Tăng `lamp_gain_scale` tối đa 0.05 mỗi recommendation, kẹp bound. |
| `humidRmse > 5.0` và Mist không chattering | Tăng `mist_gain_scale` tối đa 0.05, kẹp bound. |

Không đề xuất cooldown, max ON, TPC/PWM, HWat hoặc parameter chưa có source-of-truth. Recommendation phải lưu KPI snapshot, current config, delta, reason, confidence và expected benefit; sau apply cần observation window trước suggestion kế tiếp.

---

## 6. Backend persistence, API và SSE

### 6.1 PostgreSQL

Thêm migration TypeORM sau `1720656000005-*`, entity/module riêng (`src/tuning/`). `device_id` dùng `VARCHAR(50)` và foreign key `devices(device_id)` đúng với schema hiện tại.

```sql
CREATE TABLE device_tuning_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(50) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  command_id UUID NOT NULL UNIQUE,
  desired_config JSONB NOT NULL,
  reported_config JSONB,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  rejection_reason VARCHAR(64),
  recommendation_snapshot JSONB,
  requested_by VARCHAR(100),
  desired_published_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tuning_config_device_created
  ON device_tuning_configurations (device_id, created_at DESC);
```

Thêm `tuning_audit_logs` (actor/source/reason/ruleset/KPI/before/after/result/timestamp). Dùng UUID tạo bằng ứng dụng nếu deployment chưa provision `pgcrypto`; không giả định `gen_random_uuid()` có sẵn.

`MqttService` cần subscribe reported topic, parse bằng type guard và chuyển sang `TuningConfigurationService`. Không dùng `pendingConfig` Map hoặc `configSync$` in-memory hiện hữu làm source of truth; chúng chỉ phục vụ baseline/crop profile hiện tại.

ACK handling trong DB transaction: lock row theo `command_id`; validate device/status/config canonical; update một lần; phát `tuningSync$` sau commit. Clear retained desired có conditional latest-pending check trong cùng transaction boundary/logical serialization. ACK lạ/sai device chỉ security log, không clear retained topic.

### 6.2 API/UI integration

Thêm `TuningModule`, import vào `AppModule`; không nhồi endpoint mới vào `DeviceController` vốn đang phục vụ manual/setpoint/profile.

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| `GET` | `/devices/:id/analytics/tuning-recommendations` | KPI + advisory theo window. |
| `POST` | `/devices/:id/tuning-configurations` | Confirm config snapshot, idempotency key, tạo desired. |
| `GET` | `/devices/:id/tuning-configurations/latest` | State durable hiện tại. |
| `GET` | `/devices/:id/tuning-history` | Audit theo device. |
| `SSE` | `/devices/:id/tuning-configurations/stream` | Transition durable của tuning. |

Tầng auth hiện tại chưa thể hiện authorization operator/house đầy đủ. Trước khi endpoint approve được public, bổ sung authentication + authorization device/house và actor identity; nếu chưa có, giới hạn endpoints ở môi trường internal/staging, không giả danh `requested_by` từ client.

UI thêm `TuningAdvisoryPanel` vào `app/page.tsx`, reuse `useSelectedDevice`, `RealTelemetryProvider`, `/api/backend/[...path]` và pattern refetch sau SSE reconnect. Hiển thị coverage, diff/bounds, pending/in-sync/rejected/timeout; confirm trước POST; không optimistic success hoặc auto-apply.

---

## 7. Firmware implementation

### 7.1 Component và ownership

| Vị trí | Thay đổi |
| --- | --- |
| `core/models.h` | Thêm POD `DynamicTuningParams` với `command_id[37]`, revision, bốn field config; không dùng `String`/JSON/NVS handle trong queue. |
| `core/tuning_config_manager.{h,cpp}` | Core-0-owned validate, hydrate defaults/NVS, semantic diff, durable duplicate identity, two-slot CRC envelope. |
| `core/system_manager.{h,cpp}` | Khai báo/tạo `g_tuning_config_queue = xQueueCreate(1, sizeof(DynamicTuningParams))` trước task start. |
| `network/mqtt_manager.*`, `protocols/mqtt_callbacks.*` | Subscribe/dispatch desired topic, bounded JSON parse, publish reported topic. Giữ callback nhẹ: chỉ copy queue rồi worker parse. |
| `core/core1_tasks.cpp` | Drain tuning queue đầu `runControlPipelineStep`; giữ local active copy. Apply scale/hysteresis trong control path, trước protector. |
| `core/actuator_controller.*` | Refactor binary resolver để Mist nhận threshold dynamic; lamp/fan behavior mặc định không đổi. |
| `core/storage.*` | Chỉ thêm API nếu shared NVS helpers thực sự hữu ích; không trộn tuning envelope vào baseline/crop-profile key hiện có. |

### 7.2 Persistence/idempotency

`TuningConfigManager` phải:

1. Hydrate record CRC hợp lệ mới nhất trước khi tasks chạy, fallback defaults khi cả hai slot invalid, rồi enqueue initial effective config sau queue creation.
2. Reject trước mọi mutation nếu schema/device/UUID/type/bounds/cross-field invalid.
3. So sánh float epsilon `0.001f`, integer/string exact. Command ID trùng đã persist → không ghi/enqueue lại, reported `DUPLICATE` kèm effective config.
4. Command mới nhưng parameter bằng nhau → persist command identity/revision an toàn để survive reboot; không ghi lại payload config không cần thiết nếu thiết kế envelope cho phép.
5. Chỉ mutate RAM active candidate, `xQueueOverwrite()` và `ACCEPTED` sau durable persistence thành công. Nếu queue unavailable/write lỗi: `REJECTED`, không claim success.

Không dùng `#pragma pack(1)` cho runtime POD. Two-slot record cần version, generation/revision, `DynamicTuningParams` và CRC; boot chọn generation hợp lệ cao nhất.

### 7.3 Bất biến Core 1

```text
drain dynamic tuning queue (tick boundary)
  -> sensor/setpoint + adaptive/fuzzy demand
  -> tuning scale + Mist-only hysteresis
  -> manual latch
  -> direct relay resolution
  -> SystemProtector
  -> final blackout override + direct resolution
  -> digitalWrite(active-LOW SSR)
```

- Core 1 không gọi MQTT/NVS cho tuning và Core 0 không gọi GPIO/control-state Core 1 trực tiếp.
- Blackout và time confidence luôn thắng Mist tuning.
- Protector vẫn thực thi bio-bound, max ON/cooldown và có thể override scaled demand.
- Cấu hình chỉ đổi tại queue-drain boundary; queue depth 1 + `xQueueOverwrite` là chủ ý vì chỉ effective config mới nhất quan trọng.

---

## 8. Kế hoạch 2 sprint

### Sprint 1 — Contract, telemetry completeness và Edge path

| Ngày | Công việc | Done khi |
| --- | --- | --- |
| 1 | Chốt contract/topic/ACL và test fixtures. | Không còn key/TPC topic legacy trong contract. |
| 1–3 | Live controller-history writer + analytics bucket provisioning. | Live records có target/source/revision/final relay; degraded offline được đánh dấu. |
| 2–4 | Firmware POD, NVS two-slot, queue, desired/reported. | Boot recovery, rejection, duplicate và no-write diff test pass. |
| 4–5 | Mist-specific hysteresis + gain scale Core 1. | Default behavior regression pass; protector/blackout vẫn thắng. |
| 5–7 | DB migration/entity/shadow service + MQTT reported handling. | PENDING → IN_SYNC/REJECTED durable, conditional retain-clear test pass. |

### Sprint 2 — Analytics, advisory, UI và E2E

| Ngày | Công việc | Done khi |
| --- | --- | --- |
| 8–9 | Influx Task, `ControlAnalyticsService`, deterministic recommender. | Coverage gate/RMSE aggregation/ruleset tests pass. |
| 9–10 | Authz/actor audit và REST/SSE tuning module. | Endpoint không cho cross-device/anonymous apply. |
| 10–11 | `TuningAdvisoryPanel`, proxy clients, reconnect refetch. | UI không optimistic success và trạng thái durable đúng. |
| 12–13 | Fault injection: offline, retain, ACK duplicate, reboot, corrupt NVS. | Không state drift/unsafe GPIO/flash write thừa. |
| 14 | Staging 24h dry run, rollback drill, release review. | KPI/recommendation được operator review, checklist ký duyệt. |

---

## 9. Acceptance criteria

### Data/backend

- [ ] Không sinh recommendation từ telemetry thiếu target hoặc `data_quality=degraded` nếu coverage trusted không đủ.
- [ ] Hourly aggregate có `sample_count` + `sum_squared_error`; rolling RMSE không average-of-averages.
- [ ] Audit lưu actor, before/after, KPI snapshot, ruleset version, source và outcome.
- [ ] Reported unknown/wrong-device/wrong-config không đổi shadow hay clear retained message.

### MQTT/shadow

- [ ] Offline device nhận đúng desired retained mới nhất tại reconnect.
- [ ] QoS-1 reported lặp chỉ tạo một DB state transition/SSE success.
- [ ] ACK cũ không clear desired mới hơn.
- [ ] Device ACL không đọc/publish topic của device khác; backend publish desired được.

### Firmware/safety

- [ ] Invalid JSON/type/UUID/bounds/cross-field bị `REJECTED` và không đổi RAM/NVS/queue.
- [ ] Duplicate sau reboot nhận diện bằng durable command identity, không reapply/write flash.
- [ ] Config parameter không đổi không tăng flash write counter.
- [ ] Cắt điện giữa hai slot NVS khôi phục record CRC hợp lệ gần nhất hoặc defaults an toàn.
- [ ] Burst desired liên tục không block Core 1, không heap growth/crash và chỉ effective config cuối được active.
- [ ] Hysteresis tuning Mist không làm đổi lamp/fan default thresholds.
- [ ] Blackout, uncertain time, bio-bound, max-ON/cooldown thắng mọi tuning config.

### Rollback

- [ ] UI có factory-safe snapshot được approve; rollback đi qua cùng audit/shadow/ACK flow.
- [ ] Có recovery path reset tuning NVS defaults khi record corrupt; không xóa crop profile, Wi-Fi hoặc provisioning credentials.
- [ ] Rollback drill được thực hiện trên staging trước release.

---

## 10. Rủi ro và nguyên tắc vận hành

1. KPI là correlation, không phải causation; recommendation luôn advisory.
2. Không copy tuning giữa tủ khi chưa so sánh hardware/load/profile.
3. Một command chỉ thay delta tối thiểu; bắt buộc observation window trước recommendation tiếp theo.
4. Không phát hành analytics trước khi complete controller history đã được xác minh; offline partial history không được biến thành RMSE giả.
5. Edge safety là hàng rào cuối: backend, broker, UI hoặc network hỏng không được làm energize relay trái interlock.
