# Sprint 1 — Contract, Telemetry Completeness và Edge Path

> **Thời gian:** Ngày 1–7
> **Nguyên tắc:** Không viết code ứng dụng trong tài liệu này. Đây là tài liệu phân rã kỹ thuật thuần túy.

---

## 1. PHẠM VI & MỤC TIÊU

### 1.1 Phạm vi
Sprint 1 tập trung xây dựng nền tảng dữ liệu và luồng điều khiển phần cứng. Các module/component bị tác động trực tiếp:

**Firmware (ESP32-S3):**
- `core/models.h` — Thêm POD struct `DynamicTuningParams`
- `core/tuning_config_manager.h` / `core/tuning_config_manager.cpp` — New file: Core-0-owned validate/persist/dispatch
- `core/system_manager.h` / `core/system_manager.cpp` — Khai báo và khởi tạo `g_tuning_config_queue`
- `network/mqtt_manager.h` / `network/mqtt_manager.cpp` — Subscribe desired topic, publish reported topic
- `protocols/mqtt_callbacks.h` / `protocols/mqtt_callbacks.cpp` — Dispatch desired payload vào worker queue
- `core/core1_tasks.cpp` — Drain tuning queue đầu control tick, apply scale/hysteresis
- `core/actuator_controller.h` / `core/actuator_controller.cpp` — Refactor binary resolver cho Mist threshold dynamic

**Backend (NestJS):**
- `src/influx/services/control-history-influx-writer.service.ts` — New file: subscribe telemetry, ghi InfluxDB
- `src/influx/influx.module.ts` — Import writer service mới
- `src/migrations/1720656000006-CreateDeviceTuningConfigurations.ts` — New migration
- `src/migrations/1720656000007-CreateTuningAuditLogs.ts` — New migration
- `src/tuning/entities/device-tuning-configuration.entity.ts` — New entity
- `src/tuning/entities/tuning-audit-log.entity.ts` — New entity
- `src/tuning/services/tuning-configuration.service.ts` — New service: shadow state management
- `src/tuning/tuning.module.ts` — New module declaration
- `src/mqtt/services/mqtt.service.ts` — Bổ sung subscribe reported topic, route sang TuningConfigurationService

**Infrastructure:**
- `docker-compose.yml` / provisioning scripts — Thêm `INFLUXDB_ANALYTICS_BUCKET=mushroom_analytics`

### 1.2 Mục tiêu Done-Definition của Sprint 1
| # | Done khi |
|---|---|
| S1-1 | Contract/topic/ACL được chốt; không còn key legacy `ke_temp`, `ku_lamp`, `lamp_pwm_cycle_s` trong contract |
| S1-2 | Live records InfluxDB có đủ: target/source/revision/final relay states; offline segments gắn `data_quality=degraded` |
| S1-3 | Firmware: Boot recovery, rejection, duplicate và no-write-if-diff test pass |
| S1-4 | Default lamp/fan behavior regression pass; protector/blackout vẫn thắng Mist hysteresis mới |
| S1-5 | DB migration chạy thành công; `PENDING → IN_SYNC/REJECTED` durable; conditional retain-clear test pass |

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

### 2.1 Luồng Firmware: Desired → Core 1 Apply

```
[MQTT Broker] --QoS1, retained--> [PubSubClient callback (Core 0)]
      |
      | (chỉ copy bytes, không parse)
      v
[g_network_worker_queue] --depth 16--> [Network Worker Task (Core 0)]
      |
      | (bounded JSON parse - ArduinoJson StaticDocument)
      v
[TuningConfigManager::validateAndPersist(payload)]
      |
      +-- [FAIL] validate schema/device/UUID/type/bounds/cross-field
      |       |
      |       v
      |   publish REJECTED reported (QoS 1) → END
      |
      +-- [DUPLICATE] command_id đã persist trong NVS
      |       |
      |       v
      |   publish DUPLICATE reported kèm effective config → END
      |
      +-- [OK] semantic diff check
              |
              +-- [No change in params] persist command identity only (no NVS config rewrite)
              |
              +-- [Changed] write two-slot CRC NVS record
                      |
                      v
              [xQueueOverwrite(g_tuning_config_queue, &params)]
                      |
                      +-- [FAIL] publish REJECTED CONTROL_QUEUE_UNAVAILABLE → END
                      |
                      +-- [OK] publish ACCEPTED reported (QoS 1)

[Core 1 - 50ms tick boundary]
      |
      | (xQueueReceive non-blocking, depth 1)
      v
[drain g_tuning_config_queue → local active DynamicTuningParams copy]
      |
      v
[Read sensor (every 5s) + Setpoint]
      |
      v
[AdaptiveTuner → FuzzyController::arbitrateOutputs()]
      |
      v
[Apply lamp_gain_scale to HLamp demand]
[Apply mist_gain_scale to Mist demand]
      |
      v
[resolveBinaryDemand(mistDemand, mistState, mist_on_threshold, mist_off_threshold)]
      |   ← Mist dùng threshold dynamic; lamp/fan dùng hardcoded 0.25/0.15
      v
[Manual latch check]
      |
      v
[SystemProtector → bio-bound, max-ON 3min, cooldown 30s, over-temp, over-humid]
      |
      v
[Blackout defense + time confidence check]
      |
      v
[writeRelays() → digitalWrite active-LOW SSR GPIO]
```

