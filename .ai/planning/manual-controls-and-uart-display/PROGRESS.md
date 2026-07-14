# Tiến Độ Triển Khai: Manual Cabinet Controls + UART LED Display

## Started
- **Thời gian khởi tạo:** 2026-07-14
- **Execution Agent:** TBD

## Reference Plan
- **Thư mục kế hoạch:** `.ai/planning/manual-controls-and-uart-display/`
- **Các file tham chiếu:**
  - [README.md](./README.md)
  - [sprint_1.md](./sprint_1.md) — Actuator refactor (bỏ HAir, thêm 2 bóng đèn nhiệt)
  - [sprint_2.md](./sprint_2.md) — 3 nút cứng tủ điện + safety gate Core 0/Core 1
  - [sprint_3.md](./sprint_3.md) — UART 4-digit LED display
  - [sprint_4.md](./sprint_4.md) — Offline Autonomy, Persisted Crop Profile & Control Observability

## Addition Plan — Unified Overrides & Offline Autonomy (2026-07-14)
- **Nguồn ý tưởng/UI:** `mushroom-ui/components/standard-actuators-control.tsx` có UI override 3 trạng thái (`auto` / `on` / `off`), UI lock và toast auto-release. Firmware Sprint 2 phải dùng chính contract này; UI là UX pre-check, Core 1 firmware là authority.
- **Override thống nhất:** Nút vật lý và MQTT/Web UI vào hai queue riêng nhưng dùng chung `ManualRequest{AppChannel, AppIntent}`; Core 1 là sole writer của `ManualLatchArray` và GPIO vẫn chỉ do TPC xuất.
- **Fuzzy-Bounds Guarding:** `FORCE_ON` phải chạy thật để người vận hành thấy hiệu lực, nhưng tự release về AUTO khi chạm biological warning limit; không để fuzzy tắt ngay tick sau và cũng không cho ON vô thời hạn.
- **Offline autonomy:** Bổ sung sprint tiếp theo cho NVS profile/crop-time checkpoint persistence, tính crop day không phụ thuộc NTP sau mất điện, và nội suy setpoint offline. Không commit các giá trị hardcode theo day.
- **UI rename/contract:** Đồng bộ `heater_air` với actuator đèn nhiệt (`lamp`/`lamp_stage`) trước integration; UI lấy `effective_intent`/release reason từ firmware ack thay vì suy luận state local.

---

## Sprint 1 — Actuator Refactor

### Track A: Type & Pin Reshape

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S1-A1 | Đổi tên trường struct `RelayOutputsPod::heater_air_active` → `lamp_stage_active` (thêm `lamp_stage2_active`, xoá `heater_air_active`), giữ `heater_water_active` | `[ ] QA Review` | File `include/models.h`. Cập nhật padding về 3 byte. Grep repo và cập nhật mọi consumer (`WebInterface`, `Telemetry`, `core1_tasks`). |
| S1-A2 | Đổi tên `FuzzyController::DualHeaterOutputsPod::HAir` → `HLamp` | `[ ] QA Review` | File `include/FuzzyController.h`, `src/FuzzyController.cpp`. Semantic không đổi (vẫn là "thermal actuator continuous demand"). |
| S1-A3 | Đổi tên `ArbitratedOutputsPod::HAir` → `HLamp` | `[ ] QA Review` | Cùng file. Đảm bảo `applyTpcOutputs()` update tên tham số. |
| S1-A4 | Đổi tên `AdaptiveTuner::GainsPod::gain_HAir` → `gain_HLamp` | `[ ] QA Review` | File `include/AdaptiveTuner.h`, `src/AdaptiveTuner.cpp`. Không thay công thức tuner. |
| S1-A5 | Đổi `config::pins::PIN_RELAY_HEATER_1` → `PIN_RELAY_LAMP_1 = 13` | `[ ] QA Review` | File `include/config.h`. |
| S1-A6 | Đổi `config::pins::PIN_RELAY_HEATER_2` → `PIN_RELAY_HWAT = 12` | `[ ] QA Review` | HWat giữ nguyên số chân sau đổi tên. |
| S1-A7 | Thêm `PIN_RELAY_LAMP_2 = 14` | `[ ] QA Review` | Thu hồi từ `PIN_ONE_WIRE`. Xoá `PIN_ONE_WIRE`. |

