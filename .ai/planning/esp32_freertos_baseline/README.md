# KẾ HOẠCH TRIỂN KHAI: Khởi tạo Khung xương FreeRTOS & Placeholders (ESP32-S3)

## Mục tiêu kỹ thuật tổng quát
Thiết lập bộ khung kiến trúc firmware đa luồng (Dual-Core) trên ESP32-S3. Phân tách rõ ràng luồng xử lý mạng (Core 0) và luồng thu thập/điều khiển thiết bị (Core 1). Khởi tạo sẵn các vùng chờ (Placeholders) cho thiết bị ngoại vi và cấu hình chân GPIO chuẩn bị cho phần cứng thực tế, cho phép firmware có thể compile, chạy giả lập nội bộ và giao tiếp với Backend NestJS mà không cần linh kiện thật.

## Danh sách Techstack cốt lõi
* Ngôn ngữ: C/C++
* Framework: PlatformIO (Arduino Framework cho ESP32) hoặc ESP-IDF
* Hệ điều hành thời gian thực: FreeRTOS
* Thư viện mạng & IoT: PubSubClient (MQTT), WiFi.h
* Xử lý dữ liệu: ArduinoJson

## Quy tắc viết code toàn cục (Coding Conventions)
* **Kiến trúc:** Áp dụng Clean Architecture cho firmware (Phân tách Hardware Layer, Logic Layer, và Network Layer). Tuân thủ nguyên lý SRP (Single Responsibility Principle) - mỗi hàm chỉ làm một việc.
* **Quy tắc đặt tên:** - Hằng số và Macro định nghĩa chân GPIO: `UPPER_SNAKE_CASE` (VD: `PIN_RELAY_MIST`).
  - Tên class, struct: `PascalCase` (VD: `SensorData`).
  - Tên hàm và biến cục bộ/toàn cục: `snake_case` (VD: `read_sensor_data()`).
* **Quản lý bộ nhớ & FreeRTOS:** Bắt buộc sử dụng FreeRTOS Queue để truyền dữ liệu giữa Core 0 và Core 1 (không dùng biến toàn cục trần). Bắt buộc sử dụng Mutex/Semaphore khi truy cập tài nguyên dùng chung.
* **Xử lý lỗi (Error Handling):** Các hàm kết nối (WiFi, MQTT) phải có cơ chế non-blocking và retry với Exponential Backoff. Không sử dụng hàm `delay()` trong các vòng lặp Task chính, bắt buộc dùng `vTaskDelay()`.