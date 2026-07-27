# Staging 24 giờ và rollback checklist — Dynamic Tuning v2.2

> **Release gate S2-5 — bắt buộc.** Không được phát hành production nếu còn bất kỳ mục bắt buộc nào chưa đánh dấu, thiếu bằng chứng, có kết quả `FAIL`, hoặc chưa đủ chữ ký. Không dùng kết quả unit/E2E để thay thế dry-run trên staging thật.

## 1. Thông tin phiên chạy và nguyên tắc dừng

| Trường | Giá trị |
|---|---|
| Release/build backend | `________________` |
| Release/build UI | `________________` |
| ESP32 artifact SHA-256 / Git SHA | `________________` |
| Phiên bản firmware runtime báo cáo | `________________` |
| Device ID staging | `________________` |
| Tenant staging | `________________` |
| Operator | `________________` |
| QA/Reviewer độc lập | `________________` |
| Bắt đầu (ISO 8601 + múi giờ) | `________________` |
| Kết thúc dự kiến (ít nhất +24 giờ) | `________________` |
| Thư mục/URL lưu bằng chứng | `________________` |

- [ ] Xác nhận đây là môi trường staging cô lập, không dùng device, bucket, broker topic hoặc database production.
- [ ] Xác nhận đã chụp backup PostgreSQL, export cấu hình InfluxDB Task và ghi nhận image/artifact đang chạy trước deploy; thử đọc được metadata backup.
- [ ] Xác nhận người thực hiện có quyền rollback và kênh liên lạc sự cố; không ghi token, mật khẩu, JWT hoặc nội dung `.env` vào bằng chứng.
- [ ] Ghi baseline trước thử nghiệm: DB command mới nhất, config/revision trên Edge, retained desired hiện tại, backend RSS, ESP32 free/minimum heap, reset reason và uptime.
- [ ] Xác nhận thời gian backend, broker, trình duyệt và ESP32 được đồng bộ đủ để đối chiếu ACK 10 giây; ghi sai lệch lớn nhất: `________ ms`.

**Dừng ngay và đánh dấu release gate `FAIL` nếu:** relay/GPIO ở trạng thái không an toàn; config DB khác reported/active config; ACK sai device/command/revision; desired mới bị ACK cũ xóa; có crash/boot loop/watchdog; mất dữ liệu/audit; memory giảm đơn điệu không hồi phục; hoặc rollback không hoàn tất. Khi dừng, không xóa bằng chứng và áp dụng factory-safe rollback tại Mục 7 nếu hệ thống còn điều khiển được an toàn.

## 2. Deploy backend, migration và analytics

### 2.1 PostgreSQL migration

- [ ] Deploy đúng backend artifact đã ghi ở Mục 1; health/readiness không ở trạng thái degraded ngoài các maintenance window đã phê duyệt.
- [ ] Từ `mushroom-backend/`, chạy `pnpm run migration:run`; lệnh kết thúc mã `0`, không có migration pending hoặc lỗi DDL.
- [ ] Kiểm tra bảng migration ghi nhận đầy đủ chuỗi tuning `1720656000006` đến `1720656000014`; lưu output đã loại bỏ thông tin kết nối.
- [ ] Kiểm tra tồn tại và đúng quyền tối thiểu cho `device_tuning_configurations`, `tuning_audit_logs`, `tuning_mqtt_outbox`, `tuning_sse_ticket_consumptions` cùng các index/constraint tương ứng.
- [ ] Chạy `pnpm run test:migrations:integration` trên database test riêng với `TUNING_MIGRATION_DATABASE_URL`; **không** trỏ lệnh test destructive này vào staging/production. Kết quả: `PASS / FAIL`.
- [ ] Smoke query chỉ đọc thành công và không có row tuning mồ côi:

```sql
SELECT c.id
FROM device_tuning_configurations AS c
LEFT JOIN devices AS d ON d.device_id = c.device_id
WHERE d.device_id IS NULL;

SELECT a.id
FROM tuning_audit_logs AS a
LEFT JOIN device_tuning_configurations AS c ON c.id = a.configuration_id
WHERE c.id IS NULL;
```

Tiêu chí: cả hai query trả `0 rows`. Bằng chứng: `________________`.