### Track B: Actuator Whitelist & Init

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-B1 | Cập nhật whitelist `VALID_RELAY_PINS[]` và hàm `relay_name()` trong `src/actuators.cpp`: LAMP_1, LAMP_2, HWAT, MIST, FAN | `[ ] QA Review` |
| S1-B2 | `init_actuators_gpio()`: khởi tạo 5 chân (bỏ HEATER_1/HEATER_2 cũ, thêm 3 chân mới) về LOW | `[ ] QA Review` |
| S1-B3 | Cập nhật test `run_tests.cpp:851` — đổi ONE_WIRE (14) sang GPIO 21 (không hợp lệ) để giữ nguyên assertion "reject không hợp lệ" | `[ ] QA Review` |

### Track C: TPC Dual-Lamp Staging

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-C1 | Thêm helper `TPC_Task::applyLampStaging(float lampDemand, TpcChannelState& stage1, TpcChannelState& stage2, TpcChannelConfig, TpcChannelConfig)` | `[ ] QA Review` |
| S1-C2 | Trong `applyTpcOutputs()`, thay call `updateTpcChannel(H_AIR_TPC_CONFIG, state.HAir, ...)` bằng `applyLampStaging(outputs.HLamp, state.Lamp1, state.Lamp2, LAMP1_CFG, LAMP2_CFG)` | `[ ] QA Review` |
| S1-C3 | Đổi tên `TpcSchedulerState::HAir` → `Lamp1`, thêm `Lamp2` | `[ ] QA Review` |
| S1-C4 | Thêm `LAMP1_TPC_CONFIG` và `LAMP2_TPC_CONFIG` trong `core1_tasks.cpp` | `[ ] QA Review` | LAMP1 offset 0, LAMP2 offset +5000ms (stagger inrush). |

### Track D: Snapshot & Telemetry

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-D1 | Cập nhật `RelayOutputsPod` snapshot ở `runControlPipelineStep()` — dùng `state.Lamp1.output_high` cho `lamp_stage_active`, `state.Lamp2.output_high` cho `lamp_stage2_active` | `[ ] QA Review` |
| S1-D2 | `SharedSystemState` field `h_air_duty` → `h_lamp_duty` | `[ ] QA Review` |
| S1-D3 | Cập nhật WebInterface HTML: label "Air Heater (HAir)" → "Heat Lamp (HLamp)", thêm badge "Lamp1 / Lamp2 staged" | `[ ] QA Review` |
| S1-D4 | Cập nhật Telemetry JSON key `h_air_duty` → `h_lamp_duty`; document trong backend contract | `[ ] QA Review` |

### Track E: Tests

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-E1 | Test `applyLampStaging`: demand=0.0 → stage1&2 LOW | `[ ] QA Review` |
| S1-E2 | Test demand=0.3 → stage1 duty=0.6, stage2 duty=0 | `[ ] QA Review` |
| S1-E3 | Test demand=0.5 → stage1 duty=1.0, stage2 duty=0 (biên chính xác) | `[ ] QA Review` |
| S1-E4 | Test demand=0.75 → stage1 duty=1.0, stage2 duty=0.5 | `[ ] QA Review` |
| S1-E5 | Test demand=1.0 → stage1&2 duty=1.0 | `[ ] QA Review` |
| S1-E6 | Test dual-lamp offset chống inrush (window ellapsed 0 → stage2 vẫn OFF trong 5s đầu) | `[ ] QA Review` |
| S1-E7 | Toàn bộ `pio test -e native` PASS | `[ ] QA Review` |

---

## Sprint 2 — 3 Nút Cứng + Unified Override Pipeline + Safety Gate

### Track A: Config & Boot GPIO

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-A1 | Thêm 3 constant chân nút trong `include/config.h::hardware` (`PIN_BTN_MIST=4`, `PIN_BTN_LAMP=15`, `PIN_BTN_FAN=16`, `MANUAL_LATCH_TTL_MS=900000`) | `[ ] Pending` |
| S2-A2 | Thêm helper `init_cabinet_buttons_gpio()` trong `actuators.h`/`actuators.cpp` | `[ ] Pending` |

### Track B: Unified Override Models, Queues & MQTT Bridge

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-B1 | Thêm models vào `include/models.h` (`AppChannel`, `AppIntent`, `ManualRequest`, `ActuatorOverridePayload`, `ManualDecision`, `ManualAck`) | `[ ] Pending` |
| S2-B2 | Khai báo `g_manual_request_queue`, `g_mqtt_override_queue`, `g_manual_ack_queue` trong `definitions.h` | `[ ] QA Review` |
| S2-B3 | Định nghĩa queue trong `src/core1_tasks.cpp` | `[ ] Pending` |
| S2-B4 | Tạo ba queue trong `initQueues()` của `main.cpp` | `[ ] QA Review` |
| S2-B5 | Thêm MQTT/UI override adapter trong `mqtt_client.cpp` | `[ ] Pending` |
| S2-B6 | Xác nhận telemetry/ack contract cho UI | `[ ] Pending` |

