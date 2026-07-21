# PROGRESS — IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning

## Started

- **Thời điểm:** 2026-07-21 10:19:34 +07 (+0700)
- **Execution Agent:** Gemini

## Reference Plan

- **Thư mục kế hoạch:** `.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/`
- **File sprint đang tham chiếu:** `.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/sprint_1.md`

## Addition Plan

- Chưa có yêu cầu phát sinh.

## Quy ước trạng thái

- `[ ] Pending`: Task chưa chạm vào.
- `[ ] In Progress`: Execution Agent đang viết code.
- `[ ] QA Review`: Code đã viết xong, đang chờ rà soát chất lượng.
- `[x] Done`: Đã qua vòng review nghiêm ngặt và được duyệt.

## Track A — Contract & Infrastructure (Ngày 1)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| A1 | Định nghĩa constants cho MQTT tuning desired/reported và pattern subscribe; tenant lấy từ `IOT_TENANT`. | `[ ] QA Review` | Áp dụng **Single Source of Truth**: topic builder chỉ nằm tại constants module. Cấm hard-code tenant/device ID; validate segment topic để ngăn topic injection. Giữ namespace `{tenant}/esp32/{deviceId}/...`, không tạo namespace `devices/...`. |
| A2 | Bổ sung kiểm tra ACL publish/read tuning cho HTTP MQTT auth backend. | `[ ] QA Review` | Áp dụng **deny-by-default** và **least privilege**. Backend superuser mới được publish desired; device chỉ read desired và publish reported của chính nó. Không dựa vào `mosquitto.acl` vì runtime dùng HTTP ACL. |
| A3 | Viết fixture `acl.tuning.spec.ts`: backend publish desired OK; device publish desired deny; device publish reported device khác deny; device read desired của mình OK. | `[ ] QA Review` | Test là security regression bắt buộc; thêm cả assert không có wildcard vượt tenant/device. Không giảm coverage của `MqttAuthService`; test phải độc lập với credential thật. |
| A4 | Search và xóa/deprecate mọi key legacy `lamp_pwm_cycle_s`, `lamp_min_on_s`, `ke_temp`, `ku_lamp` trong backend và firmware interfaces. | `[ ] QA Review` | Không đưa TPC/PWM trở lại contract. Xóa chỉ khi không dùng production; nếu cần tương thích thì đánh dấu `@deprecated`, cấm map sang tuning v1. Kiểm tra toàn repo trước/sau thay đổi để không tạo API mồ côi. |
| A5 | Thêm `INFLUXDB_ANALYTICS_BUCKET` vào cấu hình backend và tạo script provision bucket analytics idempotent. | `[ ] QA Review` | Cấu hình qua environment, không hard-code `mushroom_analytics`. Script phải **idempotent**, verify bucket trước create, retention configurable. Không sửa lock/generated file; ghi hướng dẫn vận hành/recovery tối thiểu. |

## Track B — Backend: Live Controller History Writer (Ngày 1–3)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| B1 | Định nghĩa interface `LiveTelemetryPoint` gồm device, timestamp, quality, đo lường, Core-1 target/source/revision và final relay states. | `[ ] QA Review` | Dùng **typed domain model** trong TypeScript strict; field nullable phải biểu thị rõ dữ liệu thiếu. Không suy diễn setpoint từ crop profile hiện tại; target chỉ hợp lệ nếu Edge báo cáo tại thời điểm telemetry. |
| B2 | Cài `ControlHistoryInfluxWriter`: subscribe `telemetry$`, map/enrich telemetry, ghi measurement `controller_history`, và xử lý lỗi ghi. | `[ ] QA Review` | Áp dụng **Observer pattern** với `takeUntil(destroy$)` để tránh subscription leak. Writer bất đồng bộ, lỗi chỉ log có `device_id` và skip—không làm ngắt MQTT pipeline, không retry vô hạn. Gắn `data_quality=good/missing_target/degraded`; chỉ final relay states do Core 1 xác nhận. |
| B3 | Đăng ký writer vào `InfluxModule` và import `MqttModule` cần thiết. | `[ ] QA Review` | Duy trì Dependency Injection của NestJS; không tự khởi tạo service/new client. Kiểm tra vòng lặp dependency, lifecycle shutdown và module test; export service chỉ khi thật sự có consumer. |

