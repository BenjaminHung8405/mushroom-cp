# Kế hoạch Kiến trúc: IIoT Industrial-Grade Fuzzy & Slow PWM Dynamic Tuning (v2.1 Final)

## 1. Mục tiêu và phạm vi

Chuyển hệ thống từ giám sát time-series sang **tinh chỉnh điều khiển có dữ liệu hỗ trợ**, nhưng vẫn giữ người vận hành là chủ thể quyết định. Hệ thống phải:

- Tính KPI điều khiển từ telemetry và sự kiện actuator theo cửa sổ thời gian.
- Sinh khuyến nghị thay đổi gain fuzzy, deadband phun sương và thông số TPC/Slow PWM cho đèn A250.
- Chỉ phát cấu hình xuống Edge sau hành động phê duyệt rõ ràng trên UI.
- Đồng bộ cấu hình theo mô hình **Desired / Reported State**, chịu được thiết bị hoặc WAN offline.
- Bảo vệ Flash, loại trừ race condition giữa hai Core và bảo đảm lệnh/ACK có tính idempotent.
- Không cho bất kỳ cấu hình động nào vượt qua các interlock an toàn phần cứng hoặc sinh học đang chạy tại Core 1.

### Không thuộc phạm vi phiên bản v2.1

- Tự động áp dụng khuyến nghị không cần phê duyệt của con người.
- Thay đổi loại SSR, cơ chế TPC hiện hữu hoặc điều khiển GPIO trực tiếp từ tầng MQTT.
- Nâng trần safety bounds theo mùa. Outdoor context và seasonal heuristics là backlog Phase 2, chỉ được kích hoạt sau khi có dữ liệu thực địa và đánh giá rủi ro riêng.

---

## 2. Các quyết định kiến trúc bắt buộc

| Hạng mục | Quyết định v2.1 |
| --- | --- |
| Analytics | InfluxDB Tasks pre-aggregate theo giờ vào bucket analytics; API không quét raw telemetry 24 giờ theo từng request. |
| Quyền quyết định | Recommender chỉ tạo advisory; UI cần operator phê duyệt trước khi tạo desired config. |
| Đồng bộ thiết bị | MQTT QoS 1, desired retained message, reported ACK và Device Shadow trong PostgreSQL. |
| Lệnh cũ / ACK lặp | `command_id` UUID, xử lý idempotent, clear retained desired chỉ khi ACK khớp lệnh đang pending. |
| Flash NVS | Validate + semantic diff-check; chỉ persist khi cấu hình thực sự đổi. Cấu hình phải được lưu kèm revision/CRC để khôi phục an toàn khi mất điện giữa lúc ghi. |
| IPC đa lõi | Core 0 là chủ sở hữu MQTT/NVS. Core 1 chỉ nhận POD config qua FreeRTOS Queue depth 1 và thay cấu hình ở đầu control tick. |
| Điều khiển SSR | Giữ TPC/Slow PWM bằng `digitalWrite`, không dùng high-frequency PWM. TPC 50 ms tick, fuzzy/adaptive update 5 s như baseline hiện hữu. |
| Giờ hệ thống | Blackout dùng trạng thái thời gian do NTP hiện có cung cấp. Khi thời gian chưa hợp lệ hoặc mất tin cậy, interlock phải fail-safe theo quy tắc Core 1 hiện hữu. |

---

## 3. Kiến trúc tổng thể

```text
Raw telemetry / actuator events
             |
             v
InfluxDB scheduled Tasks (hourly aggregates)
             |
             v
NestJS ControlAnalyticsService --> TuningRecommenderEngine
             |                              |
             |                              v
             |                    Recommendation + KPI snapshot
             v                              |
PostgreSQL audit / Device Shadow <--- Next.js Tuning Advisory Panel
             |                         (review, approve, apply)
             v
MQTT desired (QoS 1, retain=true)
             |
             v
ESP32-S3 Core 0: authenticate -> parse -> validate -> NVS diff persist
             |
             +--> FreeRTOS Queue (depth 1, overwrite) --> Core 1 control loop
             |                                                   |
             v                                                   v
MQTT reported (QoS 1)                              Fuzzy -> protection -> TPC -> SSR
             |
             v
NestJS validates ACK -> state transition -> SSE -> UI
             |
             v
Clear retained desired only when it is still the acknowledged command
```

### Luồng trạng thái chuẩn

