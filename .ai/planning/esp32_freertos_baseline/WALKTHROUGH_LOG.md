# WALKTHROUGH_LOG.md

## [2026-07-10T09:59:00+07:00] - Task A2: Khai báo cấu hình mạng WiFi và cấu hình MQTT Broker
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
- **Giải trình giải pháp**:
  - Thêm cấu hình WiFi (bao gồm cả fallback SSID/Password) và MQTT Broker vào tệp tiêu đề [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) dưới không gian tên `config::network`.
  - Sử dụng các chỉ thị tiền xử lý `#ifndef` / `#define` / `#endif` cho các thông tin nhạy cảm để hỗ trợ việc ghi đè bằng cờ compile `-D` khi thực hiện build hoặc chạy CI, tránh lộ thông tin bảo mật lên mã nguồn Git.
  - Định nghĩa các hằng số tĩnh dạng `constexpr const char*` và `constexpr uint16_t` trỏ đến các định nghĩa macro để đảm bảo an toàn kiểu dữ liệu (Type-Safe) và dễ tiếp cận trong codebase.
  - Tự kiểm duyệt (Self-test): Tạo một file kiểm tra độc lập và biên dịch thử bằng `g++` (cả trường hợp mặc định lẫn trường hợp dùng cờ `-D` ghi đè giá trị hằng số). Kết quả biên dịch thành công và các giá trị cấu hình được xuất ra chính xác.

## [2026-07-10T09:55:03+07:00] - Task A1: Tạo config.h và định nghĩa hằng số GPIO cho 4 Rơ-le, I2C, OneWire
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
- **Giải trình giải pháp**:
  - Khởi tạo tệp tiêu đề [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) sử dụng chỉ thị tiền xử lý `#pragma once`.
  - Định nghĩa các hằng số chân GPIO trong không gian tên `config::pins` sử dụng từ khóa `constexpr uint8_t` thay vì macro `#define` để đảm bảo an toàn kiểu dữ liệu (Type-Safe) và tránh xung đột tên.
  - Sử dụng quy tắc đặt tên hằng số GPIO dạng `UPPER_SNAKE_CASE` với tiền tố `PIN_` (`PIN_RELAY_MIST`, `PIN_RELAY_FAN`, `PIN_RELAY_HEATER_1`, `PIN_RELAY_HEATER_2`, `PIN_I2C_SDA`, `PIN_I2C_SCL`, `PIN_ONE_WIRE`).
  - Lựa chọn các chân GPIO tối ưu theo khuyến nghị để tránh các strapping pins (GPIO 0, 3, 45, 46) hoặc các chân SPI flash nội bộ của ESP32-S3:
    - 4 Rơ-le (Sương, Quạt, Sưởi 1, Sưởi 2): chân 10, 11, 12, 13
    - I2C Bus (SDA, SCL): chân 8, 9
    - OneWire: chân 14
  - Tự kiểm duyệt (Self-test): Kiểm tra kỹ cú pháp C++ của file header hoàn toàn hợp lệ, không chứa lỗi logic hay cú pháp, và tuân thủ tuyệt đối các ràng buộc trong note kỹ thuật.
