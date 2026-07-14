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

## Addition Plan
- Chưa có

---

## Sprint 1 — Actuator Refactor

### Track A: Type & Pin Reshape

| Task | Mô tả | Status | Chỉ thị |
|------|-------|:------:|---------|
| S1-A1 | Đổi tên trường struct `RelayOutputsPod::heater_air_active` → `lamp_stage_active` (thêm `lamp_stage2_active`, xoá `heater_air_active`), giữ `heater_water_active` | `[ ] Pending` | File `include/models.h`. Cập nhật padding về 3 byte. Grep repo và cập nhật mọi consumer (`WebInterface`, `Telemetry`, `core1_tasks`). |
| S1-A2 | Đổi tên `FuzzyController::DualHeaterOutputsPod::HAir` → `HLamp` | `[ ] Pending` | File `include/FuzzyController.h`, `src/FuzzyController.cpp`. Semantic không đổi (vẫn là "thermal actuator continuous demand"). |
| S1-A3 | Đổi tên `ArbitratedOutputsPod::HAir` → `HLamp` | `[ ] Pending` | Cùng file. Đảm bảo `applyTpcOutputs()` update tên tham số. |
| S1-A4 | Đổi tên `AdaptiveTuner::GainsPod::gain_HAir` → `gain_HLamp` | `[ ] Pending` | File `include/AdaptiveTuner.h`, `src/AdaptiveTuner.cpp`. Không thay công thức tuner. |
| S1-A5 | Đổi `config::pins::PIN_RELAY_HEATER_1` → `PIN_RELAY_LAMP_1 = 13` | `[ ] Pending` | File `include/config.h`. |
| S1-A6 | Đổi `config::pins::PIN_RELAY_HEATER_2` → `PIN_RELAY_HWAT = 12` | `[ ] Pending` | HWat giữ nguyên số chân sau đổi tên. |
| S1-A7 | Thêm `PIN_RELAY_LAMP_2 = 14` | `[ ] Pending` | Thu hồi từ `PIN_ONE_WIRE`. Xoá `PIN_ONE_WIRE`. |

### Track B: Actuator Whitelist & Init

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-B1 | Cập nhật whitelist `VALID_RELAY_PINS[]` và hàm `relay_name()` trong `src/actuators.cpp`: LAMP_1, LAMP_2, HWAT, MIST, FAN | `[ ] Pending` |
| S1-B2 | `init_actuators_gpio()`: khởi tạo 5 chân (bỏ HEATER_1/HEATER_2 cũ, thêm 3 chân mới) về LOW | `[ ] Pending` |
| S1-B3 | Cập nhật test `run_tests.cpp:851` — đổi ONE_WIRE (14) sang GPIO 21 (không hợp lệ) để giữ nguyên assertion "reject không hợp lệ" | `[ ] Pending` |

### Track C: TPC Dual-Lamp Staging

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-C1 | Thêm helper `TPC_Task::applyLampStaging(float lampDemand, TpcChannelState& stage1, TpcChannelState& stage2, TpcChannelConfig, TpcChannelConfig)` | `[ ] Pending` |
| S1-C2 | Trong `applyTpcOutputs()`, thay call `updateTpcChannel(H_AIR_TPC_CONFIG, state.HAir, ...)` bằng `applyLampStaging(outputs.HLamp, state.Lamp1, state.Lamp2, LAMP1_CFG, LAMP2_CFG)` | `[ ] Pending` |
| S1-C3 | Đổi tên `TpcSchedulerState::HAir` → `Lamp1`, thêm `Lamp2` | `[ ] Pending` |
| S1-C4 | Thêm `LAMP1_TPC_CONFIG` và `LAMP2_TPC_CONFIG` trong `core1_tasks.cpp` | `[ ] Pending` LAMP1 offset 0, LAMP2 offset +5000ms (stagger inrush). |

### Track D: Snapshot & Telemetry

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-D1 | Cập nhật `RelayOutputsPod` snapshot ở `runControlPipelineStep()` — dùng `state.Lamp1.output_high` cho `lamp_stage_active`, `state.Lamp2.output_high` cho `lamp_stage2_active` | `[ ] Pending` |
| S1-D2 | `SharedSystemState` field `h_air_duty` → `h_lamp_duty` | `[ ] Pending` |
| S1-D3 | Cập nhật WebInterface HTML: label "Air Heater (HAir)" → "Heat Lamp (HLamp)", thêm badge "Lamp1 / Lamp2 staged" | `[ ] Pending` |
| S1-D4 | Cập nhật Telemetry JSON key `h_air_duty` → `h_lamp_duty`; document trong backend contract | `[ ] Pending` |

### Track E: Tests

| Task | Mô tả | Status |
|------|-------|:------:|
| S1-E1 | Test `applyLampStaging`: demand=0.0 → stage1&2 LOW | `[ ] Pending` |
| S1-E2 | Test demand=0.3 → stage1 duty=0.6, stage2 duty=0 | `[ ] Pending` |
| S1-E3 | Test demand=0.5 → stage1 duty=1.0, stage2 duty=0 (biên chính xác) | `[ ] Pending` |
| S1-E4 | Test demand=0.75 → stage1 duty=1.0, stage2 duty=0.5 | `[ ] Pending` |
| S1-E5 | Test demand=1.0 → stage1&2 duty=1.0 | `[ ] Pending` |
| S1-E6 | Test dual-lamp offset chống inrush (window ellapsed 0 → stage2 vẫn OFF trong 5s đầu) | `[ ] Pending` |
| S1-E7 | Toàn bộ `pio test -e native` PASS | `[ ] Pending` |