1. Operator xem KPI và khuyến nghị, chỉnh sửa trong giới hạn được phép nếu cần, rồi bấm **Áp dụng**.
2. Backend validate payload, tạo `command_id`, ghi desired snapshot với trạng thái `PENDING`, audit actor và publish desired retained với QoS 1.
3. ESP32 nhận desired, kiểm tra schema, `device_id`, phiên bản schema, kiểu dữ liệu, bounds và các điều kiện liên tham số.
4. Nếu hợp lệ, Core 0 persist khi có semantic diff, gửi POD config qua Queue cho Core 1 và publish reported `ACCEPTED`.
5. Core 1 drain Queue ở đầu tick 50 ms; cấu hình mới trở thành active config cho các vòng fuzzy/TPC tiếp theo. Interlock vẫn có quyền ép output về trạng thái an toàn.
6. Backend chỉ chuyển bản ghi sang `IN_SYNC` khi `command_id`, `device_id` và reported payload hợp lệ khớp desired. Sau đó phát SSE cho UI.
7. Backend xóa retained desired **có điều kiện** để không xóa nhầm desired mới hơn vừa được publish bởi một operator khác.

---

## 4. Data contract và cấu hình động

### 4.1 Tham số được phép tuning

| Key | Mặc định | Hard bounds | Ý nghĩa |
| --- | ---: | ---: | --- |
| `ke_temp` | 1.00 | 0.80–1.20 | Gain đầu vào sai số nhiệt độ. |
| `ku_lamp` | 1.00 | 0.80–1.20 | Gain đầu ra demand đèn A250. |
| `mist_deadband` | 3.0 %RH | 2.0–8.0 %RH | Vùng chết giảm chattering phun sương. |
| `lamp_pwm_cycle_s` | 180 s | 120–300 s | Chu kỳ TPC/Slow PWM của đèn. |
| `lamp_min_on_s` | 30 s | 20–60 s | Thời gian ON tối thiểu bảo vệ bóng. |

Các điều kiện liên tham số tối thiểu:

- Mọi số thực phải hữu hạn (`isfinite`), không chấp nhận `NaN`, `Infinity`, chuỗi số hoặc kiểu JSON sai.
- `lamp_min_on_s <= lamp_pwm_cycle_s`; firmware reject nếu sai thay vì âm thầm biến đổi ý nghĩa lệnh.
- Cấu hình động chỉ thay đổi demand/controller tuning; không được thay đổi blackout schedule, safety thresholds, pin mapping, loại SSR hay quyền override của `SystemProtector`.

### 4.2 Desired payload

```json
{
  "schema_version": 1,
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_id": "mushroom_s3_206ef1a",
  "issued_at": "2026-07-21T09:00:00.000Z",
  "config": {
    "ke_temp": 1.05,
    "ku_lamp": 1.08,
    "mist_deadband": 5.0,
    "lamp_pwm_cycle_s": 240,
    "lamp_min_on_s": 30
  }
}
```

- Topic desired: `devices/{deviceId}/config/desired`.
- Chỉ backend được quyền publish topic này; ACL broker phải tách quyền publish desired và publish reported.
- Retained desired chỉ là **lệnh pending mới nhất**, không phải nguồn lịch sử cấu hình. Lịch sử và nguồn chân lý audit là PostgreSQL.

### 4.3 Reported payload

```json
{
  "schema_version": 1,
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_id": "mushroom_s3_206ef1a",
  "status": "ACCEPTED",
  "reason_code": null,
  "reported_config": {
    "ke_temp": 1.05,
    "ku_lamp": 1.08,
    "mist_deadband": 5.0,
    "lamp_pwm_cycle_s": 240,
    "lamp_min_on_s": 30
  },
  "persisted": true,
  "reported_at": "2026-07-21T09:00:04.000Z"
}
```

- Topic reported: `devices/{deviceId}/config/reported`.
- `status` hợp lệ: `ACCEPTED`, `REJECTED`, `DUPLICATE`.
- `DUPLICATE` phải chứa cùng `command_id` và effective config; backend không tạo SSE thành công lặp lại.
- Với `REJECTED`, firmware trả `reason_code` xác định, ví dụ `INVALID_SCHEMA`, `DEVICE_MISMATCH`, `OUT_OF_RANGE`, `CROSS_FIELD_INVALID` hoặc `NVS_WRITE_FAILED`.

---

## 5. Backend: Analytics, recommendation và audit

### 5.1 InfluxDB Tasks

Tạo các scheduled task chạy mỗi giờ, offset 5 phút để dữ liệu cuối giờ ổn định, ghi vào bucket `mushroom_analytics` với measurement `kpi_metrics_1h`.

Mỗi aggregate phải giữ đủ thành phần để tổng hợp chính xác qua nhiều giờ, không chỉ lưu giá trị trung bình:

- Nhiệt độ/độ ẩm: `sample_count`, `sum_squared_error`, `max`, `min`, thời lượng vượt ngưỡng.
- Actuator: `switch_count`, `on_duration_s`, `on_session_count`, `on_duration_sum_s` theo `device_id` và actuator.
- Metadata: `window_start`, `window_end`, `device_id`, phiên bản setpoint/profile nếu có.

