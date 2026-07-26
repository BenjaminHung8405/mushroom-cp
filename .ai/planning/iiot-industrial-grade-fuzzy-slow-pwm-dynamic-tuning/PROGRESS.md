# PROGRESS — IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning — Sprint 2

## Started

- **Thời điểm:** 2026-07-25 14:27:44 +07 (+0700)
- **Execution Agent:** Gemini

## Reference Plan

- **Thư mục kế hoạch:** `.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/`
- **File sprint đang tham chiếu:** `.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/sprint_2.md`

## Addition Plan

- Chưa có yêu cầu phát sinh.

## Quy ước trạng thái

- `[ ] Pending`: Task chưa chạm vào.
- `[ ] In Progress`: Execution Agent đang viết code.
- `[ ] QA Review`: Code đã viết xong, đang chờ rà soát chất lượng.
- `[x] Done`: Đã qua vòng review nghiêm ngặt và được duyệt.

## Track G — Influx Task & KPI Provisioning (Ngày 8–9)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| G1 | Viết Flux Task script `src/influx/tasks/kpi-hourly.flux` cho InfluxDB hourly aggregation. | `[x] Done` | **Pure Flux Script Directive:** Định nghĩa task `every: 1h, offset: 5m`. Đọc từ bucket cấu hình `INFLUXDB_BUCKET` (cấm hard-code tên bucket). Chỉ lọc bản ghi `data_quality == "good"`; group `(device_id, control_source, config_revision)`. Tích lũy `sum_squared_error` temp/humid (không RMSE từng giờ), đếm transition Mist false→true, tích lũy thời lượng Lamp ON (ticks × 5s; cấm average), và tính coverage `valid_samples / 720 × 100`. Ghi sang `mushroom_analytics`, measurement `kpi_metrics_1h`. |
| G2 | Implement `InfluxTaskProvisionerService` trong `src/influx/services/influx-task-provisioner.service.ts` để provision task khi bootstrap. | `[x] Done` | **Idempotent Bootstrapper & Lifecycle:** Thực thi từ `onApplicationBootstrap()`. Kiểm tra Tasks API theo tên `kpi_hourly_aggregation`: active thì skip, disabled thì re-enable, chưa có thì create từ Flux script đọc tương đối theo `__dirname`. Không tạo task trùng khi restart; xử lý lỗi có cấu trúc, không làm ứng dụng NestJS boot trong trạng thái half-configured. |

## Track H — Control Analytics Service (Ngày 8–9)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| H1 | Định nghĩa interface `KpiMetrics` v1 tại `src/analytics/interfaces/kpi-metrics.interface.ts`. | `[x] Done` | **Strict Domain Model Pattern:** Khai báo đầy đủ `deviceId`, time window, RMSE, switching/duty/duration metrics, coverage, sample count, `configRevision: number \| null`, và `dataQualityWarning`. Bật TypeScript strict; không dùng `any`, không làm rơi trạng thái dữ liệu thiếu. |
| H2 | Định nghĩa interface `TuningAdvisory` và discriminated union `RecommendationResult` tại `src/analytics/interfaces/tuning-advisory.interface.ts`. | `[x] Done` | **Type-Safe Advisory Structure:** Advisory phải có `rulesetVersion`, snapshot current/suggested, `delta`, rules trigger, confidence, expected benefit, KPI snapshot và observation-window flag. Union phân biệt rõ `ADVISORY`, `INSUFFICIENT_DATA`, `NO_SUGGESTION`, `CONFLICT`; caller phải exhaustively handle mọi status. |
| H3 | Implement `ControlAnalyticsService.getKpiForDevice()` truy vấn analytics bucket và tính rolling KPI. | `[x] Done` | **Statistical Correctness & Flux Injection Defense (SEC-S2-03, CORR-S2-01):** BẮT BUỘC escape mọi string Flux bằng `escapeFluxString(deviceId)`; cấm raw interpolation `${deviceId}`. RMSE phải là `sqrt(sum(sum_squared_error) / sum(sample_count))`, tuyệt đối không average RMSE theo giờ. Tính đúng switch/hour, lamp duty, average duration, coverage và trả `null` nếu không có data. |
| H4 | Implement `ControlAnalyticsService.checkCoverageGate()` kiểm tra coverage, trusted samples và revision. | `[x] Done` | **Gatekeeper Pattern (CORR-S2-02):** `<80%` trả `COVERAGE_BELOW_80_PERCENT`; mixed quality + `<100` samples trả `INSUFFICIENT_TRUSTED_SAMPLES`; revision null trả `CONFIG_REVISION_UNAVAILABLE`. Bất kỳ gate nào fail đều ngăn recommender chạy. |
| H5 | Implement `ControlAnalyticsService.checkDeviceOnline()` kiểm tra telemetry last-seen trong 5 phút. | `[x] Done` | **Fail-Closed Availability Check:** Truy vấn timestamp telemetry mới nhất; chỉ trả online khi `lastSeen > now - 5 minutes`. Lỗi truy vấn/không có telemetry phải được coi là offline, không phát advisory cho device không thể xác nhận. |