### Track C: Safety Gate & Latch Module

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-C1 | Tạo mới `include/manual_control.h` | `[ ] QA Review` |
| S2-C2 | Tạo mới `src/manual_control.cpp` | `[ ] Pending` |
| S2-C3 | Hiện thực `evaluateSafetyGate()` | `[ ] Pending` |
| S2-C4 | Hiện thực helper `updateLatchOnAccepted()` | `[ ] Pending` |
| S2-C5 | Hiện thực `applyManualLatchToOutputs()` | `[ ] Pending` |
| S2-C6 | Thêm `autoClearOnSensorViolation()` | `[ ] Pending` |

### Track D: Core 0 Button Task

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-D1 | Thêm khai báo `taskCabinetButtons(void*)` trong `definitions.h` | `[ ] Pending` |
| S2-D2 | Tạo file `src/cabinet_buttons.cpp` | `[ ] Pending` |
| S2-D3 | Hiện thực Shift-Register Integrator debounce cho từng nút | `[ ] Pending` |
| S2-D4 | Gửi request sang Core 1 | `[ ] Pending` |
| S2-D5 | Gọi `xTaskCreatePinnedToCore` trong `createCoreTasks()` | `[ ] Pending` |
| S2-D6 | Pre-seed lịch sử nút lúc start | `[ ] Pending` |

### Track E: Core 1 Integration (Unified Override Pipeline)

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-E1 | Thêm biến local `ManualLatchArray manualLatch{}` trong `taskCore1Control()` | `[ ] Pending` |
| S2-E2 | Drains **hai** queue input: `g_manual_request_queue` (physical buttons) + `g_mqtt_override_queue` (UI/MQTT) | `[ ] Pending` |
| S2-E3 | Chèn `applyManualLatchToOutputs(outputs, manualLatch, now, telemetry, setpoints, rtcTime, cropDay)` sau `arbitrateOutputs` | `[ ] Pending` |
| S2-E4 | Verify `hardwareProtectionOverride` vẫn thắng | `[ ] Pending` |

### Track F: Core 0 Ack Consumer & UI Contract

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-F1 | Trong `taskCore0Communication`, drain `g_manual_ack_queue` mỗi vòng | `[ ] Pending` |
| S2-F2 | Publish MQTT retained `mushroom/{deviceId}/manual/ack` | `[ ] Pending` |
| S2-F3 | Cập nhật UI contract/labels trước integration | `[ ] Pending` |

### Track G: Tests & Verification

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-G1 | Test gate Mist block khi humidity=95 | `[ ] Pending` |
| S2-G2 | Test gate Mist block khi humidity=NAN | `[ ] Pending` |
| S2-G3 | Test gate Mist PASS khi humidity=70 | `[ ] Pending` |
| S2-G4 | Test gate Lamp block khi temp=setpoint+4 | `[ ] Pending` |
| S2-G5 | Test gate Fan PASS mọi tình huống | `[ ] Pending` |
| S2-G6 | Test gate OFF luôn PASS | `[ ] Pending` |
| S2-G7 | Test latch TTL expire sau 15 phút | `[ ] Pending` |
| S2-G8 | Test latch không đè blackout Mist | `[ ] Pending` |
| S2-G9 | Test debounce Shift Register 8 mẫu lọc nhiễu thành công | `[ ] Pending` |
| S2-G10 | Test ui and button requests follow same gate | `[ ] Pending` |
| S2-G11 | Test force on not restored when time uncertain | `[ ] Pending` |
| S2-G12 | `pio test -e native` PASS | `[ ] Pending` |
| S2-G13 | **Nghiệm thu phần cứng Debounce:** Lấy dây điện quẹt liên tục vào chân GPIO 4 (Nút sương) tạo tia lửa điện giả lập. Lọc nhiễu phải bỏ qua các xung này, chỉ khi nhấn giữ thật sự >80ms thì mới trigger | `[ ] Pending` |
| S2-G14 | **Độc quyền TPC Chốt chặn:** Chạy `grep -r "digitalWrite" src/` kiểm tra không được ghi relay ngoài `TPC_Task.cpp` (trừ init trong `actuators.cpp`) | `[ ] Pending` |

---

## Sprint 3 — UART 7-Segment LED Display