RMSE rolling window được tính từ tổng `sum_squared_error / sample_count`, không lấy trung bình các RMSE theo giờ. Sai số phải được tính so với setpoint thực tế cùng thời điểm (profile/checkpoint hiệu lực), không hard-code một giá trị duy nhất cho mọi giai đoạn nuôi trồng.

### 5.2 `ControlAnalyticsService`

Vị trí đề xuất: `mushroom-backend/src/analytics/services/control-analytics.service.ts`.

Nhiệm vụ:

- Query bucket aggregate cho cửa sổ 24 giờ hoặc một crop batch được xác định.
- Trả `ControlKpiReport` có `windowStart`, `windowEnd`, số sample và cờ chất lượng dữ liệu.
- Từ chối hoặc gắn `INSUFFICIENT_DATA` khi thiếu coverage, thiết bị offline quá lâu hoặc không có actuator events đáng tin cậy.
- Không sử dụng chuỗi interpolation trực tiếp cho `deviceId` trong Flux; escape/bind đúng API để ngăn injection và lỗi truy vấn.

KPI ban đầu:

| KPI | Diễn giải |
| --- | --- |
| `tempRmse` / `humidRmse` | Độ bám setpoint theo toàn bộ sample hợp lệ. |
| `mistSwitchCountPerHour` | Tần suất state transition của Mist. |
| `lampDutyCyclePercent` | Tổng thời gian ON / thời lượng cửa sổ. |
| `lampAvgOnDurationSec` | Tổng thời lượng session ON / số session ON. |
| `overshootDurationSec` | Thời lượng nhiệt vượt giới hạn profile. |
| `undershootDurationSec` | Thời lượng ẩm thấp hơn giới hạn profile. |
| `dataCoveragePercent` | Tỷ lệ dữ liệu hợp lệ; dùng để chặn recommendation thiếu căn cứ. |

### 5.3 `TuningRecommenderEngine`

Engine là deterministic, pure service, versioned ruleset và phải lưu `ruleset_version` vào recommendation/audit record.

| Điều kiện (sau khi đủ data coverage) | Khuyến nghị ban đầu | Ràng buộc |
| --- | --- | --- |
| `mistSwitchCountPerHour > 10` | `mist_deadband`: 3.0 → 5.0; review cooldown hiện hữu | Chỉ đề xuất, không tự apply. |
| `lampAvgOnDurationSec < 30` | `lamp_pwm_cycle_s`: 180 → 240; `lamp_min_on_s`: 30 | Không đề xuất khi dữ liệu lamp thiếu. |
| `tempRmse > 1.5` và lamp duty < 30% | Tăng `ku_lamp` tối đa +8% | Kẹp trong hard bounds. |
| `humidRmse > 5.0` và không chattering | Tăng gain ẩm tối đa +5% | Chỉ map vào parameter firmware được hỗ trợ. |

Mỗi recommendation phải nêu rõ KPI snapshot, current config, delta đề xuất, lý do, expected benefit và mức tin cậy. Không gộp các recommendation mâu thuẫn; engine phải trả conflict để operator xem xét.

### 5.4 Persistence PostgreSQL

Tạo migration và entity `device_configurations` tối thiểu:

```sql
CREATE TABLE device_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(64) NOT NULL,
  command_id UUID NOT NULL UNIQUE,
  desired_config JSONB NOT NULL,
  reported_config JSONB,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  rejection_reason VARCHAR(64),
  requested_by UUID,
  recommendation_id UUID,
  desired_published_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_device_configurations_device_created
  ON device_configurations (device_id, created_at DESC);
```

`tuning_history_logs` hoặc bảng audit tương đương phải ghi actor, source (`RECOMMENDATION`/`MANUAL`), KPI snapshot, before/after, reason và kết quả cuối cùng. Không được coi MQTT packet log là audit trail đủ tin cậy.

### 5.5 ACK, idempotency và clear-on-ACK

Backend xử lý reported theo transaction:

1. Xác thực topic device ID, schema và `command_id`.
2. Lock/read record tương ứng; nếu không tồn tại, ghi security log và không clear retained message.
3. Nếu record đã `IN_SYNC` hoặc `REJECTED`, ACK là duplicate: không update audit và không phát SSE lần nữa.
4. Với `ACCEPTED`, kiểm tra reported config bằng desired config sau canonicalization số thực; cập nhật `IN_SYNC`, `reported_config`, `applied_at`.
5. Clear retained desired bằng publish payload rỗng với `retain=true`, **chỉ khi** record vẫn là desired pending mới nhất của device. Nếu đã có command mới hơn, giữ retained payload mới hơn.
6. Với `REJECTED`, cập nhật `REJECTED`, reason; không phát trạng thái "đã áp dụng".

