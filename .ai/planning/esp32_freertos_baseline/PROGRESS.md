# File: .ai/planning/esp32_freertos_baseline/PROGRESS.md

**Started:** July 10, 2026 at 10:06:00 AM +07 | **Agent:** Gemini
**Reference Plan:** `.ai/planning/esp32_freertos_baseline/sprint_1.md` và `.ai/planning/esp32_freertos_baseline/sprint_2.md`
**Addition Plan:** * **Yêu cầu bổ sung số 01:** Loại bỏ hoàn toàn hardcode SSID/Password. Tích hợp cơ chế cấu hình WiFi không dây qua Chế độ Access Point (SoftAP) kết hợp Cổng cấu hình Captive Portal (Web Server nội bộ). 
* **Chiến lược triển khai:** Để đảm bảo tiến độ lắp đặt thiết bị vào ngày 12/07, Sprint 1 sẽ triển khai lớp kiến trúc mạng tách biệt (Decoupled Hardware Configuration). Sử dụng bộ nhớ Flash (NVS) làm nguồn đọc cấu hình chính. Cơ chế tự động kích hoạt Captive Portal khi mất kết nối/chưa có cấu hình sẽ được chừa sẵn khung (Placeholders) để bàn giao cho Sprint tiếp theo thực thi mà không phá vỡ cấu trúc phần mềm hiện tại.

---

### Track A: Tầng Cấu hình (Sprint 1 - Configuration)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| A1 | Tạo `include/config.h` và định nghĩa hằng số GPIO cho 4 Rơ-le, I2C, OneWire. | [ ] QA Review | Không dùng `#define` bừa bãi. Ép dùng `constexpr uint8_t` để đảm bảo an toàn kiểu dữ liệu (Type-Safe). Bắt buộc có `#pragma once`. |
| A2 | Khai báo cấu hình mạng WiFi và cấu hình MQTT Broker. | [ ] QA Review | Tách biệt rõ hai nhóm biến: <br>1. `AP_SSID`/`AP_PASS`: Tĩnh (`constexpr`), dùng để phát WiFi cứu hộ cấu hình.<br>2. `STA_SSID`/`STA_PASS`: Động, khởi tạo dạng chuỗi trống, bắt buộc đọc từ NVS (Flash). |

### Track B: Tầng Mạng (Sprint 1 - Network WiFi)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| B1 | Tạo khung file `wifi_manager.h` và `wifi_manager.cpp`. | [ ] QA Review | Áp dụng cấu trúc phân tách rõ ràng. Khai báo sẵn các hằng số `AP_SSID` và `AP_PASS` cho mạng SoftAP dự phòng. |
| B2 | Cài đặt logic `init_wifi()` và `check_wifi_connection()`. | [ ] Pending | **Chỉ thị cốt lõi:** Hàm `init_wifi()` bắt buộc phải ưu tiên gọi lệnh đọc SSID/PASS lưu trong NVS Flash trước. Nếu NVS trống, lập tức bỏ qua và trả về mã trạng thái kích hoạt SoftAP (sẽ làm ở Sprint sau), tuyệt đối không hardcode cứng WiFi ra Internet tại đây. |

### Track C: Tầng Mạng (Sprint 1 - Network MQTT)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| C1 | Tạo khung file `mqtt_client.h` và `mqtt_client.cpp`. | [ ] Pending | Cấu trúc class/module phải gom nhóm các topic subscribe và publish rõ ràng. |
| C2 | Cài đặt `init_mqtt()` và `mqtt_reconnect()`. | [ ] Pending | Thêm cờ khóa (Mutex/Flag) để không gọi reconnect liên tục khi WiFi chưa sẵn sàng hoặc đang trong chế độ Captive Portal (SoftAP Mode). |
| C3 | Cài đặt `mqtt_callback()` và logic xử lý payload JSON. | [ ] Pending | **Bảo mật & Bộ nhớ:** Giới hạn byte payload tối đa. Ép dùng `StaticJsonDocument` của ArduinoJson để phân tích cú pháp, tuyệt đối tránh `DynamicJsonDocument` gây phân mảnh RAM (Heap Fragmentation). |

### Track D: Tầng Điều phối Core 0 (Sprint 1 - Core 0 Task)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| D1 | Cài đặt `task_core0_communication()` chạy vòng lặp vô tận kiểm tra mạng & MQTT. | [ ] Pending | Chống tràn Watchdog: Bắt buộc dùng `vTaskDelay()` ở cuối vòng `while(1)`. Theo dõi sát Stack High Water Mark. |
| D2 | Cập nhật hàm `setup()` trong `main.cpp` để ghim Task vào Core 0. | [ ] Pending | Cấu hình stack size hợp lý (VD: 4096 bytes) cho tác vụ có liên quan đến mạng và mã hóa/phân tích JSON. |

### Track E: Tầng Dữ liệu Cấu trúc (Sprint 2 - Models)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| E1 | Tạo file `include/models.h` định nghĩa các Data Structures. | [ ] Pending | Gom nhóm data toàn cục để truyền tải qua FreeRTOS Queue. |
| E2 | Khởi tạo struct `TelemetryData` và `ActuatorCommand`. | [ ] Pending | Ép kiểu Plain Old Data (POD). Khuyến nghị dùng memory alignment đúng chuẩn của 32-bit MCU để tối ưu tốc độ copy data giữa 2 core. |

### Track F: Tầng Giao tiếp Cảm biến (Sprint 2 - Sensors Mock)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| F1 | Tạo `sensors.h` và `sensors.cpp` với hàm `init_sensors_placeholder()`. | [ ] Pending | Xây dựng theo mẫu Hardware Abstraction Layer (HAL). Khai báo các interface/hàm giao tiếp độc lập hoàn toàn với main. |
| F2 | Viết các hàm giả lập đọc SHT30, DS18B20 và SCD30. | [ ] Pending | Cấu trúc giá trị trả về phải có mã lỗi (Error Code) hoặc cơ chế nhận diện dữ liệu NaN/Out of range để chuẩn bị cho cảm biến thật bị hỏng/chập mạch. |

### Track G: Tầng Giao tiếp Chấp hành (Sprint 2 - Actuators Mock)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| G1 | Tạo `actuators.h` và `actuators.cpp` với hàm `init_actuators_gpio()`. | [ ] Pending | **Fail-Safe Phần cứng:** Hàm khởi tạo phải gọi `digitalWrite(pin, LOW)` (hoặc trạng thái OFF của Relay) NGAY SAU KHI khởi tạo `pinMode` để tránh Rơ-le tự kích nổ khi khởi động (Glitch). |
| G2 | Viết hàm `set_Relay_State()` xuất log Terminal và thay đổi trạng thái chân. | [ ] Pending | Bọc hàm này bằng các hằng số kiểm tra ranh giới an toàn. Bắt buộc có Serial log rõ ràng để trace bug trong lúc mock. |

### Track H: Tầng Điều phối Core 1 (Sprint 2 - Core 1 Task)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| H1 | Cài đặt `task_core1_control()` đọc cảm biến và ghi rơ-le định kỳ. | [ ] Pending | Setup FreeRTOS Queue để nhận `ActuatorCommand` từ Core 0. Thiết kế luồng xử lý ưu tiên (Priority) cao để đảm bảo đáp ứng thời gian thực (Real-time). |
| H2 | Cập nhật hàm `setup()` ghim Task vào Core 1. | [ ] Pending | Tránh tranh chấp tài nguyên (Race Condition) nếu có in ra chung cổng Serial (khuyên dùng Mutex cho lệnh `Serial.print` nếu gọi từ cả 2 Core). |
