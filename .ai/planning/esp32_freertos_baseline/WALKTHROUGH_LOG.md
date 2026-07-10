# WALKTHROUGH_LOG.md

## [2026-07-10T10:18:00+07:00] - Task A2: Triển khai cấu hình dynamic cho WiFi STA và MQTT Broker đọc từ NVS
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
  - Tạo mới: [config.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/config.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Tách biệt nhóm cấu hình WiFi**: 
    1. WiFi cứu hộ (SoftAP): `AP_SSID` và `AP_PASS` được định nghĩa là hằng tĩnh `constexpr` để đảm bảo hoạt động độc lập không phụ thuộc vào NVS.
    2. WiFi hoạt động (STA): `STA_SSID` và `STA_PASS` được khai báo là biến động (`extern String`), khởi tạo mặc định là chuỗi trống và bắt buộc phải nạp động từ bộ nhớ Flash (NVS).
  - **Dynamic MQTT Broker**: Các biến cấu hình MQTT (`MQTT_BROKER_VAL`, `MQTT_PORT_VAL`, `MQTT_USER_VAL`, `MQTT_PASSWORD_VAL`) cũng được chuyển đổi thành biến động `extern` để hỗ trợ ghi đè cấu hình runtime khi nạp từ NVS.
  - **Triển khai hàm `load_runtime_config()`**: Cài đặt logic tải tham số từ NVS thông qua `StorageManager`. Nếu NVS chưa có dữ liệu cấu hình, hệ thống sẽ sử dụng các giá trị fallback an toàn thay vì gây crash.
  - **Tự kiểm duyệt (Self-test)**: Tích hợp kịch bản kiểm thử cho cơ chế nạp cấu hình động runtime trong `test/run_tests.cpp`. Chạy biên dịch offline và test thành công tốt đẹp với compiler Clang++/G++ trên local host.

## [2026-07-10T10:13:00+07:00] - Task A2: Khai báo cấu hình mạng WiFi và cấu hình MQTT Broker qua không gian lưu trữ Flash (NVS)
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
  - Tạo mới: [storage.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/storage.h)
  - Tạo mới: [storage.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/storage.cpp)
  - Khởi tạo: [platformio.ini](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/platformio.ini)
  - Thiết lập môi trường mock test: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h), [Preferences.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Preferences.h), [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Loại bỏ Hardcode Credentials**: Thay đổi toàn bộ các giá trị mặc định của SSID và Password WiFi trong [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) thành chuỗi rỗng để ngăn chặn hoàn toàn việc đặt thông tin cấu hình mạng cố định trong mã nguồn.
  - **Tích hợp Key/Namespace NVS**: Định nghĩa không gian tên NVS (`mushroom_cfg`), các key tương ứng để truy xuất các trường cấu hình thông qua thư viện `Preferences` (`wifi_ssid`, `wifi_pass`, `mqtt_broker`, `mqtt_port`, `mqtt_user`, `mqtt_pass`), và hằng số chuỗi cấu hình mặc định cho SoftAP (`AP_SSID = "TraiNam_Setup_KhongDay"`).
  - **Triển khai Storage Wrapper**: Xây dựng lớp Singleton `StorageManager` để quản lý việc lưu và đọc cấu hình từ bộ nhớ flash thông qua `Preferences.h`. Lớp này đảm bảo đóng/mở namespace NVS an toàn (`begin` và `end`) để tránh rò rỉ dữ liệu hoặc lỗi ghi khi mất nguồn điện đột ngột.
  - **Tự kiểm duyệt (Self-test)**: Tạo môi trường mô phỏng (Mock runtime) cho thư viện Arduino và Preferences trong thư mục `test/` và triển khai bộ kiểm thử tự động tại [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp). Biên dịch offline thành công bằng Clang++ trên macOS và vượt qua toàn bộ 9 bước kiểm tra logic ghi/đọc/xóa dữ liệu.

## [2026-07-10T10:08:00+07:00] - Task A1: Tạo config.h và định nghĩa hằng số GPIO cho 4 Rơ-le, I2C, OneWire
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Xác minh & Cấu trúc lại: [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
- **Giải trình giải pháp**:
  - Đọc và rà soát kỹ file cấu hình [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) trong thư mục `include/` của dự án firmware ESP32.
  - Xác nhận các chân GPIO được chỉ định hoàn hảo cho 4 Rơ-le (chân 10, 11, 12, 13), I2C Bus (SDA chân 8, SCL chân 9), và OneWire Bus (chân 14) thông qua từ khóa `constexpr uint8_t` thay vì macro `#define`, đảm bảo quy tắc an toàn kiểu (Type-Safe).
  - Tệp tiêu đề được trang bị `#pragma once` đầy đủ để tránh trùng lặp tệp tin khi include nhiều lần.
  - Tự kiểm duyệt (Self-test): Tạo tệp `test_config.cpp` để include `config.h` và in thử các giá trị GPIO. Quá trình compile và chạy diễn ra thành công tốt đẹp mà không phát sinh lỗi biên dịch.

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