---

## 6. Firmware: xác thực, persistence, IPC và control path

### 6.1 Kiểu dữ liệu runtime

Định nghĩa ở vùng dùng chung, ví dụ `mushroom-iot-firmware/src/core/models.h` hoặc header tuning chuyên dụng. Không dùng `String`, JSON document hoặc handle NVS trong Queue.

```cpp
struct DynamicTuningParams {
  char commandId[37];  // UUIDv4: 36 ký tự + '\0'
  float keTemp;
  float kuLamp;
  float mistDeadband;
  uint16_t lampPwmCycleSec;
  uint16_t lampMinOnSec;
};
```

Không ép `#pragma pack(1)` cho struct runtime nếu không cần giao tiếp binary; Queue truyền nội bộ cùng firmware nên layout tự nhiên tránh unaligned access. JSON chỉ là wire format, phải được parse có kiểm tra trước khi tạo struct POD.

### 6.2 `TuningConfigManager` (Core 0 ownership)

Vị trí đề xuất: `mushroom-iot-firmware/src/core/tuning_config_manager.{h,cpp}`.

Trách nhiệm:

1. Hydrate effective config an toàn từ NVS trong `setup()` trước khi start control/network tasks.
2. Validate đầy đủ payload và clamp chỉ như hàng rào cuối cùng. Giá trị ngoài bounds từ remote command phải bị `REJECTED`, không nên silently clamp rồi ACK là thành công vì UI sẽ bị lệch với ý định operator.
3. So sánh semantic config với RAM bằng epsilon rõ ràng cho float (ví dụ `0.001f`) và exact compare cho integer/string.
4. Nếu `command_id` trùng command đã xử lý: không ghi NVS, không enqueue lại; publish `DUPLICATE` để backend có thể kết thúc retry an toàn.
5. Nếu chỉ command khác nhưng effective parameters giống nhau: cập nhật durable command identity để idempotency sau reboot, nhưng không ghi lặp dữ liệu parameter không cần thiết.
6. Persist envelope gồm version, revision, config, `command_id` và CRC. Dùng hai slot/record versioned hoặc cơ chế commit an toàn tương đương; boot chỉ chọn record CRC hợp lệ mới nhất, fallback defaults khi cả hai không hợp lệ.
7. Chỉ sau khi persistence thành công mới queue config và publish `ACCEPTED`.

NVS lỗi, parse lỗi hoặc Queue chưa khởi tạo phải trả `REJECTED`; không cập nhật RAM một phần và không claim success.

### 6.3 FreeRTOS Queue Core 0 → Core 1

```cpp
QueueHandle_t gTuningConfigQueue;

// setup(): tạo trước khi các task chạy
gTuningConfigQueue = xQueueCreate(1, sizeof(DynamicTuningParams));

// Core 0 sau validate + persist thành công
xQueueOverwrite(gTuningConfigQueue, &effectiveConfig);

// Core 1: ở đầu mỗi tick 50 ms
DynamicTuningParams incoming;
if (xQueueReceive(gTuningConfigQueue, &incoming, 0) == pdTRUE) {
  activeTuningConfig = incoming;
}
```

- Depth 1 là chủ ý: Core 1 chỉ cần effective config mới nhất, không cần replay mọi intermediate config.
- `xQueueOverwrite` chỉ hợp lệ với queue depth 1; check return value và log fault nếu thất bại.
- Core 1 giữ bản sao cục bộ `activeTuningConfig`, không đọc NVS và không dùng mutex cho config runtime.
- Chỉ Core 0 gọi MQTT callback, parse JSON, persistence và publish ACK.

### 6.4 Bất biến bảo vệ tại Core 1

Thứ tự control path không đổi:

```text
sensor state / setpoint
  -> fuzzy calculation (5 s)
  -> arbitration + dynamic tuning
  -> SystemProtector / hardwareProtectionOverride
  -> TPC scheduler (50 ms)
  -> digitalWrite SSR
```

Các bất biến:

- Blackout 11:00–13:30 ép Mist OFF tuyệt đối; tuning không có quyền bypass.
- Khi thời gian không hợp lệ, xử lý fail-safe theo bảo vệ Core 1 hiện hữu, bao gồm ép các output được bảo vệ về OFF.
- Đèn A250 luôn tuân thủ thời gian ON/OFF tối thiểu; change cycle không được làm cắt ngắn một pha đang chạy theo cách tạo inrush hoặc sốc nhiệt.
- Tất cả output cuối cùng vẫn clamp `[0.0, 1.0]`; Core 1/TPC là nơi duy nhất quyết định GPIO SSR bằng `digitalWrite`.
- Core 0 không được gọi GPIO hoặc đụng vào control state Core 1 trực tiếp.