### 2.2 Luồng Backend: Reported → DB Shadow → SSE

```
[MQTT Broker] --QoS1--> [MqttService.reported$ Observable]
      |
      v
[MqttService: parse type guard TuningReportedPayload]
      |
      +-- [Parse fail / unknown device] → security log → END
      |
      v
[TuningConfigurationService::handleReportedAck(payload)]
      |
      v
[PostgreSQL Transaction BEGIN]
      |
      v
[SELECT ... FOR UPDATE WHERE command_id = payload.command_id]
      |
      +-- [Not found] → log unknown ACK → ROLLBACK → END
      +-- [device_id mismatch] → security log → ROLLBACK → END (không clear retained)
      +-- [Already IN_SYNC / REJECTED] → idempotent: ROLLBACK → END (QoS-1 duplicate)
      |
      v
[Validate canonical config match desired_config vs reported_config]
      |
      +-- [Mismatch] → UPDATE sync_status='REJECTED', rejection_reason='CANONICAL_MISMATCH'
      |
      v
[UPDATE device_tuning_configurations SET sync_status, reported_config, applied_at]
[INSERT tuning_audit_logs (actor, before, after, outcome)]
      |
      v
[Conditional retain-clear check]
      |  (cùng transaction boundary)
      | IF command_id = latest PENDING command of device:
      |   publish empty retained to desired topic (QoS 1, retain=true)
      | ELSE:
      |   skip (ACK cũ không được xóa desired mới hơn)
      |
      v
[COMMIT]
      |
      v
[tuningSync$.next(event)] → SSE push → UI update
```

### 2.3 Luồng InfluxDB: Live Telemetry → Controller History