### 2.2 InfluxDB analytics bucket và hourly task

- [ ] Xác nhận `INFLUXDB_BUCKET` và `INFLUXDB_ANALYTICS_BUCKET` là hai bucket staging đúng chủ đích, không rỗng và không phải bucket production.
- [ ] Từ root repository, chạy idempotent `./scripts/provision-influx.sh`; chạy lần hai vẫn thành công và báo bucket đã tồn tại.
- [ ] Qua InfluxDB API/UI, xác nhận analytics bucket có retention đúng phê duyệt. Bucket: `________`; retention: `________`.
- [ ] Restart/bootstrap backend và xác nhận duy nhất một task tên `kpi_hourly_aggregation`, trạng thái `active`, lịch `every: 1h`, `offset: 5m`; không có task trùng tên.
- [ ] Xác nhận Flux task đọc bucket source đã cấu hình, ghi measurement `kpi_metrics_1h` vào bucket analytics và chỉ dùng `data_quality == "good"`; không lưu token trong ảnh/log.
- [ ] Sau ít nhất một cửa sổ chạy, xác nhận task không có lỗi và có row KPI cho device staging với `sample_count`, `sum_squared_error_temp`, `sum_squared_error_humid`, `valid_samples`, `expected_samples` và `data_coverage_percent` hợp lệ.

Ghi task ID, lần chạy gần nhất và link bằng chứng: `________________`.

## 3. ESP32 và kết nối MQTT

> “v2.2” ở gate này là **contract/kế hoạch Dynamic Tuning v2.2**. Ghi riêng phiên bản runtime do firmware báo cáo; source hiện có thể dùng semantic version khác. Không suy đoán phiên bản từ tên artifact.

- [ ] Flash đúng ESP32 artifact đã phê duyệt; kiểm tra SHA-256/Git SHA khớp Mục 1 và artifact triển khai contract Dynamic Tuning v2.2.
- [ ] Boot hoàn tất, không crash/boot loop/watchdog; các relay khởi tạo fail-safe OFF trước khi control loop hoạt động.
- [ ] Device kết nối đúng tenant/device identity và subscribe QoS 1 vào duy nhất topic desired của nó: `<tenant>/esp32/<deviceId>/down/tuning/desired`.
- [ ] Backend subscribe QoS 1 vào `<tenant>/esp32/+/up/tuning/reported`; ACL staging chặn device đọc/publish topic của device khác.
- [ ] Telemetry/heartbeat ghi nhận đúng firmware runtime, uptime, online state và device ID. Bằng chứng: `________________`.
- [ ] Baseline active tuning đọc được là snapshot đã biết; nếu chưa từng tune thì factory-safe phải là gain `1.00/1.00`, Mist `on=0.25`, `off=0.15`.

## 4. Luồng apply online và ACK trong 10 giây

- [ ] Mở DevTools/EventSource trước khi submit; SSE kết nối qua same-origin route và chỉ nhận event của device staging.
- [ ] Trong UI, review KPI, ruleset và diff; operator bấm xác nhận rõ ràng. Không gọi POST tự động và không coi HTTP `202 PENDING` là thành công cuối.
- [ ] Ghi `commandId`, revision, snapshot desired và thời điểm submit bằng clock đồng bộ: `________________`.
- [ ] Broker nhận desired đúng topic, QoS `1`, retained `true`; envelope có đúng schema/device/command/revision và bốn trường config.
- [ ] ESP32 trả `ACCEPTED`, `persisted=true`, đúng `commandId`, revision và canonical `reported_config` trong **không quá 10 giây** từ submit.
- [ ] Độ trễ quan sát: `________ ms` (tiêu chí `<= 10000 ms`).
- [ ] DB thể hiện đúng một transition durable `PENDING → IN_SYNC`; `reported_config` bằng `config`, `reported_revision` bằng `revision`, `rejection_reason IS NULL`.
- [ ] `updated_at - created_at <= interval '10 seconds'` cho command nếu clocks/server flow cho phép; nếu dùng stopwatch thay thế, đính kèm cả timestamp submit và ACK.
- [ ] Audit có actor từ JWT đã verify, source/action/result, `config_before`, `config_after`, KPI snapshot/ruleset khi có; không có bản ghi trùng cho cùng transition.
- [ ] Trình duyệt nhận SSE `IN_SYNC` đúng `deviceId`/`commandId` **sau DB commit**; UI chỉ lúc này mới hiển thị thành công.
- [ ] Retained desired được clear sau terminal commit; không clear trước ACK và không còn outbox item lỗi/quá hạn.