## Track I — Tuning Recommender Engine (Ngày 9)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| I1 | Định nghĩa ruleset version và constants/thresholds của recommender trong `TuningRecommenderEngine`. | `[ ] Pending` | **Immutable Rule Configuration:** Dùng `RULESET_VERSION = 'v1.0.0'` và `RULE_THRESHOLDS as const`: chatter 10/h, temp RMSE 1.5, humid RMSE 5.0, lamp duty 30%, gain step 0.05, Mist threshold step 0.02. Không hard-code magic number rải rác trong branches. |
| I2 | Implement pure function `generateRecommendation(kpi, currentConfig)`. | `[ ] Pending` | **Pure Function & Rule Conflict Detection (CORR-S2-03):** Không async/I-O/side effect. Áp dụng R1 Mist chattering, R2 Temp high + Lamp duty low, R3 Humid high + Mist ổn định. Nếu R1 và R3 cùng trigger thì trả `CONFLICT` với đủ rules, không âm thầm ưu tiên rule nào. Advisory chỉ thay đổi keys trong `delta`, lưu version/rules/KPI/current snapshot. |
| I3 | Implement helper `clampToHardBounds()` cho các tham số tuning. | `[ ] Pending` | **Boundary Validation Pattern:** Áp cứng PLAN v2.2: gain [0.80, 1.20], `mist_on` [0.20, 0.35], `mist_off` [0.10, 0.20]; dùng `Math.max(min, Math.min(max, value))`. Không đề xuất bất kỳ key TPC/PWM/HWat/parameter không có firmware source-of-truth. |
| I4 | Implement helper `validateHysteresis(on, off)`. | `[ ] Pending` | **Physical Invariant Enforcement:** Chỉ hợp lệ nếu `off < on`. Không silently fix hysteresis sai; proposal invalid phải bị reject/blocked để tránh che giấu lỗi ruleset. |

