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
  UART thương mại (TM1637 UART variants, MAX6955 UART wrapper, module chợ Aliexpress/Shopee).
- **Frame length cố định 4 byte:** dùng khung nhị phân có header + checksum thay vì ASCII trần.
  Lý do: đường UART trong tủ điện đi cạnh dây tải AC — nhiễu EMI có thể lật bit đơn lẻ. Không
  có checksum thì display sẽ nhảy sang giá trị rác mà firmware không phát hiện được. Header
  byte cũng giúp module tự re-sync nếu bị mất khung trước đó.

### Frame binary mặc định (`UartFramedDisplayDriver`)

| Offset | Tên     | Nội dung                                                                                             |
|--------|---------|------------------------------------------------------------------------------------------------------|
| 0      | `HDR`   | `0xA5` cố định — header đồng bộ khung, giúp module tự tái đồng bộ khi lệch                            |
| 1      | `HUM`   | BCD 2 nibble encode độ ẩm (xem bảng bên dưới)                                                        |
| 2      | `TEMP`  | BCD 2 nibble encode nhiệt độ                                                                         |
| 3      | `CHK`   | XOR 3 byte trước: `CHK = HDR ^ HUM ^ TEMP`. Bên nhận verify: `HDR ^ HUM ^ TEMP ^ CHK == 0`. Nếu sai, drop frame và chờ frame kế tiếp (~500 ms sau). |

Encode `HUM` (và tương tự `TEMP`) là **BCD 2 nibble** (high nibble = hàng chục, low nibble = hàng đơn vị):

- `HUM = (tens << 4) | units` với `tens, units ∈ 0..9`.
- Sensor NAN → ghi trực tiếp mã Hex `0x40` (mã segment của dấu `-`) cho cả 2 chữ số (tức là ghi `0x40` cho mỗi digit hoặc ghi byte `0x40` đại diện cho hiển thị gạch ngang). Để thợ trực trại nhận biết hệ thống đang mất dấu cảm biến, ta ghi mã hex `0x40` cho từng digit bị NAN.
- Nhiệt độ âm `-9..-1`: digit chục hiển thị dấu `-` (mã `0x40` hoặc BCD tương ứng), digit đơn vị hiển thị `|temp|`. Ví dụ `-3` hiển thị `-3`.
- Nhiệt độ vượt ngưỡng: `>=100` hiển thị `Hi` (`0x76` và `0x30` hoặc quy ước tương đương), `<=-10` hiển thị `Lo` (`0x38` và `0x5c` hoặc quy ước tương đương).
- Nếu sensor lỗi dính `NAN`, bắt buộc dùng hàm `isnan()` hoặc `!isfinite()` để kiểm tra trước khi ghi và điền trực tiếp mã `0x40` ra màn hình hiển thị.

**Không nhồi trạng thái manual latch vào protocol UART.** Lý do: 4 byte đã hết chỗ và mọi cách
nhồi bit vào header/CHK đều làm yếu checksum hoặc phá pattern sync. Trạng thái manual latch
được surface qua 3 kênh khác đã sẵn có:
1. MQTT topic `manual_ack` (đã có ở Sprint 2) — dashboard cloud hiển thị đèn báo.
2. Log qua `ScopedSerialLock` tại `[MANUAL]` prefix cho debug tại chỗ.
3. Quan sát vật lý: SSR bán dẫn (SSR-25DA / Fotek) có LED báo màu đỏ trên vỏ khi kích tải —
   thợ trại nhìn tủ điện thấy ngay relay nào đang bật thủ công.

### Fallback ASCII (`UartAsciiDisplayDriver`)

Nếu module là loại giáo dục "cheap 4-digit ASCII TTL" mua ngoài, dùng driver ASCII: 4 byte
`H1 H2 T1 T2`, NAN → `'-'`. Không checksum. Chọn driver qua build flag
`-D DISPLAY_DRIVER_ASCII=1` hoặc bind trong `main.cpp`.

### Xử lý NAN (bắt buộc)

Trước khi ghi, `renderFrame()` phải gọi `std::isnan()` (hoặc `!std::isfinite()` để bắt cả INF) trên `humidity_air` và `temp_air`. Nếu true, ghi trực tiếp mã Hex `0x40` (mã segment của dấu `-`) ra màn hình hiển thị (với ASCII là `'-'`). Không được để rơi qua giá trị rác — user thợ trại nhìn màn hình phải thấy `--` (hoặc `- -`) để biết ngay cảm biến mất dấu, thay vì thấy số 0.00 rồi bối rối.