```
[ESP32 live MQTT telemetry] --subscribe--> [MqttService.telemetry$ Observable]
      |
      v
[ControlHistoryInfluxWriter.onTelemetry(data)]
      |
      v
[Enrich: device_id, data_quality='good', measured temp/humidity,
         Core1-reported target/source/revision, final relay states]
      |
      v
[InfluxDB write API] → bucket: mushroom_iot (INFLUXDB_BUCKET)
      |
      v
[measurement: controller_history]
  tags:   device_id, control_source, data_quality
  fields: temperature_c, humidity_percent, temp_target, humid_target,
          mist_state (bool), lamp_state (bool), fan_state (bool),
          config_revision (uint)

[Offline burst records] → OfflineSyncService (đã có)
      |
      v
  tags: data_quality='degraded' (thiếu target/revision đáng tin cậy)
  → Không dùng cho KPI/recommendation trong Sprint 2
  → Vẫn ghi để display timeline
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

---

### TRACK A — CONTRACT & INFRASTRUCTURE (Ngày 1)

#### A1 — Chốt MQTT topic namespace và ACL contract

> **File tác động:** `docs/contract/mqtt-topics-v2.2.md` (new), `src/mqtt/constants/mqtt-topics.const.ts` (new/modify)

**Tác vụ:**

**A1.1** — Định nghĩa hằng số topic trong backend
- **File:** `src/mqtt/constants/mqtt-topics.const.ts` (new)
- **Hàm/Constant:**
  - `TUNING_DESIRED_TOPIC(tenant: string, deviceId: string): string` — return `${tenant}/esp32/${deviceId}/down/tuning/desired`
  - `TUNING_REPORTED_TOPIC(tenant: string, deviceId: string): string` — return `${tenant}/esp32/${deviceId}/up/tuning/reported`
  - `TUNING_DESIRED_TOPIC_PATTERN: string` — wildcard pattern để subscribe `+/esp32/+/up/tuning/reported`
  - Validate: không hard-code `mushroom` vào constant; đọc từ `IOT_TENANT` env

**A1.2** — Bổ sung test ACL cho HTTP backend
- **File:** `src/mqtt/services/mqtt-auth.service.ts` (modify)
- **Phương thức cần bổ sung:**
  - `validateTuningDesiredPublish(clientId: string, topic: string): boolean` — backend user là superuser → allow; device user chỉ được read desired topic của chính nó
  - `validateTuningReportedPublish(clientId: string, topic: string): boolean` — device chỉ được publish reported của chính nó
  - Thêm test fixtures: `acl.tuning.spec.ts` với 4 case: backend-publish-desired (OK), device-publish-desired (DENY), device-publish-other-device-reported (DENY), device-read-desired (OK)

**A1.3** — Xóa/deprecate các key legacy khỏi mọi interface
- **File:** bất kỳ DTO/interface nào có `lamp_pwm_cycle_s`, `lamp_min_on_s`, `ke_temp`, `ku_lamp`
- Search toàn bộ `src/` và firmware `include/`; đánh dấu `@deprecated` hoặc xóa nếu chưa được dùng trong production

---

#### A2 — InfluxDB Analytics Bucket Provisioning (Ngày 1)

> **File tác động:** `docker-compose.yml` (modify), `scripts/provision-influx.sh` (new)

**A2.1** — Thêm biến môi trường analytics bucket
- **File:** `docker-compose.yml` (modify)
- **Cần làm:**
  - Thêm `INFLUXDB_ANALYTICS_BUCKET=mushroom_analytics` vào environment section của service `backend`
  - Không giả định bucket đã tồn tại; không hardcode bucket name

**A2.2** — Tạo provisioning script
- **File:** `scripts/provision-influx.sh` (new)
- **Hàm/Step:**
  - `create_analytics_bucket()` — dùng InfluxDB CLI/API để tạo bucket `mushroom_analytics` với retention policy phù hợp (default: infinite hoặc configurable qua env `INFLUXDB_ANALYTICS_RETENTION_DAYS`)
  - `verify_bucket_exists(bucket_name)` — idempotent check trước khi create
  - Document: script phải chạy được cả lần đầu (create) và idempotent (skip nếu đã tồn tại)

---

### TRACK B — BACKEND: LIVE CONTROLLER HISTORY WRITER (Ngày 1–3)

#### B1 — ControlHistoryInfluxWriter Service (New)

> **File:** `src/influx/services/control-history-influx-writer.service.ts` (new)

**B1.1** — Định nghĩa interface `LiveTelemetryPoint`
- **File:** `src/influx/interfaces/live-telemetry-point.interface.ts` (new)
- **Interface fields:**
  ```
  deviceId: string
  timestamp: Date
  dataQuality: 'good' | 'degraded' | 'missing_target'
  temperatureC: number
  humidityPercent: number
  tempTarget: number | null       ← Core-1-reported; null nếu không có
  humidTarget: number | null
  controlSource: string | null    ← e.g. 'fuzzy', 'manual'
  configRevision: number | null
  mistState: boolean
  lampState: boolean
  fanState: boolean
  ```

**B1.2** — Implement `ControlHistoryInfluxWriter` class
- **File:** `src/influx/services/control-history-influx-writer.service.ts` (new)
- **Phương thức:**
  - `constructor(influxDbService: InfluxDbService, mqttService: MqttService, configService: ConfigService)` — inject dependencies
  - `onModuleInit(): void` — subscribe `mqttService.telemetry$` với `takeUntil(this.destroy$)`
  - `onModuleDestroy(): void` — complete `destroy$` Subject
  - `private mapTelemetryToPoint(raw: RawTelemetryPayload): LiveTelemetryPoint` — enrich với target/source/revision từ payload; gắn `dataQuality` dựa trên presence của fields
  - `private writePoint(point: LiveTelemetryPoint): Promise<void>` — build InfluxDB `Point` object; set measurement `controller_history`; set tags: `device_id`, `control_source`, `data_quality`; set fields: tất cả numeric/boolean fields; write vào bucket `INFLUXDB_BUCKET`
  - `private handleWriteError(error: Error, point: LiveTelemetryPoint): void` — log error với `device_id`; không throw; không retry vô hạn (circuit breaker optional)

**B1.3** — Đăng ký writer vào InfluxModule
- **File:** `src/influx/influx.module.ts` (modify)
- **Cần làm:**
  - Import `MqttModule` để inject `MqttService`
  - Thêm `ControlHistoryInfluxWriter` vào `providers` array
  - Export nếu cần (thường không cần)

---

### TRACK C — FIRMWARE: POD, NVS TWO-SLOT, QUEUE (Ngày 2–4)

#### C1 — Định nghĩa POD struct DynamicTuningParams

> **File:** `core/models.h` (modify)

**C1.1** — Thêm struct `DynamicTuningParams`
- **File:** `core/models.h` (modify)
- **Cần thêm:**
  ```cpp
  struct DynamicTuningParams {
      char     command_id[37];      // UUID string null-terminated, không dùng String
      uint32_t revision;            // monotonic counter
      float    lamp_gain_scale;     // [0.80, 1.20]
      float    mist_gain_scale;     // [0.80, 1.20]
      float    mist_on_threshold;   // [0.20, 0.35]
      float    mist_off_threshold;  // [0.10, 0.20]
  };
  // Không dùng #pragma pack(1) cho runtime POD
  static_assert(std::is_trivially_copyable<DynamicTuningParams>::value, "...");
  ```

**C1.2** — Định nghĩa NVS two-slot envelope struct
- **File:** `core/models.h` (modify) hoặc `core/tuning_config_manager.h` (new, preferred)
- **Struct `TuningNvsRecord`:**
  ```cpp
  struct TuningNvsRecord {
      uint8_t          version;      // layout version = 1
      uint32_t         generation;   // tăng mỗi lần write; boot chọn cao nhất hợp lệ
      DynamicTuningParams params;
      uint32_t         crc32;        // CRC của toàn bộ record ngoại trừ field crc32
  };
  ```

#### C2 — TuningConfigManager: Core-0-owned Manager (New)

> **File:** `core/tuning_config_manager.h` (new), `core/tuning_config_manager.cpp` (new)

**C2.1** — Định nghĩa interface class `TuningConfigManager`
- **File:** `core/tuning_config_manager.h` (new)
- **Public API:**
  - `static TuningConfigManager& getInstance()` — singleton
  - `bool hydrateFromNvs()` — đọc cả hai slot, chọn generation hợp lệ cao nhất; fallback defaults khi cả hai slot invalid; return false nếu fallback
  - `bool validatePayload(const JsonDocument& doc, ValidationResult& result)` — kiểm tra schema, device_id, UUID format, type, bounds, cross-field; không mutate state
  - `ProcessResult processCommand(const JsonDocument& doc)` — gọi validate → semantic diff → persist → enqueue; return status + reason_code
  - `const DynamicTuningParams& getActiveParms() const` — đọc active config (atomic read, Core 0 only)
  - `void enqueueInitialConfig()` — gọi sau queue creation; enqueue effective config từ NVS

- **Enums:**
  ```cpp
  enum class ProcessResult : uint8_t {
      ACCEPTED,
      REJECTED,
      DUPLICATE,
  };
  
  enum class RejectReason : uint8_t {
      INVALID_SCHEMA,
      DEVICE_MISMATCH,
      INVALID_UUID,
      OUT_OF_RANGE,
      CROSS_FIELD_INVALID,
      PERSISTENCE_FAILED,
      CONTROL_QUEUE_UNAVAILABLE,
  };
  ```

**C2.2** — Implement validation logic
- **File:** `core/tuning_config_manager.cpp` (new)
- **Hàm private:**
  - `bool _validateSchemaVersion(const JsonDocument& doc)` — `schema_version` phải là integer 1
  - `bool _validateDeviceId(const JsonDocument& doc)` — phải khớp `CONFIG_DEVICE_ID` hoặc NVS provisioned device_id
  - `bool _validateCommandIdFormat(const char* uuid_str)` — regex hoặc char-by-char: 8-4-4-4-12 hex
  - `bool _validateConfigBounds(const JsonDocument& config)` — từng key phải là finite float; check bounds table; không silently clamp
  - `bool _validateCrossField(float mist_on, float mist_off)` — `mist_off < mist_on` bắt buộc
  - `bool _validateNoNanInfinity(const JsonVariant& v)` — reject `NaN`, `Infinity`; reject string-number, reject null
  - `bool _isExactDuplicate(const char* command_id)` — check persisted command_id trong NVS active slot
  - `bool _isSemanticDiff(const DynamicTuningParams& incoming)` — epsilon `0.001f` cho float; exact match cho string

**C2.3** — Implement NVS two-slot persistence
- **File:** `core/tuning_config_manager.cpp` (new)
- **Hàm private:**
  - `bool _readSlot(uint8_t slot, TuningNvsRecord& out)` — đọc NVS key theo slot (0 hoặc 1); verify CRC; return false nếu invalid
  - `uint32_t _calculateCrc(const TuningNvsRecord& record)` — CRC32 trên toàn record ngoại trừ field `crc32` cuối
  - `bool _writeSlot(uint8_t slot, const TuningNvsRecord& record)` — ghi NVS; verify readback; return false nếu lỗi
  - `uint8_t _selectNextSlot(const TuningNvsRecord slots[2])` — slot có generation thấp hơn sẽ được ghi (wear leveling)
  - `bool _persistRecord(const DynamicTuningParams& params, const char* command_id)` — build `TuningNvsRecord` với generation+1; ghi vào next slot; chỉ thay thế active sau success

#### C3 — SystemManager: Khởi tạo Queue

> **File:** `core/system_manager.h` (modify), `core/system_manager.cpp` (modify)

**C3.1** — Khai báo global queue handle
- **File:** `core/system_manager.h` (modify)
- **Cần thêm:**
  ```cpp
  extern QueueHandle_t g_tuning_config_queue; // depth 1, sizeof(DynamicTuningParams)
  ```

**C3.2** — Khởi tạo queue trước task start
- **File:** `core/system_manager.cpp` (modify)
- **Hàm cần sửa:** `initializeSystem()` hoặc hàm init tương đương
- **Cần thêm:**
  - `g_tuning_config_queue = xQueueCreate(1, sizeof(DynamicTuningParams));`
  - Assert không null trước khi tiếp tục
  - Sau queue creation: gọi `TuningConfigManager::getInstance().hydrateFromNvs()` và `enqueueInitialConfig()`

---

### TRACK D — FIRMWARE: MQTT SUBSCRIBE/DISPATCH (Ngày 2–3)

#### D1 — Subscribe Desired Topic

> **File:** `network/mqtt_manager.cpp` (modify), `protocols/mqtt_callbacks.cpp` (modify)

**D1.1** — Thêm subscription trong MQTT connect handler
- **File:** `network/mqtt_manager.cpp` (modify)
- **Hàm cần sửa:** `onMqttConnected()` hoặc `subscribeCoreTopics()`
- **Cần thêm:**
  - Build topic string từ `IOT_TENANT` env + `DEVICE_ID`: `{tenant}/esp32/{deviceId}/down/tuning/desired`
  - `mqttClient.subscribe(tuningDesiredTopic, 1)` — QoS 1
  - Không hard-code tenant hay deviceId

**D1.2** — Dispatch trong MQTT message callback
- **File:** `protocols/mqtt_callbacks.cpp` (modify)
- **Hàm cần sửa:** `onMqttMessage(topic, payload, length)` hoặc tương đương
- **Cần thêm:**
  - `if (isTuningDesiredTopic(topic)) { dispatchTuningDesired(payload, length); }`
  - `isTuningDesiredTopic(const char* topic)` — compare string, không regex; return bool
  - `dispatchTuningDesired(const byte* payload, unsigned int length)` — copy bytes vào `g_network_worker_queue`; **không** parse JSON trong callback; log warning nếu length > 512 bytes (reject oversized)

#### D2 — Worker Task: Parse và Process

> **File:** `network/mqtt_manager.cpp` (modify) hoặc `protocols/mqtt_worker.cpp` (new)

**D2.1** — Implement tuning desired parser trong worker context
- **Hàm:** `processTuningDesiredMessage(const RawMqttMessage& msg)`
- **Steps:**
  1. `ArduinoJson::StaticJsonDocument<512> doc;`
  2. `deserializeJson(doc, msg.payload, msg.length)` — handle DeserializationError
  3. `TuningConfigManager::getInstance().processCommand(doc)` → result
  4. `publishTuningReported(result, doc)` — build reported JSON và publish

**D2.2** — Publish reported payload
- **Hàm:** `publishTuningReported(ProcessResult result, const JsonDocument& original)`
- **Cần làm:**
  - Build reported JSON payload theo contract Section 4.3 trong PLAN.md
  - `command_id`, `device_id`, `status` string, `reason_code` (null khi ACCEPTED), `reported_config`, `persisted`, `reported_at` (ISO8601)
  - `mqttClient.publish(reportedTopic, reportedPayload, false)` — QoS 1 (PubSubClient retain=false)
  - Topic: `{tenant}/esp32/{deviceId}/up/tuning/reported`

---

### TRACK E — FIRMWARE: CORE 1 APPLY TUNING (Ngày 4–5)

#### E1 — Drain Queue và Lưu Local Active Copy

> **File:** `core/core1_tasks.cpp` (modify)

**E1.1** — Drain queue ở đầu `runControlPipelineStep()`
- **Hàm cần sửa:** `runControlPipelineStep()` hoặc hàm control tick tương đương
- **Cần thêm:**
  ```cpp
  // Ở đầu function, trước fuzzy/sensor:
  DynamicTuningParams incomingTuning;
  if (xQueueReceive(g_tuning_config_queue, &incomingTuning, 0) == pdTRUE) {
      s_activeTuning = incomingTuning;  // local copy, Core 1 owned
  }
  ```
- `s_activeTuning` là `static DynamicTuningParams` trong file scope của `core1_tasks.cpp`
- Khởi tạo default values của `s_activeTuning` khi module init (trước task start)

**E1.2** — Apply gain scale sau fuzzy demand
- **Hàm cần sửa:** phần trong `runControlPipelineStep()` sau khi có demand từ `arbitrateOutputs()`
- **Cần thêm:**
  ```cpp
  float lampDemand = fuzzyOutputs.hLamp * s_activeTuning.lamp_gain_scale;
  lampDemand = std::clamp(lampDemand, 0.0f, 1.0f);
  
  float mistDemand = fuzzyOutputs.mist * s_activeTuning.mist_gain_scale;
  mistDemand = std::clamp(mistDemand, 0.0f, 1.0f);
  ```

#### E2 — Mist-Specific Hysteresis Refactor

> **File:** `core/actuator_controller.h` (modify), `core/actuator_controller.cpp` (modify)

**E2.1** — Tách helper `resolveBinaryDemand()`
- **File:** `core/actuator_controller.h` (modify)
- **Khai báo:**
  ```cpp
  // Helper trả ON/OFF dựa trên demand và threshold động
  bool resolveBinaryDemand(
      float demand,
      bool  currentState,
      float onThreshold,
      float offThreshold
  );
  ```

**E2.2** — Implement `resolveBinaryDemand()`
- **File:** `core/actuator_controller.cpp` (modify)
- **Logic:**
  ```
  if (!currentState && demand >= onThreshold) return true;   // bật
  if (currentState && demand < offThreshold) return false;   // tắt
  return currentState;                                        // giữ nguyên (hysteresis)
  ```

**E2.3** — Refactor `applyDirectOutputs()` để dùng helper
- **File:** `core/actuator_controller.cpp` (modify)
- **Hàm cần sửa:** `applyDirectOutputs()` (hoặc tên hiện tại tương đương)
- **Cần làm:**
  - Mist relay: gọi `resolveBinaryDemand(mistDemand, mistCurrentState, activeTuning.mist_on_threshold, activeTuning.mist_off_threshold)`
  - Lamp relay: gọi `resolveBinaryDemand(lampDemand, lampCurrentState, FUZZY_ON_THRESHOLD, FUZZY_OFF_THRESHOLD)` — hardcoded constants không đổi
  - Fan relay: tương tự lamp (hardcoded constants)
  - **Không** dùng threshold của Mist cho lamp/fan

**E2.4** — Truyền active tuning vào actuator controller
- **File:** `core/core1_tasks.cpp` (modify), `core/actuator_controller.h` (modify)
- **Cần làm:**
  - Cập nhật signature của `applyDirectOutputs()` để nhận `const DynamicTuningParams& tuning`
  - Hoặc dùng setter `ActuatorController::setActiveTuning(const DynamicTuningParams&)` trước khi gọi apply
  - Core 1 pass `s_activeTuning` vào actuator controller trước relay resolution

---

### TRACK F — BACKEND: DB MIGRATION, ENTITY, SHADOW SERVICE (Ngày 5–7)

#### F1 — TypeORM Migrations

> **File:** `src/migrations/1720656000006-CreateDeviceTuningConfigurations.ts` (new)
> **File:** `src/migrations/1720656000007-CreateTuningAuditLogs.ts` (new)

**F1.1** — Migration `1720656000006`: Bảng `device_tuning_configurations`
- **Hàm:** `up(queryRunner: QueryRunner): Promise<void>`
- **SQL tương đương:**
  ```sql
  CREATE TABLE device_tuning_configurations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Fallback: nếu pgcrypto chưa available, dùng uuid tạo bằng application
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
- **Hàm:** `down(queryRunner: QueryRunner): Promise<void>` — DROP TABLE với CASCADE