## Track J — Authz & REST/SSE Tuning Module (Ngày 9–10)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| J1 | Implement `DeviceOwnershipGuard` tại `src/tuning/guards/device-ownership.guard.ts`. | `[ ] Pending` | **Zero-Trust Authz Guard (SEC-S2-02):** Lấy `deviceId` từ `req.params.id`, `userId` từ JWT đã verify (`req.user.sub`), gọi `DevicesService.isDeviceOwnedByUser()`. Không sở hữu phải ném `ForbiddenException` 403; không bypass bằng client input hoặc ownership cache không có invalidation. |
| J2 | Implement `DevicesService.isDeviceOwnedByUser()` bằng DB query ownership. | `[ ] Pending` | **Least-Privilege Query:** Parameterize `SELECT 1 FROM devices WHERE device_id = $1 AND owner_user_id = $2`; chỉ trả boolean. Không leakage existence của device, không SQL string concatenation, tối ưu truy vấn bằng index hiện có/phù hợp. |
| J3 | Implement `CreateTuningConfigurationDto` tại `src/tuning/dtos/create-tuning-configuration.dto.ts`. | `[ ] Pending` | **Input Sanitization & SEC-S2-01:** Dùng `class-validator`: UUID v4 command ID, numeric strict + min/max hard bounds, nested validation và custom `@IsMistHysteresisValid()`. DTO tuyệt đối không có `requestedBy`; actor chỉ được lấy từ verified JWT. Reject number string, null, missing fields qua validation pipe. |
| J4 | Implement `TuningRecommendationResponseDto` tại `src/tuning/dtos/tuning-recommendation-response.dto.ts`. | `[ ] Pending` | **Canonical API DTO Pattern:** Bao gồm `deviceId`, `kpi`, current config, advisory, block reason (`INSUFFICIENT_DATA`, `DEVICE_OFFLINE`, `NO_SUGGESTION`, `CONFLICT` hoặc null), detail và `generatedAt` ISO8601. Không rò rỉ implementation/secret nội bộ qua response. |
| J5 | Implement `GET /devices/:id/analytics/tuning-recommendations`. | `[ ] Pending` | **Guarded Recommendation Endpoint:** Luôn gắn `JwtAuthGuard` + `DeviceOwnershipGuard`. Parse `window` default 24, tối đa 168h và reject input malformed. Kiểm tra device online, KPI tồn tại và coverage gate trước recommender; gate fail không được trả advisory. |
| J6 | Implement `POST /devices/:id/tuning-configurations` tạo durable PENDING command. | `[ ] Pending` | **Idempotent Command Creation & JWT Identity (SEC-S2-01):** Luôn gắn cả hai guards. Actor lấy từ `req.user.email`, không trust body. Gọi `createPendingCommand({ ...dto, deviceId }, actor.email)`, trả `202 { commandId, status: 'PENDING' }`; command ID duplicate phải có semantics idempotent nhất quán, device không có phải 404. |
| J7 | Implement `GET /devices/:id/tuning-configurations/latest`. | `[ ] Pending` | **State Query Endpoint:** Luôn authn/authz trước khi đọc. Lấy state durable từ `TuningConfigurationService.getLatestByDeviceId()`; không suy đoán từ state in-memory hoặc broker retained payload. |
| J8 | Implement `GET /devices/:id/tuning-history` có phân trang. | `[ ] Pending` | **Bounded Pagination Pattern (PERF-S2-04):** Luôn gắn guards. Default limit 20, max 100, offset default 0; validate số nguyên không âm và clamp trước query. Repository phải dùng `take/skip` (hoặc LIMIT/OFFSET parameterized), cấm query audit không giới hạn. |
| J9 | Implement SSE `GET /devices/:id/tuning-configurations/stream`. | `[ ] Pending` | **Memory-Safe SSE Filter Pattern (PERF-S2-01, SEC-S2-04):** Luôn gắn guards. Stream từ `tuningSync$` shared, filter chính xác `deviceId`; cấm broadcast cross-device và cấm tạo Subject/Observable mới mỗi request. Đảm bảo teardown khi client disconnect (`takeUntil`/lifecycle) và SSE chỉ phát sau DB commit. |

## Track K — Frontend: Tuning Advisory Panel (Ngày 10–11)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| K1 | Implement `useTuningRecommendation(deviceId)` fetch advisory qua same-origin proxy. | `[ ] Pending` | **No-Polling Fetch Hook Pattern (PERF-S2-03):** Fetch đúng `/api/backend/devices/${deviceId}/analytics/tuning-recommendations`; không tạo independent base URL. Trả `data`, loading, error, `refetch`; hủy request qua `AbortController` khi unmount/device đổi. Cấm `setInterval`/polling loop. |
| K2 | Implement `useTuningStatus(deviceId)` dùng EventSource SSE với reconnect. | `[ ] Pending` | **Resilient SSE Hook (PERF-S2-03):** Dùng same-origin `/api/backend/.../stream`; parse event an toàn. Reconnect exponential 500ms, 1s, 2s, cap 10s; sau reconnect gọi `refetch()` đúng một lần để resync durable state. Close EventSource và cancel retry khi cleanup; không leak handler/timer. |
| K3 | Implement `TuningAdvisoryPanel` tại `app/components/tuning/TuningAdvisoryPanel.tsx`. | `[ ] Pending` | **Strict UI Confirmation Flow (S2-3):** Tạo `crypto.randomUUID()` cho idempotency. POST config recommendation chỉ sau explicit operator confirm; disable confirm khi pending/blocked. CẤM optimistic success: chỉ hiển thị IN_SYNC/REJECTED khi SSE durable event match `pendingCommandId`. Sau 30s timeout hiển thị “Chờ xác nhận từ thiết bị”. |
| K4 | Implement `TuningDiffView` tại `app/components/tuning/TuningDiffView.tsx`. | `[ ] Pending` | **Visual Diff Component:** Render đầy đủ 4 tham số với current -> suggested, changed badge theo `delta`, hard bounds dưới mỗi row. Màu xanh tăng/cam giảm/xám không đổi phải có text/icon không phụ thuộc chỉ màu; escape/render values an toàn. |
| K5 | Implement `TuningStatusBadge` tại `app/components/tuning/TuningStatusBadge.tsx`. | `[ ] Pending` | **Durable State Indicator:** State PENDING/IN_SYNC/REJECTED/TIMEOUT hiển thị rõ: waiting spinner, success, rejection reason và timeout warning. Chỉ nhận state từ API/SSE đã validate; không chuyển success vì HTTP 202. |
| K6 | Implement `CoverageWarning` tại `app/components/tuning/CoverageWarning.tsx`. | `[ ] Pending` | **Fail-Safe UI Banner:** Banner cảnh báo giải thích `INSUFFICIENT_DATA`, `DEVICE_OFFLINE`, `NO_SUGGESTION` hoặc `CONFLICT`; detail được render an toàn. Khi block reason khác null, confirm button bắt buộc disabled. |
| K7 | Tích hợp `TuningAdvisoryPanel` vào `app/page.tsx`. | `[ ] Pending` | **Context Integration Pattern:** Reuse `useSelectedDevice()` hiện có, không tạo deviceId state riêng và không fetch khi chưa chọn device. Không phá vỡ telemetry/dashboard hiện hữu; đặt panel trong sidebar/tab theo conventions UI project. |

