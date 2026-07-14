# Sprint 3 — UART 7-Segment LED Display (Humidity + Temperature)

## Mục tiêu Sprint

Thêm module hiển thị 4 chữ số LED 7 đoạn ghép nối qua UART. Hai chữ số bên trái hiển thị
độ ẩm nhà nấm (đơn vị %RH, làm tròn về số nguyên); hai chữ số bên phải hiển thị nhiệt độ
không khí (°C, làm tròn về số nguyên). Sensor lỗi/NAN hiển thị `----`. Trạng thái manual
latch được ám chỉ bằng dấu chấm thập phân (decimal point) trên chữ số tương ứng.

## Non-goals

- Không hỗ trợ display module SPI/I2C/GPIO-scan trong sprint này (chỉ UART).
- Không hiển thị CO2 (thiết bị chỉ có 4 digit; CO2 vẫn qua MQTT).
- Không animation/scroll text; chỉ static 4-digit numeric.

## Thiết kế phần cứng & protocol

- **UART port:** `Serial1` (UART1 controller trên ESP32-S3).
- **Chân:** TX = GPIO 17, RX = GPIO 18 (RX không kết nối cũng chạy được).
- **Baud rate:** 9600 8N1. Đủ nhanh cho refresh 2Hz và tương thích với hầu hết module 4-digit
  UART thương mại (TM1637 UART variants, MAX6955 UART wrapper, module giáo dục Arduino).
- **Frame length:** 4 byte per refresh, không frame delimiter. Nếu module cụ thể yêu cầu
  header/checksum khác, cấu hình qua `IDisplayDriver` interface (xem Track B).
- **Payload format (default):** 4 byte ASCII `H1 H2 T1 T2`.
  - H1, H2: chữ số hàng chục và hàng đơn vị của độ ẩm (ASCII `'0'`..`'9'`).
  - T1, T2: chữ số hàng chục và hàng đơn vị của nhiệt độ (ASCII `'0'`..`'9'`).
  - Sensor NAN hoặc out-of-range: gửi 4 byte `'-'`.
  - Manual Mist latch active → set bit 7 của H2 (dấu chấm sau digit humidity đơn vị).
  - Manual Lamp latch active → set bit 7 của T1.
  - Manual Fan latch active → set bit 7 của T2.

## Kiến trúc phần mềm

```
Core 1                               Core 0
======                               ======
runControlPipelineStep                taskDisplay (500ms tick)
  updateSharedSystemState({...})        getSharedSystemState() (mutex read)
                                        DisplayFrame frame = renderFrame(state, latch_snapshot)
                                        driver.write(frame)  → Serial1.write(4 bytes)
```

- `IDisplayDriver` abstract: hàm ảo `bool write(const DisplayFrame& frame)`. Concrete
  implementation: `UartAsciiDisplayDriver`. Tương lai swap TM1637/MAX7219 chỉ cần bind driver
  mới trong `main.cpp::createCoreTasks()`.
- `DisplayFrame` là POD 4 byte + 3 bool flag (mist/lamp/fan latch active).
- `renderFrame(SharedSystemState, ManualLatchSnapshot) -> DisplayFrame` là pure function,
  unit test được trực tiếp.
- Manual latch cần được share sang Core 0 → thêm 3 bool trong `SharedSystemState` (`manual_mist_active`,
  `manual_lamp_active`, `manual_fan_active`) hoặc snapshot riêng qua atomic bool (đơn giản hơn,
  không cần thay đổi mutex hiện có).

## Danh sách task

### Track A — Config & Wiring

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| A1 | Thêm constant chân UART display trong `include/config.h::pins` | `PIN_DISPLAY_TX = 17`, `PIN_DISPLAY_RX = 18`. Comment: UART1, 9600 baud, 4 digit ASCII. |
| A2 | Thêm constant `DISPLAY_UART_BAUD = 9600` trong namespace `config::display` | Namespace mới trong `config.h`. Thêm `DISPLAY_REFRESH_MS = 500`. |

### Track B — Display Driver Abstraction

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| B1 | Tạo `include/display.h` | Namespace `display`. Định nghĩa: `struct DisplayFrame { char digits[4]; bool dot[4]; };`, abstract class `IDisplayDriver { public: virtual ~IDisplayDriver()=default; virtual bool begin()=0; virtual bool write(const DisplayFrame&)=0; };`. Prototype `DisplayFrame renderFrame(const SharedSystemState& state, const ManualLatchSnapshot& latches);`. Prototype task entry `void taskDisplay(void*);`. |
| B2 | Tạo `include/manual_control.h` extension: `ManualLatchSnapshot` | 3 bool: `mist_active`, `lamp_active`, `fan_active`. Đặt cạnh các struct manual đã có. |
| B3 | Tạo `src/display_uart.cpp` — concrete `UartAsciiDisplayDriver` | Constructor nhận `HardwareSerial& port`, `uint32_t baud`, `int8_t tx_pin`, `int8_t rx_pin`. `begin()` gọi `port.begin(baud, SERIAL_8N1, rx, tx)`. `write()` gọi `port.write(reinterpret_cast<const uint8_t*>(bytes), 4)` với high-bit set cho dot. Non-blocking (Serial1 TX FIFO đủ cho 4 byte < 5 ms ở 9600 baud). |
| B4 | Tạo `src/display_render.cpp` — pure function `renderFrame()` | Không include `<Arduino.h>`; chỉ `<cmath>`, `<cstdint>`. Logic: nếu `!isfinite(humidity_air)` hoặc `humidity_air < 0 || >= 100` → `H1=H2='-'`; ngược lại round + split digits. Tương tự cho temp (biên `-9..99` → nếu âm hiển thị `-N` với dấu trừ chiếm T1). Set `dot[]` theo `latches`. |