**F1.2** — Migration `1720656000007`: Bảng `tuning_audit_logs`
- **Hàm:** `up(queryRunner: QueryRunner): Promise<void>`
- **SQL tương đương:**
  ```sql
  CREATE TABLE tuning_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      configuration_id UUID NOT NULL REFERENCES device_tuning_configurations(id),
      device_id VARCHAR(50) NOT NULL,
      actor VARCHAR(100),
      source VARCHAR(50),          -- 'operator', 'system', 'rollback'
      action VARCHAR(50) NOT NULL, -- 'APPLY', 'REJECT', 'ROLLBACK'
      ruleset_version VARCHAR(20),
      kpi_snapshot JSONB,
      config_before JSONB,
      config_after JSONB,
      reason TEXT,
      result VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED'
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_tuning_audit_device_created
      ON tuning_audit_logs (device_id, created_at DESC);
  ```

#### F2 — TypeORM Entities

> **File:** `src/tuning/entities/device-tuning-configuration.entity.ts` (new)
> **File:** `src/tuning/entities/tuning-audit-log.entity.ts` (new)

**F2.1** — Entity `DeviceTuningConfiguration`
- **File:** `src/tuning/entities/device-tuning-configuration.entity.ts` (new)
- **Decorator và fields:**
  - `@Entity('device_tuning_configurations')`
  - `id: string` (`@PrimaryGeneratedColumn('uuid')`)
  - `deviceId: string` (`@Column({ type: 'varchar', length: 50 })` + `@ManyToOne(() => Device)`)
  - `commandId: string` (`@Column({ type: 'uuid', unique: true })`)
  - `desiredConfig: TuningConfigSnapshot` (`@Column({ type: 'jsonb' })`)
  - `reportedConfig: TuningConfigSnapshot | null`
  - `syncStatus: SyncStatus` (`@Column({ type: 'varchar', length: 20, default: 'PENDING' })`)
  - `rejectionReason: string | null`
  - `recommendationSnapshot: object | null`
  - `requestedBy: string | null`
  - `desiredPublishedAt: Date | null`
  - `appliedAt: Date | null`
  - `createdAt: Date` (`@CreateDateColumn()`)