---

## 7. Frontend: Human-in-the-Loop và quan sát trạng thái

Tích hợp `TuningAdvisoryPanel` vào dashboard hiện có.

### Trải nghiệm bắt buộc

- Chọn device và cửa sổ phân tích; hiển thị coverage cùng KPI.
- Diff view: current vs proposed, unit, hard bounds, lý do và expected benefit.
- Cảnh báo rõ khi KPI thiếu dữ liệu, recommendation conflict hoặc thiết bị offline.
- Nút **Áp dụng** yêu cầu xác nhận, gửi `POST` có idempotency key; không có nút auto-apply.
- Badge trạng thái: `Đang chờ thiết bị`, `Đã áp dụng`, `Bị từ chối`, `Hết hạn/không phản hồi`.
- SSE chỉ cập nhật UI sau state transition backend; client reconnect phải refetch authoritative state thay vì tin local optimistic state mãi mãi.

### API đề xuất

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| `GET` | `/devices/:deviceId/analytics/tuning-recommendations` | KPI và advisory theo window. |
| `POST` | `/devices/:deviceId/tuning-configurations` | Operator phê duyệt và tạo desired config. |
| `GET` | `/devices/:deviceId/tuning-configurations/latest` | Desired/reported state mới nhất. |
| `GET` | `/devices/:deviceId/tuning-history` | Audit log theo phân quyền. |

Backend phải kiểm tra authorization của operator trên device/house trước mọi read/write tuning endpoint.

---

## 8. Kế hoạch triển khai: 14 ngày / 2 sprint

### Sprint 1 — Hạ tầng, persistence và closed-loop MQTT (Ngày 1–7)

| Ngày | Công việc | Kết quả |
| --- | --- | --- |
| 1–2 | Influx Tasks, schema analytics, service query aggregate | KPI API có coverage và unit tests tính toán. |
| 1–2 | Migration Device Shadow + audit entity | Desired/reported state query được, có index. |
| 3–4 | Firmware types, validator, NVS envelope + diff-check | Reboot recovery và write minimization được test. |
| 4–5 | Queue IPC, apply ở Core 1 tick boundary | Không shared mutable struct/mutex trên control path. |
| 5–7 | MQTT desired/reported, ACL, retry, idempotency, conditional clear | Offline reconnect và ACK duplicate không làm lệch state. |

### Sprint 2 — Advisory UI, fault injection và nghiệm thu E2E (Ngày 8–14)

| Ngày | Công việc | Kết quả |
| --- | --- | --- |
| 8–9 | Recommender ruleset versioned và API | Recommendation có traceable KPI/reason. |
| 8–10 | Panel, confirmation, SSE state | Operator nhìn đúng pending/in-sync/rejected. |
| 10–12 | Fault injection | Kịch bản mạng, broker, reboot, duplicate ACK và NVS được xác minh. |
| 13 | Dry-run dữ liệu 24 giờ / staging | KPI và recommendation được review thực địa. |
| 14 | Documentation, rollback drill, release gate | Release checklist và vận hành sẵn sàng. |

---

## 9. Tiêu chí nghiệm thu và test matrix

### Backend / data

- [ ] Aggregate có đúng `sample_count` và `sum_squared_error`; rolling RMSE không sai do averaging-of-averages.
- [ ] Recommendation không sinh khi coverage dưới ngưỡng đã cấu hình.
- [ ] Mỗi action apply có actor, config before/after, KPI snapshot và ruleset version trong audit.
- [ ] Reported `command_id` không tồn tại, sai device hoặc sai config bị reject/log, không làm đổi state.

### MQTT / Device Shadow

- [ ] Thiết bị offline lúc publish nhận desired retained mới nhất khi reconnect.
- [ ] ACK QoS 1 bị giao lại nhiều lần chỉ tạo một state transition và một SSE success.
- [ ] ACK cũ không xóa retained desired mới hơn.
- [ ] Payload rỗng retained chỉ được publish sau ACK thành công và đúng command pending.

### Firmware / safety

- [ ] JSON sai kiểu, UUID sai, `NaN`, out-of-range và cross-field invalid đều bị reject không thay RAM/NVS/Queue.
- [ ] Cùng command hai lần không ghi flash và không apply lại; sau reboot vẫn nhận diện duplicate theo durable command identity.
- [ ] Config không đổi không tăng số lần write NVS.
- [ ] Mất điện giữa lúc persist khôi phục record CRC hợp lệ gần nhất hoặc defaults an toàn.
- [ ] Stress publish config liên tục không tạo race, crash, heap growth hoặc Core 1 block.
- [ ] Core 1 không truy cập NVS/MQTT; config chỉ đổi ở queue drain boundary.
- [ ] Blackout, invalid time và min ON/OFF đèn vẫn thắng mọi dynamic tuning config.