### Track C — Manual Latch Snapshot Bridge

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| C1 | Thêm 3 `std::atomic<bool>` global cho manual latch snapshot trong `manual_control.cpp` | Namespace `manual`. Hàm `void publishLatchSnapshot(const ManualLatchArray&)` — gọi từ Core 1 mỗi tick, set 3 atomic bool. Hàm `ManualLatchSnapshot readLatchSnapshot()` — gọi từ Core 0 task display. |
| C2 | Trong `runControlPipelineStep()`, sau `applyManualLatchToOutputs()`, gọi `manual::publishLatchSnapshot(manualLatch)` | Sau khi latch được update cho tick này. |

### Track D — Core 0 Display Task

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| D1 | Khai báo `taskDisplay(void*)` trong `include/definitions.h` bọc `#ifndef UNIT_TEST` | Style giống `taskEncoderInput`. |
| D2 | Định nghĩa `taskDisplay` trong `src/display_uart.cpp` | Vòng lặp: `vTaskDelay(pdMS_TO_TICKS(DISPLAY_REFRESH_MS))`, đọc `getSharedSystemState()`, đọc `manual::readLatchSnapshot()`, gọi `renderFrame`, gọi `driver.write(frame)`. Nếu `write` fail → log 1 lần / 10 giây (tránh spam). |
| D3 | Thêm driver singleton trong `src/display_uart.cpp` | `static UartAsciiDisplayDriver driver(Serial1, config::display::DISPLAY_UART_BAUD, config::pins::PIN_DISPLAY_RX, config::pins::PIN_DISPLAY_TX);` `driver.begin()` được gọi ở đầu `taskDisplay`. |
| D4 | Trong `createCoreTasks()` của `main.cpp`, tạo task | `xTaskCreatePinnedToCore(taskDisplay, "TaskDisplay", 2048, nullptr, 1, nullptr, 0);` Pin Core 0, priority 1 (thấp — cho phép telemetry/MQTT chèn). |

### Track E — Robustness

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| E1 | Failsafe: nếu `Serial1.begin` fail (không nên xảy ra trên ESP32-S3), task exit sau khi log | Không loop infinite gây waste CPU. |
| E2 | Handle nhiệt độ âm | Nếu `-9 <= temp <= -1`: `T1='-'`, `T2=digit(|temp|)`. `<= -10` → hiển thị `Lo`. `>=100` → `Hi`. |
| E3 | Rate-limit log driver error | Static `last_error_log_ms`, chỉ log mỗi 10 s. |
| E4 | Watermark log stack task display mỗi 60 s | Cùng pattern với `logStackWatermark`. |

### Track F — Tests

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| F1 | `test_renderFrame_normal` | humidity=87.3, temp=27.8, no latch → digits `'8''7''2''8'`, dot all false. |
| F2 | `test_renderFrame_nan_humidity` | humidity=NAN → H1=H2='-', T digits vẫn render đúng. |
| F3 | `test_renderFrame_nan_temp` | temp=NAN → T1=T2='-'. |
| F4 | `test_renderFrame_negative_temp` | humidity=90, temp=-3.2 → digits `'9''0''-''3'`. |
| F5 | `test_renderFrame_temp_high_saturation` | temp=105 → T1='H', T2='i'. |
| F6 | `test_renderFrame_latch_dots` | latch.mist_active=true → dot[1]=true; latch.lamp_active=true → dot[2]=true; latch.fan_active=true → dot[3]=true. |
| F7 | `test_renderFrame_round_half` | humidity=87.5 → H1='8', H2='8' (half-to-even hoặc away from zero — chọn 1 và ghi rõ). |
| F8 | `pio test -e native` | PASS đủ mọi test hiện có + mới. |

## Definition of Done

- Sau khi flash và cấp điện, display hiển thị đúng humidity/temp trong vòng 1 giây kể từ sensor
  đầu tiên đọc thành công.
- Sensor SHT30 unplug → hiển thị `----` sau ≤ 3 s.
- Nhấn nút Fan (accept) → dấu chấm hiện trên digit T2 (rightmost). Nhả sau 15 phút TTL.
- `pio test -e native` PASS.
- Không có Serial1 log noise chảy ra CH343P UART0 debug port.

## Rủi ro & Mitigation

- **Rủi ro:** Module display cụ thể mua ngoài chợ có protocol riêng (VD frame header `0xA5`).
  **Mitigation:** `IDisplayDriver` là abstraction; viết thêm concrete driver riêng (VD
  `AliexpressDisplayDriver`) và swap trong `main.cpp` — không đụng phần render.
- **Rủi ro:** UART1 xung đột với native USB CDC ở env `otg`. **Mitigation:** UART1 độc lập
  hoàn toàn với UART0/USB CDC; đã verify trên ESP32-S3 datasheet.
- **Rủi ro:** Task display block > 50 ms nếu module lỗi cứng. **Mitigation:** Serial1.write
  có TX FIFO 128 byte và timeout mặc định ~1 ms, không risk block.
