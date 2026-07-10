# SPRINT 2: Thay thế Mock Driver bằng Real I2C Driver & Heater State Machine

## 1. PHẠM VI & MỤC TIÊU

Thay thế toàn bộ logic giả lập (sine/cosine) trong `read_sht30()` bằng đọc dữ liệu thực tế qua I2C. Tích hợp State Machine điều khiển Heater với hysteresis để sấy khô cảm biến khi độ ẩm bão hòa. Đồng thời cập nhật `init_sensors_placeholder()` để khởi tạo bus I2C và đối tượng SHT30.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

Luồng khởi tạo:
```
[ESP32 Boot] -> core1_tasks.cpp gọi init_sensors_placeholder()
    -> Wire.begin(SDA=8, SCL=9, clock=50000)
    -> sht30.begin(0x44) kiểm tra ACK trên bus I2C
    -> sht30.heater(false) đảm bảo heater OFF ban đầu
    -> Set cờ sensors_initialized = true, sht30_healthy = true
```

Luồng đọc dữ liệu (mỗi chu kỳ telemetry):
```
[Core 1 Telemetry Task] -> read_sht30(&temp, &hum)
    -> if (!initialized || !healthy) -> return false, temp=NAN, hum=NAN
    -> temp = sht30.readTemperature()
    -> hum  = sht30.readHumidity()
    -> if (isnan(temp) || isnan(hum)) -> return false, set ERR_CRC_MISMATCH
    -> [STATE MACHINE CHECK]
       |-> is_heating == false:
       |     if (hum >= 99.0 && elapsed > 600s) -> heater(true), is_heating=true
       |     else -> hum >= 99.0 reset saturation timer
       |-> is_heating == true:
       |     temp = NAN (khóa logic điều khiển actuator)
       |     if (elapsed > 300s || hum < 90.0) -> heater(false), is_heating=false
    -> return true
```

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Include & Khai báo Đối tượng Phần cứng

* **Sửa đổi file:** [include/sensors.h](mushroom-iot-firmware/include/sensors.h)
* **Hàm/Khai báo cần xử lý:**
  - Không thay đổi interface public. Chỉ giữ nguyên các declaration hiện có.

* **Sửa đổi file:** [src/sensors.cpp](mushroom-iot-firmware/src/sensors.cpp)
* **Hàm/Khai báo cần xử lý:**
  - Thêm block include điều kiện sau dòng `#include "sensors.h"`:
    ```cpp
    #ifndef UNIT_TEST
    #include <Wire.h>
    #include <Adafruit_SHT31.h>
    #endif
    ```
  - Thêm khai báo static object sau các static flag hiện tại (sau dòng `scd30_last_error`):
    ```cpp
    #ifndef UNIT_TEST
    static Adafruit_SHT31 sht30 = Adafruit_SHT31();
    #endif
    ```

### TRACK 2: Cập nhật Hàm Khởi tạo `init_sensors_placeholder()`

* **Sửa đổi file:** [src/sensors.cpp]
* **Hàm/Khai báo cần xử lý:**
  - Hàm `init_sensors_placeholder()`:
    - Giữ nguyên logic mock cho khối `#else` / `UNIT_TEST`.
    - Trong khối `#ifndef UNIT_TEST`, thay thế assignment trực tiếp bằng:
      1. `Serial.println("[SENSORS] Initializing Real I2C Bus and SHT30...")`
      2. `Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 50000)` — khởi động I2C ở 50 kHz
      3. Kiểm tra return value của `Wire.begin()` — nếu false: set `sht30_healthy = false`, `return false`
      4. `Wire.setWireTimeout(3000, true)` — kích hoạt auto-reset bus khi treo
      5. `sht30.begin(0x44)` — probe địa chỉ I2C cảm biến
      6. Kiểm tra return value — nếu false: set `sht30_healthy = false`, `return false`
      7. `sht30.heater(false)` — đảm bảo heater OFF khi khởi tạo
      8. Set `sensors_initialized = true`, `sht30_healthy = true`
    - Khối `#else` (UNIT_TEST): giữ nguyên như cũ (set flags = true).

### TRACK 3: Thay thế Logic Giả lập trong `read_sht30()`

* **Sửa đổi file:** [src/sensors.cpp]
* **Hàm/Khai báo cần xử lý:**
  - Hàm `read_sht30(float &temp, float &hum)`:
    - Giữ nguyên 2 guard clause đầu (`!sensors_initialized`, `!sht30_healthy`) — không thay đổi.
    - Trong khối `#ifndef UNIT_TEST`, thay thế đoạn sine/cosine mock bằng:
      1. Đọc thực tế: `temp = sht30.readTemperature()`, `hum = sht30.readHumidity()`
      2. Kiểm tra NaN: `if (isnan(temp) || isnan(hum))` -> set `ERR_CRC_MISMATCH`, return false
      3. **State Machine Heater** (4 biến static local):
         - `static unsigned long humidity_saturated_start = 0;`
         - `static unsigned long heat_start_time = 0;`
         - `static bool is_heating = false;`
         - Logic nhánh `!is_heating`:
           - Nếu `hum >= 99.0f`: nếu `saturation_start == 0` thì gán `millis()`, còn nếu `elapsed > 600000UL` (10 phút) thì bật heater, set `is_heating = true`, ghi `heat_start_time`
           - Nếu `hum < 99.0f`: reset `humidity_saturated_start = 0`
         - Logic nhánh `is_heating`:
           - Luôn gán `temp = NAN` để khóa logic actuator
           - Nếu `elapsed > 300000UL` (5 phút) HOẶC `hum < 90.0f`: tắt heater, set `is_heating = false`, in log INFO
    - Trong khối `#else` (UNIT_TEST): giữ nguyên hoàn toàn logic sine/cosine mock hiện tại.

### TRACK 4: Không thay đổi các hàm khác

* **Các hàm giữ nguyên:** `read_ds18b20()`, `read_scd30()`, `read_all_telemetry()`, tất cả getter/setter fault injection.
* **Lý do:** Sprint này chỉ tập trung vào SHT30. DS18B20 và SCD30 vẫn dùng mock cho đến sprint sau.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Nghiêm cấm delay/blocking:** Không được dùng `delay()` hoặc vòng lặp `while` blocking trong bất kỳ hàm nào của sensors.cpp. Tất cả timer phải dựa trên `millis()` so sánh delta (non-blocking pattern).
2. **Static variable thread-safety:** Biến static local trong `read_sht30()` chia sẻ trạng thái giữa các lần gọi. Nếu `read_all_telemetry()` gọi `read_sht30()` nhiều lần trong cùng chu kỳ, state machine phải nhất quán. Không dùng `volatile` — FreeRTOS trên ESP32 đảm bảo atomicity cho `uint32_t` write/read.
3. **I2C Bus Timeout Protection:** Phải gọi `Wire.setWireTimeout(3000, true)` trong `init_sensors_placeholder()`. Nếu cảm biến treo/bus I2C bị kéo thấp bởi thiết bị khác, ESP32 tự động reset bus mà không cần watchdog reboot.
4. **Heater Power Constraint:** Heater SHT30 tiêu thụ ~120 mA liên tục. Không được bật heater quá 5 phút liên tục (guard trong state machine). Nếu heater cần bật lại, phải có ít nhất 10 phút cooldown (độ ẩm < 99%).