## Track L — E2E Fault Injection Testing (Ngày 12–13)

| Task ID | Mô tả Task | Status | Note / chỉ thị kỹ thuật bắt buộc |
|---|---|---|---|
| L1 | E2E: Device offline → reconnect → nhận retained desired và ACK IN_SYNC. | `[ ] Pending` | **Fault Injection (S2-4):** Backend publish desired retained QoS 1 trong khi device offline; khi reconnect broker phải deliver retained, Edge xử lý và report ACCEPTED, backend durable transition PENDING→IN_SYNC. Verify DB, audit, SSE và không ghi NVS thừa. |
| L2 | E2E: QoS-1 reported ACK duplicate được xử lý idempotent. | `[ ] Pending` | **Idempotent ACK Verification:** Reinject ACK ACCEPTED đã xử lý. Assert lock/transaction nhận thấy state IN_SYNC và skip: không audit duplicate, không SSE event thứ hai, không clear retained lần hai, không state drift. |
| L3 | E2E: ACK cũ Command A sau desired Command B mới không clear retained B. | `[ ] Pending` | **Out-of-Order ACK Protection:** Setup A IN_SYNC/B PENDING, inject ACK A. Assert conditional latest-pending guard ngăn clear topic; broker vẫn giữ retained payload B. Đây là regression bắt buộc cho QoS-1 delayed/redelivery. |
| L4 | E2E firmware: cả hai NVS slots corrupt → safe defaults. | `[ ] Pending` | **Firmware NVS Recovery Injection:** Mock NVS trả garbage/CRC invalid cho 2 slots. Assert `hydrateFromNvs()` false, active config safe defaults, warning log, không crash/boot loop và không claim persisted success. |
| L5 | E2E firmware: burst 20 desired trong 1 giây không block Core 1. | `[ ] Pending` | **Core 1 Non-Blocking Stress Test:** Assert effective config cuối cùng là config được apply, queue depth 1/overwrite không unbounded, không heap allocation mới trên control path, không crash và 50ms tick không bị block. |
| L6 | E2E: reject tất cả invalid desired payload variants. | `[ ] Pending` | **Negative Injection Suite:** Test `NaN`, `Infinity`, string number, null, missing key, schema khác 1, device mismatch, UUID invalid, hysteresis invalid và hard-bounds violation. Mỗi variant phải report `REJECTED` với stable reason code; RAM/NVS/Core-1 queue không đổi. |
| L7 | E2E firmware: tuning hysteresis Mist không đổi threshold Lamp/Fan. | `[ ] Pending` | **Actuator Isolation Test:** Apply Mist `on=0.30`, `off=0.18`; verify Lamp/Fan vẫn dùng `FUZZY_ON_THRESHOLD=0.25` và `FUZZY_OFF_THRESHOLD=0.15`. Cấm regression biến tuning Mist thành global relay threshold. |
| L8 | Viết staging 24h dry-run và rollback checklist tại `test/tuning/staging-checklist.md`. | `[ ] Pending` | **Operational Readiness Checklist (S2-5):** Bao gồm các mục: migration, provision bucket/task, ESP32 v2.2, ACK trong 10s, DB transition, audit, SSE, offline retained/reconnect, Lamp/Fan invariant, factory-safe rollback, 24h không state drift/memory leak, và operator sign-off. Checklist là release gate, không phải tài liệu tùy chọn. |
