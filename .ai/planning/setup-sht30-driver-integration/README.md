# KẾ HOẠCH TÍCH HỢP DRIVER CẢM BIẾN SHT30 (ĐỘ ẨM & NHIỆT ĐỘ)

## Mục tiêu kỹ thuật tổng quát

Thay thế driver giả lập (mock) hiện tại của cảm biến SHT30 bằng driver phần cứng thực tế, đọc dữ liệu trực tiếp qua bus I2C trên board ESP32-S3. Tích hợp cơ chế sấy khô tự động (Heater) với State Machine có hysteresis để xử lý ngưng tụ ẩm trong đầu dò bọc kim loại, đồng thời đảm bảo toàn bộ Unit Test trên Host vẫn pass mà không cần sửa đổi.

## Danh sách Techstack cốt lõi

* **Ngôn ngữ:** C/C++ (Arduino Framework)
* **Build System:** PlatformIO
* **Board:** ESP32-S3-DevKitC-1 (N16R8)
* **Bus giao tiếp:** I2C (Wire.h), địa chỉ 0x44
* **Driver thư viện:** `adafruit/Adafruit SHT31 Library @ ^2.2.2`
* **Unit Test Host:** G++ C++11 (mocking Arduino.h)
* **Protocol MQTT:** PubSubClient (đã có)

## Quy tắc viết code toàn cục (Coding Conventions)

* **Kiến trúc HAL:** Giữ nguyên namespace `sensors` và interface public (`init_sensors_placeholder`, `read_sht30`, `read_all_telemetry`). Chỉ thay đổi implementation bên trong `#ifndef UNIT_TEST`.
* **Điều kiện biên `#ifndef UNIT_TEST`:** Mọi mã phụ thuộc phần cứng (Wire.h, Adafruit_SHT31.h, Serial.println) phải được bao bởi `#ifndef UNIT_TEST` để đảm bảo Unit Test trên Host compile và chạy bình thường.
* **Quy tắc đặt tên:** Tuân thủ như baseline — `snake_case` cho hàm/biến, `UPPER_SNAKE_CASE` cho macro/constants, `PascalCase` cho class/struct.
* **Xử lý lỗi:** Trả về `false` + gán `NAN` cho output params khi đọc thất bại. Cập nhật `sht30_last_error` tương ứng.
* **State Machine:** Sử dụng `static` local variables trong `read_sht30()` cho heater state (giống pattern hiện tại). Không thêm global state mới.
* **Không phá vỡ API:** Giữ nguyên chữ ký hàm, enum `SensorError`, và các getter/setter fault injection.