---

## Sprint 2 — 3 Nút Cứng Tủ Điện + Safety Gate

### Track A: Config & Types

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-A1 | Thêm `PIN_BTN_MIST=4`, `PIN_BTN_LAMP=15`, `PIN_BTN_FAN=16` trong `config.h::hardware` | `[ ] Pending` |
| S2-A2 | Thêm `namespace config::hardware` và `MANUAL_LATCH_TTL_MS = 900000` (15 min) | `[ ] Pending` |
| S2-A3 | Tạo `include/manual_control.h`: enum `AppChannel`, struct `ManualRequest`, struct `ManualLatchState`, prototype `evaluateSafetyGate()`, `applyLatchToOutputs()`, `updateLatchDecay()` | `[ ] Pending` |
| S2-A4 | Định nghĩa `g_manual_request_queue` (depth=8), `g_manual_ack_queue` (depth=8) trong `main.cpp::initQueues()` | `[ ] Pending` |

### Track B: Core 0 Button Task

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-B1 | Tạo `src/cabinet_buttons.cpp` chứa `task_cabinet_buttons(void*)` | `[ ] Pending` |
| S2-B2 | Init pinMode INPUT_PULLUP cho 3 chân trong task startup | `[ ] Pending` |
| S2-B3 | Lấy mẫu mỗi 10ms, Shift Register tích luỹ (0x00/0xFF) chốt PRESS/RELEASE → gửi request | `[ ] Pending` |
| S2-B4 | Rate limit: nếu drain queue thất bại (full) → log 1 lần/5s, không block | `[ ] Pending` |
| S2-B5 | Đăng ký task Core 0 priority=1, stack 2048 trong `createCoreTasks()` | `[ ] Pending` |

### Track C: Core 1 Safety Gate

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-C1 | Implement `evaluateSafetyGate()` — pure, không side-effect | `[ ] Pending` |
| S2-C2 | Rules: BTN_MIST ON block nếu humidity≥92 hoặc NAN hoặc blackout active | `[ ] Pending` |
| S2-C3 | Rules: BTN_LAMP ON block nếu temp > setpoint+3°C hoặc NAN hoặc blackout | `[ ] Pending` |
| S2-C4 | Rules: BTN_FAN luôn PASS | `[ ] Pending` |
| S2-C5 | Rules: mọi OFF/CLEAR luôn PASS | `[ ] Pending` |
| S2-C6 | Implement `applyLatchToOutputs()` sau `hardwareProtectionOverride()` — latch không đè blackout | `[ ] Pending` |
| S2-C7 | Implement `updateLatchDecay()` — TTL 15 phút | `[ ] Pending` |
| S2-C8 | Trong `runControlPipelineStep()`: drain `g_manual_request_queue`, gate, update latch, publish ack qua `g_manual_ack_queue` | `[ ] Pending` |

### Track D: Ack Forwarding

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-D1 | Trong `taskCore0Communication`, drain `g_manual_ack_queue`, log rõ ràng (PASS/BLOCK), publish MQTT retained `mushroom/{deviceId}/manual/ack` | `[ ] Pending` |

### Track E: Tests & Verification

| Task | Mô tả | Status |
|------|-------|:------:|
| S2-E1 | Test gate Mist block khi humidity=95 | `[ ] Pending` |
| S2-E2 | Test gate Mist block khi humidity=NAN | `[ ] Pending` |
| S2-E3 | Test gate Mist PASS khi humidity=70 | `[ ] Pending` |
| S2-E4 | Test gate Lamp block khi temp=setpoint+4 | `[ ] Pending` |
| S2-E5 | Test gate Fan PASS mọi tình huống | `[ ] Pending` |
| S2-E6 | Test gate OFF luôn PASS | `[ ] Pending` |
| S2-E7 | Test latch TTL expire sau 15 phút | `[ ] Pending` |
| S2-E8 | Test latch không đè blackout Mist | `[ ] Pending` |
| S2-E9 | Test debounce Shift Register 8 mẫu lọc nhiễu thành công | `[ ] Pending` |
| S2-E10 | `pio test -e native` PASS | `[ ] Pending` |
| S2-V1 | **Nghiệm thu phần cứng Debounce:** Lấy dây điện quẹt liên tục vào chân GPIO 4 (Nút sương) tạo tia lửa điện giả lập. Lọc nhiễu phải bỏ qua các xung này, chỉ khi nhấn giữ thật sự >80ms thì mới trigger | `[ ] Pending` |
| S2-V2 | **Độc quyền TPC Chốt chặn:** Chạy `grep -r "digitalWrite" src/` kiểm tra không được ghi relay ngoài `TPC_Task.cpp` (trừ init trong `actuators.cpp`) | `[ ] Pending` |

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
