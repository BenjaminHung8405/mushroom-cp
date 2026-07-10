# WALKTHROUGH_LOG.md

## [2026-07-10T15:43:00+07:00] Task C1 - Cập nhật `init_sensors_placeholder()` — real I2C init trong `#ifndef UNIT_TEST`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/sensors.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Tích hợp `#include "config.h"` vào `sensors.cpp` để truy cập các định nghĩa chân I2C an toàn (`config::pins::PIN_I2C_SDA`, `config::pins::PIN_I2C_SCL`).
  - Cập nhật hàm `init_sensors_placeholder()` để thực hiện khởi tạo I2C thực tế khi không ở chế độ `UNIT_TEST`.
  - Quy trình khởi tạo tuân thủ chính xác cơ chế fail-fast: log thông báo bắt đầu khởi tạo bus I2C và SHT30, gọi `Wire.begin` với tần số clock cố định 50 kHz. Nếu khởi tạo I2C thất bại, set `sht30_healthy = false` và dừng sớm.
  - Thiết lập timeout chống treo bus: Với ESP32, sử dụng `Wire.setTimeOut(3)` (tương ứng với 3ms, khớp với 3000us được yêu cầu). Với các nền tảng khác, sử dụng `Wire.setWireTimeout(3000, true)`.
  - Thực hiện bắt tay với cảm biến SHT30 thông qua `sht30.begin(0x44)`. Nếu thất bại, ghi log lỗi, set `sht30_healthy = false` và return `false`.
  - Tắt heater của SHT30 bằng `sht30.heater(false)` tại thời điểm cold-start để bảo vệ cảm biến, sau đó set các cờ trạng thái khỏe mạnh cho cảm biến và trả về `true`.
  - Khối `#else` dành cho `UNIT_TEST` được giữ nguyên 100% để đảm bảo không ảnh hưởng đến bộ test suite giả lập chạy trên máy host.
- **Kết quả tự kiểm thử**:
  - Đã kiểm tra thành công với PlatformIO build cho board nhúng ESP32-S3: Lệnh `~/.platformio/penv/bin/pio run` biên dịch thành công 100% không có lỗi/cảnh báo (`SUCCESS`), kích thước flash chỉ ~786 KB (nằm trong giới hạn 1 MB).
  - Đã chạy thành công unit test suite trên host: Kết quả PASS toàn bộ test case mà không gặp bất kỳ lỗi logic nào.

## [2026-07-10T15:40:00+07:00] Task B1 - Thêm include Wire.h / Adafruit_SHT31.h + static object sht30 (bao bởi #ifndef UNIT_TEST)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/sensors.cpp) (Sửa đổi)
  - [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Áp dụng cấu trúc cô lập phần cứng (HAL isolation pattern) bằng cách bọc toàn bộ phần include phụ thuộc phần cứng (`Wire.h` và `Adafruit_SHT31.h`) cũng như khai báo đối tượng cảm biến `static Adafruit_SHT31 sht30 = Adafruit_SHT31();` trong khối `#ifndef UNIT_TEST` ... `#endif` ngay tại file `sensors.cpp`. Điều này giúp đảm bảo host test suite chạy bằng g++ (có định nghĩa `-DUNIT_TEST`) không bị rò rỉ các thư viện Arduino gốc và không gây lỗi biên dịch.
  - Sửa đổi lớp giả lập `HardwareSerial` trong file mock `test/Arduino.h` để hỗ trợ toán tử `operator bool() const { return true; }` giúp tương thích tốt với code `main.cpp` khi biên dịch trên host.
- **Kết quả tự kiểm thử**:
  - Chạy lệnh unit test trên host bằng g++: Toàn bộ 100% test cases (bao gồm section 16.x test sensors mock & fault injection) đều PASS thành công không có regression.
  - Chạy lệnh build trên môi trường thật bằng PlatformIO: Biên dịch thành công với trạng thái `SUCCESS`.

## [2026-07-10T15:36:00+07:00] Task A2 - Verify build success (`pio run`)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [platformio.ini](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/platformio.ini) (Sửa đổi)
- **Giải trình giải pháp**:
  - Gặp lỗi thiếu file header `SPI.h` từ thư viện phụ thuộc `Adafruit BusIO` (của `Adafruit SHT31 Library`) trong quá trình phân tích dependency của PlatformIO LDF (Library Dependency Finder) ở chế độ `chain`.
  - Giải pháp: Thêm chỉ thị `lib_ldf_mode = deep` vào `[env:base]` trong `platformio.ini` để kích hoạt bộ tìm kiếm phụ thuộc nâng cao, giúp PlatformIO tự động phát hiện và liên kết thư viện `SPI` tích hợp sẵn của framework Arduino.
- **Kết quả tự kiểm thử**:
  - Đã chạy thành công lệnh `pio run` và `pio run -e otg` trong thư mục `mushroom-iot-firmware`.
  - Kết quả biên dịch: Cả 2 environment `uart` và `otg` đều build thành công (`SUCCESS`).
  - Kích thước bộ nhớ sử dụng (Flash memory budget check):
    - `uart`: 785,585 bytes (~767 KB) <= 1 MB (Pass).
    - `otg`: 768,865 bytes (~750 KB) <= 1 MB (Pass).