## Track C — Firmware: POD, NVS Two-Slot, Queue (Ngày 2–4)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| C1 | Thêm POD DynamicTuningParams trong core/models.h với command UUID, revision và bốn tham số tuning. | `[ ] QA Review` | C++17, **POD/value-object pattern**: không `String`, pointer hay JSON handle; `static_assert(std::is_trivially_copyable<...>)`. Cấm `#pragma pack(1)`; giữ ABI/alignment tự nhiên và bounds contract v1. |
| C2 | Định nghĩa `TuningNvsRecord` two-slot gồm version, generation, params và CRC32. | `[ ] QA Review` | Áp dụng **versioned CRC envelope / double-buffer persistence**. CRC tính toàn record trừ field CRC; record immutable trước khi write. Không dùng/chung key baseline hoặc crop profile. |
| C3 | Khai báo public API, enum result/reason code cho singleton `TuningConfigManager`. | `[ ] QA Review` | Áp dụng **Single Responsibility**: manager Core 0 sở hữu validation/persistence/dispatch; API trả stable domain status, không lộ NVS internals. Sửa typo API trước merge (`getActiveParams`). |
| C4 | Implement validation schema, provisioned device ID, UUID, finite JSON number, bounds, cross-field, duplicate và semantic diff. | `[ ] QA Review` | **Validate-before-mutate** tuyệt đối: reject input bất kỳ trước khi đổi RAM/NVS/queue. Không silent clamp remote command; UUID kiểm tra char-by-char bounded, không dùng regex cấp phát. Dùng epsilon `0.001f` cho float, string exact. |
| C5 | Implement đọc/ghi NVS two-slot: verify CRC/readback, chọn generation mới nhất, wear-level slot và fallback defaults. | `[ ] QA Review` | **Crash consistency**: chỉ thay active state sau persistence thành công; boot chọn record CRC hợp lệ generation cao nhất, cả hai lỗi thì safe defaults và warning. Không `nvs_flash_erase`; test power-loss/corrupt record. |
| C6 | Khai báo `g_tuning_config_queue` depth 1 cho `DynamicTuningParams`. | `[ ] In Progress` | Queue là ranh giới ownership Core 0 → Core 1; chỉ truyền POD by value. Không dùng mutex chia sẻ control state; không đổi queue của baseline/config sync hiện hữu. |
| C7 | Tạo queue trước task start, hydrate NVS và enqueue effective config khởi tạo. | `[ ] QA Review` | Fail-fast nếu queue null trước task start. Thứ tự bắt buộc: tạo queue → hydrate → enqueue; không GPIO/MQTT/NVS trong Core 1. Queue update chỉ dùng `xQueueOverwrite`, non-blocking. |

## Track D — Firmware: MQTT Subscribe/Dispatch (Ngày 2–3)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| D1 | Subscribe desired topic QoS 1 khi MQTT kết nối lại. | `[ ] QA Review` | Build topic từ tenant và provisioned device ID, không literal. Retained desired phải được xử lý như command bình thường sau reconnect; không tác động GPIO từ MQTT path. |
| D2 | Nhận diện desired topic và dispatch payload vào `g_network_worker_queue`; reject/log payload quá 512 bytes. | `[ ] QA Review` | MQTT callback phải **constant-time/lightweight**: chỉ compare topic và copy bytes, tuyệt đối không `deserializeJson`, NVS hay GPIO. Bounded buffer, kiểm tra length trước copy để tránh overflow/heap growth. |
| D3 | Parse desired trong worker bằng `StaticJsonDocument<512>` và gọi `TuningConfigManager::processCommand`. | `[ ] QA Review` | Parse bounded trên stack; mọi `DeserializationError` phải sinh `REJECTED/INVALID_SCHEMA`, không crash. Worker là sole execution context của JSON validation/persistence. |
| D4 | Xây reported payload theo contract và publish lên reported topic QoS 1, retain=false. | `[ ] Pending` | Chỉ publish `ACCEPTED` khi NVS **và** `xQueueOverwrite` thành công. `DUPLICATE` kèm effective config; `REJECTED` dùng reason code ổn định; không log/echo payload nhạy cảm không cần thiết. Xác minh API PubSubClient thực sự cấu hình QoS 1. |

## Track E — Firmware: Core 1 Apply Tuning (Ngày 4–5)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| E1 | Drain `g_tuning_config_queue` ở đầu control tick vào local `s_activeTuning` có defaults an toàn. | `[ ] Pending` | Áp dụng **single-writer ownership**: Core 1 chỉ sở hữu local active copy; adoption chỉ tại tick boundary 50 ms. `xQueueReceive(..., 0)` không block; Core 1 không gọi MQTT/NVS. |
| E2 | Nhân demand `HLamp`/`Mist` với gain scale sau fuzzy/adaptive gain và clamp `[0,1]`. | `[ ] Pending` | Thứ tự pipeline bất biến: fuzzy → tuning scale → arbitration/direct relay → manual latch → protector → blackout/final GPIO. Không tune HWat, setpoint, bio-bound, blackout, manual override hay `SystemProtector`. |
| E3 | Khai báo helper `resolveBinaryDemand(demand, state, on, off)`. | `[ ] Pending` | Dùng **pure function pattern** (không GPIO/side effect) để unit-test table-driven. Precondition `off < on`; không thay đổi public behavior của lamp/fan. |
| E4 | Implement helper hysteresis ON/OFF/hold. | `[ ] Pending` | Giữ logic deterministic: OFF→ON khi `>= on`, ON→OFF khi `< off`, còn lại giữ state. Test biên threshold, NaN defense và state transition. |
| E5 | Refactor `applyDirectOutputs()` sử dụng helper: Mist dùng threshold động; lamp/fan giữ `0.25/0.15`. | `[ ] Pending` | **Safety regression gate**: không reference `mist_*_threshold` tại branch lamp/fan. Không mô tả/triển khai PWM; direct relay active-LOW giữ nguyên. Bảo toàn final interlock, max-ON/cooldown và blackout. |
| E6 | Truyền `s_activeTuning` vào actuator controller trước relay resolution. | `[ ] Pending` | Ưu tiên parameter injection `const DynamicTuningParams&` hơn mutable global/setter để giảm hidden state. Thay đổi signature tối thiểu, cập nhật tất cả callers và regression test. |