Query kiểm tra tham khảo (bind `:device_id`, `:command_id`; không nối chuỗi input):

```sql
SELECT command_id, revision, status, config, reported_config,
       reported_revision, rejection_reason, created_at, updated_at
FROM device_tuning_configurations
WHERE device_id = :device_id AND command_id = :command_id;

SELECT actor, source, action, ruleset_version, kpi_snapshot,
       config_before, config_after, result, created_at
FROM tuning_audit_logs
WHERE device_id = :device_id AND configuration_id = (
  SELECT id FROM device_tuning_configurations
  WHERE device_id = :device_id AND command_id = :command_id
)
ORDER BY created_at;
```

DB/audit/SSE/broker evidence: `________________`.

## 5. Offline retained và reconnect

- [ ] Ngắt mạng/power của ESP32 có kiểm soát và xác nhận backend coi device offline; giữ offline tối thiểu **5 phút**.
- [ ] Trong lúc offline, submit một desired mới đã được operator review; DB ở `PENDING`, broker giữ đúng payload mới nhất QoS 1/retained và không có ACK giả.
- [ ] Sau 5 phút, kiểm tra retained payload vẫn đúng byte/command/revision; không dùng subscribe client làm vô tình publish/clear topic.
- [ ] Reconnect đúng device; broker giao retained desired, ESP32 persist/apply một lần rồi report `ACCEPTED`.
- [ ] ACK đến trong **10 giây kể từ khi MQTT reconnect/subscription hoàn tất**. Độ trễ: `________ ms`.
- [ ] DB chuyển đúng command `PENDING → IN_SYNC`; audit và SSE mỗi loại chỉ có một terminal event; retained desired được clear sau commit.
- [ ] Không có NVS write thừa khi QoS-1 redeliver cùng command; config/revision không drift và ACK cũ không thể clear desired mới hơn.

Command ID offline, timestamp và bằng chứng broker/DB/audit/SSE/NVS: `________________`.

## 6. Bất biến actuator và theo dõi 24 giờ

### 6.1 Lamp/Fan không bị Mist tuning chi phối

- [ ] Với phê duyệt vận hành và điều kiện an toàn, apply Mist `on=0.30`, `off=0.18`; không thay đổi ngoài bốn key tuning được phép.
- [ ] Quan sát/trace xác nhận Mist dùng band `0.30/0.18`, còn Lamp và Fan vẫn dùng threshold cố định `FUZZY_ON_THRESHOLD=0.25` và `FUZZY_OFF_THRESHOLD=0.15`.
- [ ] Xác nhận blackout, uncertain-time, bio-bound, max-ON/cooldown và manual safety override vẫn thắng tuning; không có unsafe GPIO.

Bằng chứng demand/relay trước-sau: `________________`.

### 6.2 Cửa sổ dry-run liên tục tối thiểu 24 giờ

Mốc lấy mẫu tối thiểu: `T0`, `T+1h`, `T+6h`, `T+12h`, `T+18h`, `T+24h`. Không reset service/device để che memory growth; mọi restart ngoài kế hoạch đều làm gate thất bại và phải chạy lại cửa sổ 24 giờ.

| Mốc | DB latest command/status/revision | Edge active revision | Retained desired | Backend RSS/heap | ESP free/min heap | Reset/crash count | Ghi chú |
|---|---|---|---|---|---|---|---|
| T0 | | | | | | | |
| T+1h | | | | | | | |
| T+6h | | | | | | | |
| T+12h | | | | | | | |
| T+18h | | | | | | | |
| T+24h | | | | | | | |