### Rollback vận hành

- [ ] UI có thể gửi factory-safe tuning profile đã được phê duyệt.
- [ ] Firmware có API/physical recovery để reset dynamic tuning về defaults an toàn khi NVS corrupt.
- [ ] Rollback được ghi audit như một command bình thường và phải nhận reported ACK.

---

## 10. Rủi ro còn lại và nguyên tắc vận hành

1. **KPI không đồng nghĩa nhân quả.** Điều kiện môi trường, cửa mở, nguồn nước và thao tác vận hành có thể ảnh hưởng KPI; recommendation phải là advisory.
2. **Tuning theo từng thiết bị.** Không copy delta giữa các tủ nếu chưa so sánh phần cứng, tải và profile.
3. **Giới hạn thay đổi.** Mỗi command chỉ nên thay số parameter tối thiểu cần thiết; sau apply cần observation window trước khuyến nghị tiếp theo.
4. **Quan sát trước mở rộng.** Thu thập đủ log theo crop batch trước khi đưa outdoor context hoặc seasonal bound vào production.
5. **Safety luôn ở Edge.** Backend, broker, UI hoặc network hỏng không được làm mất interlock tại Core 1.

Bản kế hoạch triển khai hệ thống **Đánh giá Hiệu năng & Tinh chỉnh Tham số Điều khiển (Semi-Automated Dynamic Tuning Protocol)** cho tủ điện điều khiển môi trường trại nấm. Hệ thống tuân thủ nghiêm ngặt mô hình **Human-in-the-Loop** (người vận hành phê duyệt) và **Ranh giới Bảo vệ Cứng (Bounded Safety Guardrails)** trực tiếp tại Edge.

---

## 📊 Tổng hợp Cải tiến Kiến trúc (v1.0 vs v2.1)

| Hạng mục | Bản v1.0 (Naive Web App) | Bản v2.1 (Industrial IIoT Final) |
| --- | --- | --- |
| **Database Performance** | Query trực tiếp raw data 24h on-the-fly khi có request API. | **InfluxDB Tasks** pre-aggregate 1h/lần sang bucket `kpi_metrics_1h` ($\text{Response} < 10\text{ms}$). |
| **MQTT State Sync** | Fire-and-Forget (phát lệnh xong coi như xong). | **Device Shadow Pattern** (Desired/Reported) + **QoS 1** + **Retain** + **ACK**. |
| **Ghost Message Risk** | Nguy cơ lặp lệnh cũ khi ESP32 cúp điện khởi động lại. | **Clear Retain Protocol:** Backend phát payload rỗng `""` sau khi nhận ACK. |
| **NVS Flash Lifespan** | Ghi đè Flash lặp lại mỗi khi nhận config. | **NVS Diff-Check:** Chỉ tốn chu kỳ ghi Flash khi giá trị RAM thay đổi. |
| **Command Tracing** | Thiếu mã định danh lệnh ở tầng Firmware. | **`command_id` Tracking:** Nhét `command_id` trực tiếp vào C++ Struct để map ACK. |
| **Inter-Core IPC** | Mutex/Shared Struct (dễ gây Race Condition hoặc block Core 1). | **FreeRTOS Queue** (`xQueueOverwrite` / `xQueueReceive`): Lock-free & Atomic. |
| **Timeline Triển khai** | 7 ngày (Lý thuyết). | **14 ngày / 2 Sprints** (Bao gồm Fault Injection & Network Simulation). |

---

## 🏛️ I. Tổng quan Luồng Bất đồng bộ (Closed-Loop Sync Flow)

```text
[UI Next.js] ───(1) Apply Config───► [NestJS Backend] ───(2) DB: DESIRED (PENDING)
                                            │
                                            ▼ (3) MQTT QoS 1 + Retain = true
                                    [MQTT Topic: .../config/desired]
                                            │
                                            ▼
                                    [ESP32 Core 0: Parse & Guard Check]
                                            │
                                            ▼ (4) Pass Safety Bounds -> Write NVS Diff
                                    [ESP32 Core 0 ──(FreeRTOS Queue)──► Core 1 Engine]
                                            │
                                            ▼ (5) MQTT QoS 1 (Publish ACK kèm command_id)
                                    [MQTT Topic: .../config/reported]
                                            │
                                            ├──────────────────────────────────────────┐
                                            ▼ (6a) Clear Ghost Retained Message        ▼ (6b) Update DB
[UI: Đã áp dụng] ◄──(7) SSE Event ─── [NestJS Backend] ──(Publish "" Retain)──► [MQTT Broker]   (Status: IN_SYNC)

```

---

## 🏢 II. Tầng Backend & InfluxDB Pre-Aggregation