- **Interface `TuningConfigSnapshot`:**
  ```typescript
  interface TuningConfigSnapshot {
    lamp_gain_scale: number;
    mist_gain_scale: number;
    mist_on_threshold: number;
    mist_off_threshold: number;
  }
  ```

- **Enum `SyncStatus`:**
  ```typescript
  enum SyncStatus {
    PENDING = 'PENDING',
    IN_SYNC = 'IN_SYNC',
    REJECTED = 'REJECTED',
  }
  ```

**F2.2** — Entity `TuningAuditLog`
- **File:** `src/tuning/entities/tuning-audit-log.entity.ts` (new)
- **Fields:** id, configurationId (FK), deviceId, actor, source, action, rulesetVersion, kpiSnapshot, configBefore, configAfter, reason, result, createdAt

#### F3 — TuningConfigurationService: Shadow State Management

> **File:** `src/tuning/services/tuning-configuration.service.ts` (new)

**F3.1** — Implement `handleReportedAck()`
- **Signature:** `async handleReportedAck(payload: TuningReportedPayload): Promise<void>`
- **Logic:**
  1. Validate `payload` có đủ fields (type guard)
  2. `queryRunner.startTransaction()`
  3. `SELECT ... FOR UPDATE` theo `command_id`
  4. Validate `device_id` match; validate `reported_config` canonical match với `desired_config`
  5. `UPDATE sync_status`, `reported_config`, `applied_at`
  6. `INSERT` vào `tuning_audit_logs`
  7. Conditional retain-clear: check nếu `command_id` = latest pending → publish empty retained
  8. `COMMIT`
  9. `this.tuningSyncSubject.next(...)` → phát SSE
  10. Mọi lỗi trong flow: `ROLLBACK` + log

