# SPRINT 1: Cấu hình PlatformIO & Include Driver Thư viện SHT30

## 1. PHẠM VI & MỤC TIÊU

Cập nhật file cấu hình PlatformIO để tích hợp thư viện `adafruit/Adafruit SHT31 Library`. Đây là bước tiền đề bắt buộc — mọi thay đổi code trong sensors.cpp sẽ fail compile nếu thiếu dependency này. Không thay đổi logic nghiệp vụ nào ở sprint này.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

[Developer] -> Sửa `platformio.ini` (thêm lib_deps) -> Chạy `pio run` (compile check) -> Xác nhận không linker error cho thư viện SHT31.

Luồng build:
```
platformio.ini (lib_deps thêm adafruit/Adafruit SHT31 Library)
    -> pio run (download lib từ PlatformIO Registry)
    -> Compile toàn bộ src/*.cpp với -DARDUINO=xxx
    -> Link với libAdafruit_SHT31.a
    -> Generate firmware.bin
```

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Cấu hình Build System (PlatformIO)

* **Sửa đổi file:** [platformio.ini](mushroom-iot-firmware/platformio.ini)
* **Hàm/Khai báo cần xử lý:**
  - Thêm dòng `adafruit/Adafruit SHT31 Library @ ^2.2.2` vào khối `lib_deps` trong `[env:base]` (khoảng dòng 53).
  - Đảm bảo thụt lề đồng nhất với các dòng lib_deps khác (4 spaces).

### TRACK 2: Verify Build Success

* **Tác vụ:** Chạy lệnh `cd mushroom-iot-firmware && pio run`
* **Mục tiêu:** Build pass hoàn toàn, không có warning/error mới nào so với baseline.
* **Checklist:**
  - Thư viện được download và giải nén vào `.piolibdeps/`
  - File `Adafruit_SHT31.cpp` compile thành công
  - Linker tìm thấy symbol `Adafruit_SHT31::begin(uint8_t)` và `Adafruit_SHT31::readTemperature()`

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Phiên bản thư viện tối thiểu:** Phải dùng `^2.2.2` trở lên — phiên bản cũ (< 2.2) có bug trong hàm `readTemperature()` trả về giá trị âm sai trên ESP32-S3 PSRAM.
2. **Không xung đột Wire.h:** Thư viện Adafruit SHT31 sử dụng `Wire` (ESP32 Core Wire library). Phải đảm bảo không có file nào trong project redefine hoặc conflict với `#include <Wire.h>`.
3. **Build size giới hạn:** Firmware binary sau khi thêm thư viện không được vượt quá 1 MB flash partition (hiện tại ~400 KB, margin an toàn > 600 KB).