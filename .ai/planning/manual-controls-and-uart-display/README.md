# Manual Cabinet Controls & UART 7-Segment Display

## 1. Mục Tiêu Kỹ Thuật Tổng Quát

Kế hoạch này bổ sung ba khối chức năng vật lý cho hệ điều khiển nhà trồng nấm:

1. **3 nút vật lý trên tủ điện** (Sương / Đèn nhiệt / Quạt) — cho phép vận hành viên bật/tắt
   thủ công tại chỗ. Yêu cầu bắt buộc: nút không được ép GPIO trực tiếp. Tín hiệu nhấn đi từ
   Core 0 sang Core 1 để đi qua **Safety Gate** (kiểm tra ẩm, nhiệt, blackout, sensor validity),
   sau đó TPC mới là tầng duy nhất viết GPIO. Nếu vi phạm rule (VD: ẩm 95% mà nhấn thêm sương)
   thì lệnh bị chặn — không có đường "bypass phần cứng".
2. **Refactor 4 relay hiện tại** — thay `HAir` (đèn/khí nóng gián tiếp) bằng `HLamp` (đèn nhiệt
   2 bóng) và giữ `HWat` (gia nhiệt nước). Fuzzy sinh ra một duty demand `HLamp` duy nhất, TPC
   phân rã thành 2 kênh vật lý theo staged dispatch để giảm inrush và kéo dài tuổi thọ bóng.
3. **Module hiển thị LED 7-đoạn 4 chữ số** giao tiếp qua UART (Serial1). 2 chữ số trái = độ ẩm
   nhà nấm (%RH), 2 chữ số phải = nhiệt độ không khí (°C). Khi sensor không hợp lệ (NAN) hiển
   thị `----`. Task display chạy trên Core 0, đọc snapshot state qua mutex có sẵn.

### Các mục tiêu cụ thể

- **Zero-bypass safety:** Nút vật lý là advisory input; Core 1 Fuzzy/TPC vẫn là authoritative
  writer duy nhất của GPIO relay. Không có `digitalWrite()` relay nào nằm ngoài `TPC_Task`.
- **Auto-release manual latch:** Mỗi override manual có TTL 15 phút; sau đó fuzzy tự động lấy
  lại quyền để tránh trường hợp nút kẹt/quên tắt gây over-heat qua đêm.
- **Blackout interlock giữ nguyên hiệu lực:** Nút không thể bật `HWat` hay `Mist` trong cửa sổ
  11:00–13:30 hoặc khi RTC chưa sync — hardwareProtectionOverride vẫn có ưu tiên cao nhất.
- **Reclaim GPIO 14 an toàn:** DS18B20 đã bị loại bỏ khỏi thiết kế; GPIO 14 được thu hồi cho
  `RELAY_LAMP_2` với pull-down 10 kΩ ngoài đúng theo `HARDWARE_DEPLOYMENT.md`.
- **UART display non-blocking:** Serial1 TX 9600 8N1, refresh 500 ms, `Serial1.write()` không
  chặn Core 0 quá 5 ms/lần (4 byte payload).

---

## 2. Tech Stack Cốt Lõi

| Hạng mục          | Lựa chọn                                                      |
|-------------------|---------------------------------------------------------------|
| **Platform**      | ESP32-S3 WROOM-1 N16R8 (đã cấu hình)                         |
| **Build System**  | PlatformIO, `env:otg` / `env:uart`                           |
| **Language**      | C++17 với Arduino HAL                                        |
| **RTOS**          | FreeRTOS (tích hợp ESP-IDF 5.x)                              |
| **Queue mới**     | `g_manual_request_queue` (Core 0 → Core 1, depth 4)             |
| **Queue mới**     | `g_manual_ack_queue` (Core 1 → Core 0, depth 4) — feedback UI   |
| **UART Display**  | `HardwareSerial` (Serial1) trên GPIO 17 TX, 9600 8N1         |
| **Debounce**      | Shift Register Integrator (lấy mẫu 10 ms, tích luỹ 8 mẫu)   |
| **Unit Test**     | PlatformIO Native (`pio test -e native`), guard `#ifndef UNIT_TEST` |
| **Serial Lock**   | `ScopedSerialLock` / `SerialLock` (đã có)                    |