### Track A: Config

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-A1 | Thêm `PIN_DISPLAY_TX=17`, `PIN_DISPLAY_RX=18` trong `config.h::pins` | `[ ] Pending` |
| S3-A2 | Thêm `namespace config::display` với `DISPLAY_UART_BAUD=9600`, `DISPLAY_REFRESH_MS=500` | `[ ] Pending` |

### Track B: Driver Abstraction

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-B1 | Tạo `include/display.h` với `DisplayFrame`, `IDisplayDriver`, prototype `renderFrame()`, `taskDisplay(void*)` | `[ ] Pending` |
| S3-B2 | Extend `include/manual_control.h`: `ManualLatchSnapshot` (3 bool atomic snapshot) | `[ ] Pending` |
| S3-B3 | Tạo `src/display_uart.cpp` chứa `UartFramedDisplayDriver` — `Serial1.write(4 bytes)` dùng cấu trúc mảng tĩnh cố định `[Header/Mã lệnh, Humid, Temp, Checksum]` để tối ưu Hardware FIFO. | `[ ] Pending` |
| S3-B4 | Tạo `src/display_render.cpp` chứa pure `renderFrame()` — Kiểm tra `isnan()` của SHT30, nếu dính `NAN` ghi mã Hex `0x40` (Segment của `-`) | `[ ] Pending` |

### Track C: Manual Latch Snapshot Bridge

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-C1 | Thêm 3 `std::atomic<bool>` trong `manual_control.cpp` + hàm publish/read snapshot | `[ ] Pending` |
| S3-C2 | Call `manual::publishLatchSnapshot()` cuối `runControlPipelineStep()` | `[ ] Pending` |

### Track D: Core 0 Display Task

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-D1 | Khai báo `taskDisplay` trong `definitions.h` | `[ ] Pending` |
| S3-D2 | Implement task body — 500ms tick, đọc shared state, render, write | `[ ] Pending` |
| S3-D3 | Đăng ký task Core 0 priority=1, stack 2048 trong `createCoreTasks()` | `[ ] Pending` |

### Track E: Robustness

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-E1 | Nhiệt độ âm range -9..-1 render `-N`, ≤-10 render `Lo`, ≥100 render `Hi` | `[ ] Pending` |
| S3-E2 | Rate-limit driver error log (10s) | `[ ] Pending` |
| S3-E3 | Stack watermark log 60s | `[ ] Pending` |
| S3-E4 | Chớp nháy màn hình/dấu chấm 3 giây khi manual latch tự nhả (hết 15 phút) | `[ ] Pending` |

### Track F: Tests

| Task | Mô tả | Status |
|------|-------|:------:|
| S3-F1 | Test render normal (hum=87.3, temp=27.8) | `[ ] Pending` |
| S3-F2 | Test render humidity NAN | `[ ] Pending` |
| S3-F3 | Test render temp NAN | `[ ] Pending` |
| S3-F4 | Test render temp âm | `[ ] Pending` |
| S3-F5 | Test render temp ≥100 → `Hi` | `[ ] Pending` |
| S3-F6 | Test latch dot mapping | `[ ] Pending` |
| S3-F7 | Test rounding half-up humidity=87.5 → '8''8' | `[ ] Pending` |
| S3-F8 | `pio test -e native` PASS | `[ ] Pending` |

---

## Sprint 4 — Offline Autonomy, Persisted Crop Profile & Control Observability

### Track A: Profile Contract & NVS

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S4-A1 | Thêm profile/time models vào `models.h` hoặc module profile riêng | `[ ] Pending` | Không để UI payload đi thẳng vào struct runtime; parse DTO rồi validate/copy. |
| S4-A2 | Tạo `crop_profile_storage.h/.cpp` | `[ ] Pending` | NVS namespace/version/magic/CRC, load/store atomic record, bounded write cadence. |
| S4-A3 | Implement profile validator | `[ ] Pending` | Reject malformed/NaN/unsorted/out-of-range checkpoints trước persist và trước enqueue. |
| S4-A4 | Extend MQTT sync contract | `[ ] Pending` | Backend gửi version, `crop_start_epoch_s`, `total_crop_days`, checkpoints, CRC/schema. Retained profile giúp device reconnect tự phục hồi. |
| S4-A5 | Persist manual override separately | `[ ] Pending` | Chỉ persist latest intent + expiry in trusted epoch khi available. Nếu reboot time `Uncertain`, do not restore FORCE_ON; restore AUTO (fail-safe). FORCE_OFF có thể restore only if explicitly approved in safety review. |