**F3.2** — Implement `createPendingCommand()`
- **Signature:** `async createPendingCommand(dto: CreateTuningConfigurationDto, actor: string): Promise<TuningCommandResult>`
- **Logic:**
  1. Validate `dto.deviceId` thuộc actor (gọi device ownership service)
  2. Generate `commandId = uuid()`
  3. `INSERT device_tuning_configurations` với `sync_status='PENDING'`
  4. `INSERT tuning_audit_logs` (action='APPLY', result='PENDING')
  5. Publish desired MQTT retained QoS 1 (gọi `MqttService.publishDesired()`)
  6. Cập nhật `desired_published_at` sau publish thành công
  7. Return `{ commandId, status: 'PENDING' }`

**F3.3** — Implement `getLatestByDeviceId()`
- **Signature:** `async getLatestByDeviceId(deviceId: string): Promise<DeviceTuningConfiguration | null>`
- **Logic:** Query với ORDER BY `created_at DESC`, LIMIT 1

**F3.4** — Implement `getTuningHistory()`
- **Signature:** `async getTuningHistory(deviceId: string, limit: number, offset: number): Promise<TuningAuditLog[]>`
- **Logic:** Query `tuning_audit_logs` WHERE `device_id = ?` ORDER BY `created_at DESC` với pagination