---

## 3. Bản Đồ GPIO Sau Refactor (Authoritative)

**Nguyên tắc:** Chỉ dùng GPIO ESP32-S3 không phải strap/USB/Flash/PSRAM. Mọi input đều
INPUT_PULLUP để trạng thái mặc định lúc boot là "không nhấn"; mọi output relay đều có pull-down
10 kΩ ngoài theo yêu cầu `HARDWARE_DEPLOYMENT.md`.

| GPIO  | Hướng          | Nhãn                       | Ghi chú                              |
|-------|----------------|----------------------------|--------------------------------------|
| 0     | INPUT_PULLUP   | `PIN_WIFI_CONFIG_BUTTON`   | BOOT/strap, giữ nguyên               |
| 4     | INPUT_PULLUP   | `PIN_BTN_MIST`             | **MỚI** — nút Sương trên tủ          |
| 5     | INPUT          | `PIN_ENCODER_CLK`          | KY-040, giữ nguyên                   |
| 6     | INPUT          | `PIN_ENCODER_DT`           | KY-040, giữ nguyên                   |
| 7     | INPUT_PULLUP   | `PIN_ENCODER_SW`           | KY-040, giữ nguyên                   |
| 8     | I2C SDA        | `PIN_I2C_SDA` (SHT30)      | giữ nguyên                           |
| 9     | I2C SCL        | `PIN_I2C_SCL` (SHT30)      | giữ nguyên                           |
| 10    | OUTPUT         | `PIN_RELAY_MIST`           | giữ nguyên (active HIGH + pull-down) |
| 11    | OUTPUT         | `PIN_RELAY_FAN`            | giữ nguyên                           |
| 12    | OUTPUT         | `PIN_RELAY_HWAT`           | Đổi nhãn từ `PIN_RELAY_HEATER_1`     |
| 13    | OUTPUT         | `PIN_RELAY_LAMP_1`         | Đổi nhãn từ `PIN_RELAY_HEATER_2`     |
| 14    | OUTPUT         | `PIN_RELAY_LAMP_2`         | **MỚI** — thu hồi từ `PIN_ONE_WIRE`  |
| 15    | INPUT_PULLUP   | `PIN_BTN_LAMP`             | **MỚI** — nút Đèn trên tủ            |
| 16    | INPUT_PULLUP   | `PIN_BTN_FAN`              | **MỚI** — nút Quạt trên tủ           |
| 17    | UART1 TX       | `PIN_DISPLAY_TX`           | **MỚI** — LED 7-đoạn 4 số            |
| 18    | UART1 RX       | `PIN_DISPLAY_RX`           | Reserve, chưa đấu dây                |
| 19/20 | USB D-/D+      | (chỉ dùng env:otg)         | KHÔNG kết nối ngoài                  |
| 35-37 | OPI PSRAM      | flash/psram nội            | RESERVED, tuyệt đối không dùng       |
| 43/44 | UART0          | Debug CH343P               | RESERVED                             |

Các strap pin nhạy khác (3, 45, 46) không được dùng.

---

## 4. Nguyên Tắc Kiến Trúc & Coding Conventions

Kế hoạch này thừa hưởng toàn bộ conventions của plan `ota-remote-update-system` (namespace,
Mutex, WDT feed, snake_case cho hàm, PascalCase cho struct). Bổ sung 4 nguyên tắc riêng cho
mảng vận hành thủ công:

### 4.1. Single Writer of GPIO Relay