- [ ] Chạy đủ `>=24h`; ghi thời lượng thực tế: `________`.
- [ ] Tại mọi mốc, DB latest `IN_SYNC` khớp Edge active/reported config và revision; không xuất hiện transition, audit hoặc SSE ngoài command hợp lệ.
- [ ] Không còn retained desired sau terminal command; không có outbox pending/retry bất thường và không có state drift sau reconnect/restart đã lên kế hoạch.
- [ ] Không crash, panic, watchdog, boot loop, unsafe relay transition hoặc flash/NVS write lặp vô cớ.
- [ ] Backend RSS/heap và số SSE listener/connection trở về baseline sau thao tác; không tăng đơn điệu qua các mốc.
- [ ] ESP32 free/minimum heap ổn định trong ngưỡng đã phê duyệt, queue tuning không vượt depth 1 và không có xu hướng memory leak.
- [ ] Influx hourly task chạy đủ các cửa sổ, không task failure; KPI coverage và sample count hợp lý với thời gian online/offline thực tế.

Link dashboard/log đã redacted và kết luận 24 giờ: `________________`.

## 7. Factory-safe rollback drill

Factory-safe snapshot được phê duyệt:

```json
{
  "lamp_gain_scale": 1.0,
  "mist_gain_scale": 1.0,
  "mist_on_threshold": 0.25,
  "mist_off_threshold": 0.15
}
```

- [ ] Hai người (operator và reviewer) xác nhận snapshot trên trước khi gửi; tạo `commandId` UUID v4 mới. Không sửa DB, publish MQTT thủ công hoặc xóa NVS để giả lập thành công.
- [ ] Gửi rollback qua cùng guarded `POST /devices/:id/tuning-configurations`/UI, cùng durable outbox, retained QoS 1, Edge validation/persistence, reported ACK, audit và SSE flow như apply bình thường.
- [ ] HTTP chỉ trả `202 PENDING`; nhận `ACCEPTED persisted=true` trong 10 giây và chỉ công nhận rollback sau DB `IN_SYNC` + SSE khớp command.
- [ ] DB `config` và `reported_config` đều bằng factory-safe snapshot; revision tăng đơn điệu, retained desired được clear sau commit.
- [ ] Audit ghi actor, source=`rollback` hoặc reason rollback được phê duyệt, before/after và result; bằng chứng không chứa credential.
- [ ] Sau reboot có kiểm soát, ESP32 hydrate đúng factory-safe snapshot từ NVS, không quay lại config cũ và không ghi flash thừa.
- [ ] Xác nhận crop profile, Wi-Fi, provisioning identity/credentials và telemetry continuity không bị xóa/thay đổi; rollback tuning chỉ tác động namespace/record tuning.
- [ ] Xác nhận relay behavior an toàn và Lamp/Fan vẫn dùng `0.25/0.15` sau rollback.

Rollback command ID, độ trễ và bằng chứng: `________________`.

**Recovery nếu cả hai tuning NVS slot corrupt:** dùng firmware recovery path để fallback riêng tuning về snapshot factory-safe; không factory-reset toàn thiết bị và không xóa crop profile, Wi-Fi hay provisioning credentials. Sau recovery phải chạy lại các kiểm tra DB/ACK/audit/SSE liên quan trước khi ký duyệt.

## 8. Tổng kết release gate và chữ ký

- [ ] Tất cả mục bắt buộc ở trên đã `PASS`; không có waiver miệng hoặc bằng chứng còn thiếu.
- [ ] Đã rà soát incident/error log trong toàn bộ cửa sổ; danh sách issue (hoặc `Không có`): `________________`.
- [ ] Recommendation/KPI cuối đã được operator review như advisory, không được coi là lệnh tự động.
- [ ] Backup/recovery và factory-safe rollback drill đều thực thi được; đường quay lại artifact backend/UI/firmware trước deploy đã được xác nhận.
- [ ] QA/Reviewer độc lập đối chiếu command ID xuyên suốt broker → DB → audit → SSE → Edge và xác nhận không state drift/memory leak.

| Vai trò | Họ tên | Quyết định (`APPROVE`/`REJECT`) | Thời gian ISO 8601 | Chữ ký |
|---|---|---|---|---|
| Operator | | | | |
| QA/Reviewer độc lập | | | | |
| Release owner | | | | |

**Kết luận gate S2-5:** `PASS / FAIL`
**Release ticket/biên bản:** `________________`
**Ghi chú:** `________________`