#### F4 — TuningModule Declaration

> **File:** `src/tuning/tuning.module.ts` (new)

**F4.1** — Module setup
- **Imports:** `TypeOrmModule.forFeature([DeviceTuningConfiguration, TuningAuditLog])`, `MqttModule`, `DevicesModule`
- **Providers:** `TuningConfigurationService`
- **Exports:** `TuningConfigurationService`
- Import `TuningModule` vào `AppModule` — không nhồi endpoint vào `DeviceController`

#### F5 — MqttService: Subscribe Reported Topic

> **File:** `src/mqtt/services/mqtt.service.ts` (modify)

**F5.1** — Thêm subscription cho reported topic pattern
- **Hàm cần sửa:** `onModuleInit()` hoặc `connectAndSubscribe()`
- **Cần thêm:**
  - Subscribe wildcard `+/esp32/+/up/tuning/reported` với QoS 1
  - Trong message handler: check topic pattern → gọi `tuningConfigurationService.handleReportedAck(parsedPayload)`
  - Parse dùng type guard `isTuningReportedPayload(payload: unknown): payload is TuningReportedPayload`

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

### 4.1 Bảo mật

**SEC-S1-01 — Không clear retained desired của device khác hoặc khi ACK lạ:**
> Khi `handleReportedAck()` nhận payload với `device_id` không khớp row trong DB, hoặc `command_id` không tồn tại: chỉ ghi security log, không gọi MQTT publish gì cả. Reviewer phải verify: test case "wrong device ACK" không trigger bất kỳ MQTT publish nào.