## Track F — Backend: DB Migration, Entity, Shadow Service (Ngày 5–7)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| F1 | Tạo migration `1720656000006` cho `device_tuning_configurations` và index theo device/thời gian. | `[ ] Pending` | Migration là **nguồn sự thật duy nhất** cho schema; reversible `down`, FK đúng `devices(device_id)`, index phục vụ latest lookup. UUID tạo tại application nếu không bảo đảm `pgcrypto`; không sửa migration cũ. |
| F2 | Tạo migration `1720656000007` cho `tuning_audit_logs` và index theo device/thời gian. | `[ ] Pending` | Audit append-only; lưu actor/source/action/ruleset/KPI/before/after/reason/result. Bảo toàn referential integrity, không lưu secrets/credential trong JSONB; migration phải chạy clean database và upgrade database. |
| F3 | Khai báo entity `DeviceTuningConfiguration`, `TuningConfigSnapshot` và `SyncStatus`. | `[ ] Pending` | Áp dụng **domain model rõ kiểu**; JSONB snapshot phải là full effective config, không patch. Mapping column/relationship khớp migration; strict nullability và enum không dùng string rải rác. |
| F4 | Khai báo entity `TuningAuditLog`. | `[ ] Pending` | Entity chỉ phản chiếu migration, không dùng synchronize schema. Audit không được sửa/xóa bởi normal service flow; truy vấn luôn theo device và phân trang. |
| F5 | Implement `handleReportedAck()` với type guard, transaction/row lock, canonical comparison, state transition, audit và SSE sau commit. | `[ ] Pending` | Áp dụng **transactional outbox discipline**: `SELECT ... FOR UPDATE`, idempotent khi ACK QoS-1 lặp; chỉ phát `tuningSync$` sau commit. ACK unknown/sai device chỉ security log, không mutate shadow hay clear retained. Raw DB error phải chuyển thành domain exception/log an toàn. |
| F6 | Implement `createPendingCommand()` tạo desired/audit, publish desired retained QoS 1 và ghi thời điểm publish. | `[ ] Pending` | Actor phải từ JWT đã verify, không từ client. Dùng command idempotency key, full config snapshot và ownership check. Làm rõ xử lý lỗi publish (không được để row PENDING mồ côi không audit/retry strategy); không auto-apply. |
| F7 | Implement `getLatestByDeviceId()` với latest durable shadow. | `[ ] Pending` | Query deterministic `ORDER BY created_at DESC LIMIT 1`, indexed, typed return. Không dùng in-memory map/configSync làm source of truth. |
| F8 | Implement `getTuningHistory()` với phân trang. | `[ ] Pending` | Enforce default 20, max 100 ở controller/service; TypeORM `take/skip`, stable order. Tuyệt đối không truy vấn lịch sử vô hạn hoặc trả audit của device khác. |
| F9 | Khai báo `TuningModule`, import dependencies, export service và import vào `AppModule`. | `[ ] Pending` | Tuân thủ **modular Clean Architecture**: controller/service/entity ở module riêng, không nhồi endpoint vào `DeviceController`; kiểm tra circular dependencies và test module bootstrap. |
| F10 | MqttService subscribe wildcard reported QoS 1, type-guard payload và route tới `TuningConfigurationService`. | `[ ] Pending` | Subscribe đúng `{tenant}/esp32/+/up/tuning/reported` theo tenant config, tránh wildcard cross-tenant. Handler không trust payload; duplicate phải idempotent. Conditional retained-clear chỉ khi ACK thuộc latest pending command của đúng device. |

## Cổng QA bắt buộc trước khi chuyển Sprint 2

- [ ] Contract không còn key/TPC topic legacy; ACL tuning tests pass.
- [ ] Live controller history ghi target/source/revision/final relay states; offline thiếu dữ liệu được đánh `data_quality=degraded`.
- [ ] Firmware tests pass: valid/invalid schema, bounds, cross-field, duplicate, NVS corrupt, no-write semantic diff và concurrent burst.
- [ ] Regression xác nhận lamp/fan vẫn dùng threshold `0.25/0.15`; blackout, uncertain time, bio-bound, max-ON/cooldown và `SystemProtector` luôn thắng tuning.
- [ ] Migrations chạy thành công; `PENDING → IN_SYNC/REJECTED` durable; QoS-1 duplicate không thêm transition/SSE; ACK cũ hoặc ACK lạ không clear retained desired mới.