### Track B: Time Confidence

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S4-B1 | Tạo `time_confidence` module | `[ ] Pending` | API pure/read-only cho `Trusted`, `Holdover`, `Uncertain`; explicit boot transition. |
| S4-B2 | Wire NTP/MQTT time sync | `[ ] Pending` | Valid time sets `Trusted`, saves bounded `PersistedTimeState`; connection loss while same boot gives `Holdover`. |
| S4-B3 | Detect reboot/offline uncertainty | `[ ] Pending` | Boot without valid RTC/NTP/MQTT time must be `Uncertain`, not estimated elapsed time. |
| S4-B4 | Define safe offline profile | `[ ] Pending` | Product/biological owner supplies concrete conservative setpoint; code uses named config, not a guessed magic number. |
| S4-B5 | Telemetry exposure | `[ ] Pending` | Publish `time_confidence`, `crop_day`, `profile_version`, `profile_source` and `offline_safe_mode`. |

### Track C: Core 1 Profile Snapshot & Interpolation

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S4-C1 | Add profile update queue/snapshot bridge | `[ ] Pending` | Core 0 sends complete validated profile; Core 1 adopts only at beginning of a control tick. |
| S4-C2 | Implement `interpolateSetpoint()` | `[ ] Pending` | Pure function; never allocates or touches NVS/network. |
| S4-C3 | Integrate with control pipeline | `[ ] Pending` | Trusted/Holdover computes crop day + interpolated target; Uncertain selects safe offline target. |
| S4-C4 | Maintain safety precedence | `[ ] Pending` | Profile target → Fuzzy → manual latch/Fuzzy-Bounds Guarding → `hardwareProtectionOverride()` → TPC. |
| S4-C5 | Manual UI feedback | `[ ] Pending` | `manual_ack` includes `time_confidence`; UI shows degraded/offline warning but cannot bypass Core 1 safety gate. |

### Track D: UI Integration Contract

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S4-D1 | Rename actuator contract deliberately | `[ ] Pending` | Migrate UI `heater_air` to firmware’s thermal-lamp channel (`lamp`/`lamp_stage`) with an explicit backend migration, not a silent client-only rename. |
| S4-D2 | Reconcile intent from firmware | `[ ] Pending` | Existing local React `mistMode/fanMode/heaterAirMode` becomes optimistic only; reconcile from retained ack/state `effective_intent`, `release_reason`, `expires_ms`. |
| S4-D3 | Show authoritative safety release | `[ ] Pending` | When Core 1 emits `SafetyLimitReached`, UI returns control to AUTO and displays exact firmware-provided reason. It must not rely on browser time or guessed sensor threshold. |
| S4-D4 | Preserve UI pre-checks as UX only | `[ ] Pending` | The midday/crop-day checks in `handleOverrideChange()` can reduce failed clicks, but device-side RTC/profile rules remain authoritative. |

### Track E: Tests & Field Verification

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S4-E1 | `test_interpolate_between_checkpoints` | `[ ] Pending` | Day between two known checkpoints gives exact linear target. |
| S4-E2 | `test_interpolate_endpoint_clamp` | `[ ] Pending` | Before first/after last checkpoint clamps to endpoint. |
| S4-E3 | `test_profile_rejects_invalid_checkpoint_data` | `[ ] Pending` | NaN, duplicates, unsorted, out-of-range count/day rejected. |
| S4-E4 | `test_profile_crc_rejects_corruption` | `[ ] Pending` | Corrupt persisted record never becomes active. |
| S4-E5 | `test_holdover_keeps_crop_day_after_wifi_loss` | `[ ] Pending` | Same boot, previously trusted clock, loss of network → valid derived crop day. |
| S4-E6 | `test_reboot_without_trusted_clock_enters_safe_offline` | `[ ] Pending` | NVS profile exists but no RTC/NTP/MQTT after simulated reboot → `Uncertain`, safe profile; no false elapsed-time estimate. |
| S4-E7 | `test_force_on_not_restored_when_time_uncertain` | `[ ] Pending` | Reboot under uncertainty must not revive a stale FORCE_ON latch. |
| S4-E8 | Field test: Wi-Fi disconnect | `[ ] Pending` | Confirm no control pause, local button works, telemetry indicates Holdover. |
| S4-E9 | Field test: power-cycle without network | `[ ] Pending` | Confirm Uncertain/safe mode, no stale FORCE_ON, then correct recovery after time/profile sync. |
| S4-E10 | `pio test -e native` | `[ ] Pending` | PASS all current and new tests. |