- **`TPC_Task::updateTpcChannel()` là hàm duy nhất được phép gọi `digitalWrite()` lên bất kỳ
  chân relay nào (10/11/12/13/14).**
- Task đọc nút (`taskCabinetButtons`) chỉ được `xQueueSend` sang Core 1. Nó không được ghi
  GPIO relay, không được `set_relay_state()`.
- Ngoại lệ duy nhất: `actuators::init_actuators_gpio()` viết `LOW` một lần lúc boot cho
  fail-safe. Không có ngoại lệ khác.

### 4.2. Manual Request là Advisory, Không Phải Command

- `ManualRequest` mang **ý định** của người dùng, không phải trạng thái GPIO đích.
- Core 1 nhận request, chạy qua `evaluateManualSafetyGate()` (pure function, side-effect free).
- Kết quả `ACCEPTED` → set `manualLatch[channel].active = true` với `expiresAt = now + 15 min`.
- Kết quả `REJECTED` → gửi `ManualAck{channel, reason}` về Core 0 để log/MQTT/hiển thị.
- Fuzzy demand cộng dồn với manual latch bằng phép `max()` — manual chỉ được nâng duty, không
  hạ. Manual OFF thì đặt `manualLatch[channel].active = false` và fuzzy tự chạy lại bình thường.

### 4.3. Safety Gate Rules (cứng, không sửa động)

Đầu vào: `TelemetryData`, `Trajectory::SetpointPod` (target hiện tại), `RtcTimePod`.

| Actuator | Nhấn ON bị chặn khi                                                    | Nhấn OFF |
|----------|------------------------------------------------------------------------|----------|
| `MIST`   | `humidity_air` NAN, `humidity_air > 92.0f`, hoặc blackout đang active  | luôn cho |
| `LAMP`   | `temp_air` NAN, `temp_air > temp_target + 3.0f`, hoặc blackout active  | luôn cho |
| `HWAT`   | không expose ra nút vật lý (safety-critical, chỉ fuzzy điều khiển)     | —        |
| `FAN`    | không bao giờ chặn — quạt luôn an toàn                                 | luôn cho |

**Lý do không có nút HWat:** gia nhiệt nước sát biosafety interlock; sai lầm có thể phá vỡ
quỹ đạo trồng nấm. Fan/Lamp/Mist đủ cho vận hành thủ công 90% tình huống thực địa.

### 4.4. Display Task Read-Only

- `taskDisplay` chỉ đọc `getSharedSystemState()` — không viết bất kỳ state nào.
- Serial1 buffer TX hardware của ESP32-S3 đủ cho 4 byte, `Serial1.write()` non-blocking.
- Refresh interval 500 ms; nếu module chỉ nhận binary protocol khác, isolate driver sau
  interface `IDisplayDriver` (Sprint 3).

---

## 5. Danh Sách Sprint

| Sprint | Tiêu đề                                                | Files chính bị tác động                                   |
|--------|--------------------------------------------------------|-----------------------------------------------------------|
| **1**  | Pin map refactor + HAir→HLamp + 2-bulb dispatch        | `config.h`, `models.h`, `FuzzyController.*`, `AdaptiveTuner.*`, `TPC_Task.*`, `core1_tasks.cpp`, `actuators.cpp`, `WebInterface.cpp`, `main.cpp`, `definitions.h`, `run_tests.cpp` |
| **2**  | Cabinet buttons + Manual Request pipeline + Safety Gate | `cabinet_buttons.h` [NEW], `cabinet_buttons.cpp` [NEW], `manual_control.h` [NEW], `manual_control.cpp` [NEW], `definitions.h`, `main.cpp`, `core0_tasks.cpp`, `core1_tasks.cpp`, `mqtt_client.cpp` |
| **3**  | UART LED 7-segment Display Driver                      | `display_driver.h` [NEW], `display_driver.cpp` [NEW], `config.h`, `definitions.h`, `main.cpp`, `core0_tasks.cpp` |