### 1. InfluxDB Scheduled Task (`task_aggregate_kpi_1h.flux`)

Chạy định kỳ 1 giờ/lần để tính toán độ lệch chuẩn (StdDev/RMSE) và tần suất giật rơ-le (Chattering Counter), lưu kết quả vào bucket `mushroom_analytics`.

```flux
option task = {
  name: "aggregate_kpi_metrics_hourly",
  every: 1h,
  offset: 5m
}

// 1. Pre-calculate Temp/Humid RMSE & Standard Deviation
from(bucket: "mushroom_telemetry")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "environment_telemetry")
  |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
  |> stddev()
  |> set(key: "_measurement", value: "kpi_metrics_1h")
  |> to(bucket: "mushroom_analytics", org: "mushroom_org")

// 2. Pre-calculate Relay Switching Frequency (Chattering Counter)
from(bucket: "mushroom_telemetry")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "actuator_events")
  |> filter(fn: (r) => r._field == "state")
  |> stateChanges(controls: ["_value"])
  |> count()
  |> set(key: "_measurement", value: "kpi_metrics_1h")
  |> set(key: "_field", value: "switch_count_1h")
  |> to(bucket: "mushroom_analytics", org: "mushroom_org")

```

### 2. Optimization Heuristics (TuningRecommenderEngine)

| KPI Condition | Technical Root Cause | Recommendation Delta |
| --- | --- | --- |
| `mistSwitchCountPerHour > 10` | Fuzzy quá nhạy / Nhiễu quanh điểm cài đặt | Tăng `MIST_DEADBAND` từ 3% lên 5%; Tăng `MIST_COOLDOWN` từ 30s lên 45s. |
| `lampAvgOnDurationSec < 30s` | Chu kỳ Slow PWM quá ngắn, bóng A250 bị sốc nhiệt | Tăng `LAMP_SLOW_PWM_CYCLE` từ 180s lên 240s; Đặt `LAMP_MIN_ON = 30s`. |
| `tempRmse > 1.5°C` & `Duty < 30%` | Gain sưởi quá yếu | Tăng Gain đầu ra `K_u_lamp` thêm +8%. |
| `humidRmse > 5.0%` (không chattering) | Phản ứng phun sương chậm | Tăng Gain đầu vào `K_e_humid` thêm +5%. |

---

## 🔄 III. Device Shadow Protocol & Triệt tiêu Ghost Message

### 1. Schema Database PostgreSQL (`device_configurations`)

```sql
CREATE TABLE device_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) NOT NULL,
    command_id VARCHAR(64) NOT NULL UNIQUE,
    desired_config JSONB NOT NULL,
    reported_config JSONB DEFAULT NULL,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | IN_SYNC | REJECTED
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_device_config_sync ON device_configurations(device_id, sync_status);

```

### 2. Quy trình Xóa "Ghost" Retained Message

1. **Gửi lệnh:** Backend phát JSON xuống `devices/{deviceId}/config/desired` với `QoS = 1` và `Retain = true`.
2. **Xử lý ACK & Idempotency:** NestJS nhận tin nhắn từ `devices/{deviceId}/config/reported`. Check nếu `command_id` trùng và trạng thái DB đã là `IN_SYNC` thì bỏ qua (chống lặp).
3. **Xóa Retain Message:** Ngay khi xác nhận lệnh thành công, NestJS publish một **Empty Payload (`""`)** với `Retain = true` vào topic `devices/{deviceId}/config/desired`. Việc này làm sạch broker, ngăn ESP32 nhận lại lệnh cũ nếu bị boot lại sau vài ngày.

---

## ⚡ IV. Hardening Firmware (ESP32-S3)

### 1. `DynamicTuningParams` Struct & NVS Diff-Check (`tuning_config_manager.cpp`)

