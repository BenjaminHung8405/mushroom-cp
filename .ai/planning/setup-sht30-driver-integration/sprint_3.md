# SPRINT 3: Verification — Host Unit Test & Manual Hardware Validation

## 1. PHẠM VI & MỤC TIÊU

Xác nhận driver SHT30 mới không phá vỡ Unit Test Host hiện tại (nhờ `#ifndef UNIT_TEST`). Kiểm tra end-to-end trên phần cứng thật: bus I2C 50 kHz, đọc nhiệt độ/độ ẩm thực tế, và mô phỏng kích hoạt Heater State Machine khi bão hòa ẩm.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

Luồng Host Unit Test:
```
[g++ -DUNIT_TEST] -> sensors.cpp (#else mock branch)
    -> run_tests.cpp assert suite (section 16.x)
    -> Tất cả assert SHT30 pass (sine/cosine mock)
```

Luồng Manual Hardware:
```
[ESP32-S3 + SHT30 probe]
    -> Serial Monitor (115200 baud)
    -> [SENSORS] Initializing Real I2C Bus and SHT30...
    -> [SENSORS] SHT30 found at 0x44
    -> Telemetry loop: temp=xx.x°C, hum=xx.x%
    -> (Thổi hơi ẩm 10 phút) -> Heater ON, temp=NAN
    -> (5 phút sau / hum < 90%) -> Heater OFF, temp thực tế trở lại
```

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Host Unit Test Regression

* **Không sửa file:** [test/run_tests.cpp](mushroom-iot-firmware/test/run_tests.cpp)
* **Hàm/Khai báo cần xử lý:**
  - Không thay đổi bất kỳ test case nào trong section 16.x (Sensors Mock & Fault Injection).
  - Chạy lệnh:
    ```bash
    cd mushroom-iot-firmware && \
    g++ -std=c++11 -DUNIT_TEST -Iinclude -Itest \
        test/run_tests.cpp src/sensors.cpp src/actuators.cpp \
        src/serial_mutex.cpp src/storage.cpp src/config.cpp \
        src/wifi_manager.cpp src/mqtt_client.cpp \
        -o run_tests && ./run_tests
    ```
  - **Checklist assert bắt buộc pass:**
    1. `read_sht30()` trước init → `false`, `ERR_NOT_INITIALIZED`, temp/hum = NAN
    2. `init_sensors_placeholder()` → `true`
    3. `read_sht30()` sau init → `true`, temp ∈ [23, 27], hum ∈ [75, 85]
    4. Fault injection `set_simulated_health_sht30(false)` → `ERR_DISCONNECTED`
    5. Dynamic variation với `mock_millis_offset = 10000` → giá trị thay đổi

### TRACK 2: Verify `#ifndef UNIT_TEST` Isolation

* **Sửa đổi file:** [src/sensors.cpp](mushroom-iot-firmware/src/sensors.cpp) — chỉ kiểm tra, không sửa nếu đã đúng
* **Hàm/Khai báo cần xử lý:**
  - Hàm `init_sensors_placeholder()`: xác nhận khối real I2C nằm trong `#ifndef UNIT_TEST`, mock trong `#else`.
  - Hàm `read_sht30()`: xác nhận State Machine Heater và `sht30.readTemperature()` nằm trong `#ifndef UNIT_TEST`.
  - Khai báo `static Adafruit_SHT31 sht30`: xác nhận bao bởi `#ifndef UNIT_TEST`.
  - Include `Wire.h` / `Adafruit_SHT31.h`: xác nhận bao bởi `#ifndef UNIT_TEST`.

### TRACK 3: Manual Hardware Validation Checklist

* **Không tạo file mới** — chỉ checklist vận hành trên board thật.
* **Các bước bắt buộc:**
  1. **Phần cứng:** Hàn pull-up 4.7 kΩ SDA→3.3V và SCL→3.3V gần board ESP32-S3. Nối shield GND chỉ ở phía board.
  2. **Nạp firmware:** `pio run -t upload -e uart` (hoặc `-e otg` tùy cổng).
  3. **Serial Monitor:** `pio device monitor` — xác nhận log:
     - `[SENSORS] Initializing Real I2C Bus and SHT30...`
     - Không có `ERROR: SHT30 not found at 0x44!`
  4. **Đọc giá trị thực:** Xác nhận temp và hum xuất hiện trong telemetry MQTT/log với giá trị hợp lý (không phải mock sine).
  5. **Mô phỏng bão hòa:** Thổi hơi ẩm vào đầu dò đến khi hum ≥ 99% liên tục 10 phút.
     - Xác nhận log: `WARNING: Humidity saturated. Turning ON SHT30 Heater!`
     - Xác nhận `temp = NAN` trong telemetry khi đang sấy.
     - Xác nhận actuator (quạt/sưởi) không bị kích hoạt sai do nhiệt độ ảo.
  6. **Tắt heater:** Sau 5 phút hoặc khi hum < 90%:
     - Xác nhận log: `INFO: SHT30 Heater OFF. Saturation cleared.`
     - Xác nhận temp trở về giá trị thực (không còn NAN).

### TRACK 4: Document kết quả Verification

* **Tạo mới file (nếu Agent thực thi):** không bắt buộc trong plan này — chỉ ghi nhận trong WALKTHROUGH_LOG khi chạy.
* **Checklist ghi nhận:**
  - Kết quả host unit test (pass/fail count)
  - Kết quả build PlatformIO
  - Screenshot/serial log snippet khởi tạo I2C thành công
  - Ghi chú bất kỳ lệch so với plan (ví dụ: địa chỉ I2C 0x45 thay vì 0x44)

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Zero regression trên Host:** Toàn bộ assert trong `run_tests` section 16.x phải pass 100%. Nếu bất kỳ assert nào fail → driver isolation `#ifndef UNIT_TEST` bị rò rỉ, phải fix trước khi merge.
2. **Fail-safe nhiệt độ khi sấy:** Khi `is_heating == true`, `temp` BẮT BUỘC là `NAN`. Downstream logic (fuzzy engine / actuator) phải coi NAN là "không điều khiển" — không được fallback sang 0°C hay giá trị mặc định.
3. **I2C clock ≤ 50 kHz:** Không được tăng clock lên 100 kHz hoặc 400 kHz trong production build. Dây dài + đầu dò kim loại yêu cầu clock thấp để chống méo xung. Kiểm tra bằng cách đọc log hoặc đo oscilloscope nếu có.
4. **Không hardcode pin ngoài config.h:** Mọi tham chiếu pin I2C phải dùng `config::pins::PIN_I2C_SDA` / `PIN_I2C_SCL`. Nghiêm cấm magic number `8` hoặc `9` trong sensors.cpp.