**SEC-S1-02 — Firmware không trust device_id từ client, luôn validate với provisioned identity:**
> `TuningConfigManager::_validateDeviceId()` phải so sánh với ID đã provisioned trong NVS (hoặc `CONFIG_DEVICE_ID` compile-time). Không thể spoof device_id qua MQTT payload. Reviewer phải verify: test fixture với payload chứa `device_id` khác → `DEVICE_MISMATCH`.

**SEC-S1-03 — Không interpolate raw string vào InfluxDB Flux query:**
> `ControlHistoryInfluxWriter` phải luôn dùng `escapeFluxString()` hoặc parameterized InfluxDB client API cho `device_id` tag. Không dùng template literal trực tiếp với user-supplied deviceId.

**SEC-S1-04 — ACL MQTT: device chỉ được publish reported của chính nó:**
> `mqtt-auth.service.ts` test coverage phải bao gồm case device cố publish desired hoặc publish reported của device khác → DENY. Reviewer chạy `acl.tuning.spec.ts` và verify 100% pass.

### 4.2 Hiệu Năng & Flash Wear

**PERF-S1-01 — Callback MQTT không parse JSON:**
> `dispatchTuningDesired()` trong `mqtt_callbacks.cpp` chỉ được copy bytes vào queue. Mọi `ArduinoJson` call phải nằm trong worker task. Reviewer đọc callback code và verify không có `deserializeJson()` call.

**PERF-S1-02 — Flash write chỉ khi semantic config thực sự thay đổi:**
> `TuningConfigManager::processCommand()` phải gọi `_isSemanticDiff()` trước `_persistRecord()`. Nếu diff = false → chỉ persist command identity (generation mới, same config), không rewrite 4 float fields. Reviewer verify: test fixture với same params → NVS write count = 1 (identity only), không = 2.

**PERF-S1-03 — InfluxDB writer không block MQTT telemetry pipeline:**
> `writePoint()` phải là async non-blocking; nếu InfluxDB unreachable → log error + skip, không await vô hạn. Reviewer verify: unit test mock InfluxDB throw error → telemetry$ không bị unsubscribe.

### 4.3 Firmware Correctness & Safety

**SAFE-S1-01 — Lamp/fan hardcoded thresholds không bị thay đổi:**
> `applyDirectOutputs()` sau refactor phải dùng `FUZZY_ON_THRESHOLD=0.25` và `FUZZY_OFF_THRESHOLD=0.15` cho lamp và fan. Reviewer đọc diff của `actuator_controller.cpp` và verify không có reference đến `mist_on_threshold`/`mist_off_threshold` trong lamp/fan branch.

**SAFE-S1-02 — Core 1 không gọi NVS hoặc MQTT:**
> `core1_tasks.cpp` sau khi sửa không được có bất kỳ `nvs_`, `esp_mqtt_`, hay `PubSubClient` call. Reviewer grep `core1_tasks.cpp` cho các prefix này.

**SAFE-S1-03 — Two-slot CRC: boot luôn có valid config hoặc safe defaults:**
> `hydrateFromNvs()` phải cover case: cả hai slot invalid → load default values (`lamp_gain_scale=1.0`, `mist_gain_scale=1.0`, `mist_on_threshold=0.25`, `mist_off_threshold=0.15`) và log warning. Reviewer verify unit test fixture "both slots corrupted" → defaults loaded, không crash.

**SAFE-S1-04 — `xQueueOverwrite()` không block và Core 1 luôn nhận effective config mới nhất:**
> Queue depth 1 + `xQueueOverwrite` là thiết kế chủ ý. Reviewer verify: không có `xQueueSend` (blocking) hay `xQueueSendToBack` nào trong `TuningConfigManager`. Chỉ `xQueueOverwrite` được phép.