```cpp
#include <Preferences.h>
#include <math.h>
#include <Arduino.h>

struct DynamicTuningParams {
    char command_id[36] = "";     // Bắt buộc phải lưu UUID/Command ID từ Backend
    float ke_temp = 1.0f;          // Range: 0.8 -> 1.2
    float ku_lamp = 1.0f;          // Range: 0.8 -> 1.2
    float mist_deadband = 3.0f;    // Range: 2.0 -> 8.0 (%)
    uint16_t lamp_pwm_cycle_s = 180;// Range: 120 -> 300 (s)
    uint16_t lamp_min_on_s = 30;   // Range: 20 -> 60 (s)
};

class TuningConfigManager {
private:
    Preferences prefs_;
    DynamicTuningParams current_ram_cfg_;

    bool is_float_different(float a, float b, float epsilon = 0.001f) {
        return fabs(a - b) > epsilon;
    }

public:
    bool applyAndPersistIfDiff(const DynamicTuningParams& incoming) {
        // 1. HARD BOUNDS: Ranh giới an toàn tuyệt đối
        DynamicTuningParams valid = incoming;
        strncpy(valid.command_id, incoming.command_id, sizeof(valid.command_id) - 1);
        valid.ke_temp = constrain(incoming.ke_temp, 0.8f, 1.2f);
        valid.ku_lamp = constrain(incoming.ku_lamp, 0.8f, 1.2f);
        valid.mist_deadband = constrain(incoming.mist_deadband, 2.0f, 8.0f);
        valid.lamp_pwm_cycle_s = constrain(incoming.lamp_pwm_cycle_s, 120U, 300U);
        valid.lamp_min_on_s = constrain(incoming.lamp_min_on_s, 20U, 60U);

        // 2. NVS DIFF-CHECK: Kiểm tra xem thông số thực sự có thay đổi?
        bool need_nvs_write = false;
        if (is_float_different(valid.ke_temp, current_ram_cfg_.ke_temp)) need_nvs_write = true;
        if (is_float_different(valid.ku_lamp, current_ram_cfg_.ku_lamp)) need_nvs_write = true;
        if (is_float_different(valid.mist_deadband, current_ram_cfg_.mist_deadband)) need_nvs_write = true;
        if (valid.lamp_pwm_cycle_s != current_ram_cfg_.lamp_pwm_cycle_s) need_nvs_write = true;
        if (valid.lamp_min_on_s != current_ram_cfg_.lamp_min_on_s) need_nvs_write = true;

        current_ram_cfg_ = valid;

        // 3. CHỈ GHI FLASH NẾU CÓ THAY ĐỔI THỰC SỰ
        if (need_nvs_write) {
            prefs_.begin("fuzzy_cfg", false);
            prefs_.putString("cmd_id", valid.command_id);
            prefs_.putFloat("ke_temp", valid.ke_temp);
            prefs_.putFloat("ku_lamp", valid.ku_lamp);
            prefs_.putFloat("deadband", valid.mist_deadband);
            prefs_.putUShort("pwm_cycle", valid.lamp_pwm_cycle_s);
            prefs_.putUShort("min_on", valid.lamp_min_on_s);
            prefs_.end();
            Serial.println("[NVS] New config persisted to Flash.");
        } else {
            Serial.println("[NVS] Config identical to RAM. Flash write skipped.");
        }
        return true;
    }

    const DynamicTuningParams& getRamConfig() const { return current_ram_cfg_; }
};

```

### 2. Lock-Free Inter-Core IPC (`intercore_config.cpp`)

```cpp
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

QueueHandle_t g_tuning_config_queue = NULL;

void init_intercore_config_queue() {
    // Queue độ sâu = 1, chứa vừa đủ 1 struct config
    g_tuning_config_queue = xQueueCreate(1, sizeof(DynamicTuningParams));
}

// --- CORE 0: Network & MQTT Handler ---
void on_mqtt_config_received(const DynamicTuningParams& incoming_cfg) {
    g_config_manager.applyAndPersistIfDiff(incoming_cfg);
    
    // Gửi atomic POD struct sang Core 1 (Ghi đè non-blocking)
    DynamicTuningParams active_cfg = g_config_manager.getRamConfig();
    xQueueOverwrite(g_tuning_config_queue, &active_cfg);
}

// --- CORE 1: Time-Critical Control Loop (10Hz Tick) ---
void taskCore1Control(void* pvParameters) {
    DynamicTuningParams active_control_cfg = g_config_manager.getRamConfig();

    while (true) {
        DynamicTuningParams incoming_queue_cfg;
        // Kiểm tra xem Core 0 có đẩy config mới sang không
        if (xQueueReceive(g_tuning_config_queue, &incoming_queue_cfg, 0) == pdTRUE) {
            active_control_cfg = incoming_queue_cfg;
            Serial.printf("[CORE 1] Updated active params for CMD: %s\n", active_control_cfg.command_id);
        }

        // Thực thi Fuzzy Logic & Slow PWM dựa trên active_control_cfg...
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

```

---

## 📌 V. Product Backlog Expansion (Outdoor Context - Phase 2)

* **Cảm biến Thời tiết Ngoại cảnh (Outdoor Weather Context):** Tích hợp dữ liệu nhiệt/ẩm ngoài trời từ OpenWeather API hoặc trạm đo thời tiết tại trại.
* **Adaptive Seasonal Heuristics:** Động điều chỉnh trần hệ số $K_u$. Mùa lạnh Nam Bộ ($T_{\text{outdoor}} < 22^\circ\text{C}$ vào ban đêm), tự động nâng trần tối đa của $K_u$ từ `1.20` lên `1.35` để bù lại quán tính lạnh bên ngoài.

---