### Kiểm tra khung phía firmware (self-test khi boot)

Sau `driver.begin()`, phát 1 frame test `HUM=0x88 TEMP=0x88` (hiển thị `88 88`) và giữ trong
1 giây. Nếu module không phản hồi (không có RX line cho UART display cheap) thì đây chỉ là
smoke test một chiều — không có phản hồi cũng không fail task, chỉ log.

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
- **Phản hồi trực quan khi hết hạn TTL (15 phút):** Khi một manual latch hết hạn và tự động nhả (trả quyền về cho Auto), màn hình 7-segment LED sẽ nhấp nháy toàn bộ chữ số hoặc chớp tắt nhanh dấu chấm thập phân tương ứng liên tục trong 3 giây để báo hiệu trực quan cho nông dân trại nấm biết hệ thống đã tự động quay lại chế độ Auto hoàn toàn.

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
| B3 | Tạo `src/display_uart_framed.cpp` — concrete `UartFramedDisplayDriver` | Constructor nhận `HardwareSerial& port`, `uint32_t baud`, `int8_t tx_pin`, `int8_t rx_pin`. `begin()` gọi `port.begin(baud, SERIAL_8N1, rx, tx)` và phát smoke frame `88 88`. `write(frame)` encode 4 byte theo bảng ở phần thiết kế: `hdr = 0xA5 \| dots`, `hum`/`temp` = BCD 2 nibble, `chk = hdr ^ hum ^ temp`. Gọi `port.write(bytes, 4)` một lần duy nhất — Serial1 TX FIFO 128 byte thừa sức cho 4 byte < 5 ms ở 9600 baud. |
| B4 | Tạo `src/display_render.cpp` — pure function `renderFrame()` | Không include `<Arduino.h>`; chỉ `<cmath>`, `<cstdint>`. Logic: BẮT BUỘC gọi `std::isnan()` hoặc `!std::isfinite()` trên input trước tiên. NAN → nibble `0xF`. Range hợp lệ: humidity `0..99`, temp `-9..99`. Ngoài range → hiển thị `Hi` (temp > 99) hoặc `Lo` (temp < -9). Rounding: half-away-from-zero (`std::round`). Set `dot[]` theo `latches`: `dot[1]=mist`, `dot[2]=lamp`, `dot[3]=fan`. |
| B5 | (Optional) Tạo `src/display_uart_ascii.cpp` — fallback `UartAsciiDisplayDriver` | Chỉ compile khi `-D DISPLAY_DRIVER_ASCII=1`. 4 byte ASCII `H1 H2 T1 T2`. NAN → `'-'`. Không checksum. Dùng khi module mua chợ chỉ hỗ trợ ASCII trần. |

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
| F1 | `test_renderFrame_normal` | humidity=87.3, temp=27.8, no latch → digits `[8,7,2,8]`, dot all false. |
| F2 | `test_renderFrame_nan_humidity` | humidity=NAN → digits[0,1] = `0x40`, temp digits render bình thường. |
| F3 | `test_renderFrame_nan_temp` | temp=NAN → digits[2,3] = `0x40`. |
| F4 | `test_renderFrame_negative_temp` | humidity=90, temp=-3.2 → digits chục của temp = `0x40` (mã minus). |
| F5 | `test_renderFrame_temp_high_saturation` | temp=105 → digits[2,3] = `[0xB, 0xC]` (Hi). temp=-15 → `[0xD, 0xC]` (Lo). |
| F6 | `test_renderFrame_latch_dots` | mist_active=true → dot[1]=true; lamp_active=true → dot[2]=true; fan_active=true → dot[3]=true. |
| F7 | `test_renderFrame_round_half` | humidity=87.5 → `[8, 8]` (half-away-from-zero, không phải banker). Docstring nêu rõ quy ước. |
| F8 | `test_encode_frame_checksum` | Frame `[dots=0b010, hum=(9,0), temp=(2,7)]` → bytes `[0xA5\|0x04, 0x90, 0x27, chk]` với `chk = byte0 ^ byte1 ^ byte2`. Test toàn bộ 4 byte payload để bảo vệ ordering. |
| F9 | `test_encode_frame_nan_nibble` | Nibble NAN `0xF` không bị mask, giữ nguyên trong hum/temp byte. |
| F10 | `pio test -e native` | PASS đủ mọi test hiện có + mới. |

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
