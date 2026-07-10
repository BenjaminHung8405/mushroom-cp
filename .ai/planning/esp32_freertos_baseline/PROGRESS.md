# PROGRESS - ESP32 FreeRTOS Baseline implementation

## Started
- **Thời gian khởi tạo**: `2026-07-10T09:52:50+07:00`
- **Agent thực thi**: Gemini

## Reference Plan
- **Thư mục kế hoạch**: [.ai/planning/esp32_freertos_baseline/](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/esp32_freertos_baseline/)
- **Tài liệu tham chiếu**:
  - Sprint 1: [sprint_1.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/esp32_freertos_baseline/sprint_1.md)
  - Sprint 2: [sprint_2.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/esp32_freertos_baseline/sprint_2.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có (Mặc định)

---

## Status Legend
- `[ ] Pending`: Task chưa chạm vào.
- `[ ] In Progress`: Execution Agent đang viết code.
- `[ ] QA Review`: Code đã viết xong, đang chờ rà soát chất lượng.
- `[x] Done`: Đã qua vòng review nghiêm ngặt và được duyệt.

---

### Track A: Tầng Cấu hình (Sprint 1 - Configuration)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **A1** | Tạo [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) và định nghĩa hằng số GPIO cho 4 Rơ-le, I2C, OneWire. | `[ ] QA Review` | **Chỉ thị kỹ thuật:**<br>- Không dùng `#define` bừa bãi cho hằng số chân. Ép dùng `constexpr uint8_t` để đảm bảo an toàn kiểu dữ liệu (Type-Safe). Bắt buộc có `#pragma once`.<br>- Kiểm tra bảng phân bổ GPIO của ESP32-S3 để tránh strapping pins (GPIO 0, 3, 45, 46) hoặc các chân SPI flash nội bộ (GPIO 26-32 hoặc 33-37 tùy loại). Khuyến nghị: Rơ-le (10, 11, 12, 13), I2C (SDA=8, SCL=9), OneWire (14). |
| **A2** | Khai báo cấu hình mạng WiFi và cấu hình MQTT Broker. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Định nghĩa thông tin nhạy cảm (WiFi, MQTT credentials) trong các khối `#ifndef` / `#define` để cho phép ghi đè bằng compiler flag `-D` khi build/CI, ngăn lộ thông tin bảo mật lên Git.<br>- Khuyến nghị chuẩn bị sẵn cơ chế fallback SSID hoặc cấu hình động qua SmartConfig (dự phòng tương lai). |

### Track B: Tầng Mạng (Sprint 1 - Network WiFi)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **B1** | Tạo khung file [wifi_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/wifi_manager.h) và [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/wifi_manager.cpp). | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Áp dụng nguyên lý Single Responsibility Principle (SRP). Khối này chỉ chịu trách nhiệm duy trì liên kết vật lý (L2/L3).<br>- Định dạng log ra Serial đồng bộ qua tag chuẩn dạng `[WIFI][INFO]` hoặc `[WIFI][ERROR]`. |
| **B2** | Cài đặt logic `init_wifi()`, `check_wifi_connection()` và `reconnect_wifi()`. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- **Nghiêm cấm** dùng vòng lặp blocking kiểu `while(!connected) delay();`. Bắt buộc thiết kế dạng Non-blocking State Machine kiểm tra `WiFi.status()` định kỳ.<br>- Sử dụng cơ chế Exponential Backoff (`2s -> 4s -> 8s -> ... -> max 60s`) khi tự động kết nối lại nhằm tránh spam access point và nghẽn CPU. |

### Track C: Tầng Mạng (Sprint 1 - Network MQTT)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **C1** | Tạo khung file [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h) và [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/mqtt_client.cpp). | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Cấu trúc class/module phải gom nhóm các topic subscribe và publish rõ ràng. Khai báo các biến trạng thái kết nối MQTT. |
| **C2** | Cài đặt `init_mqtt()` và `mqtt_reconnect()`. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Thêm cờ khóa (Mutex/Flag) hoặc kiểm tra `WiFi.isConnected()` để không gọi reconnect liên tục khi WiFi chưa sẵn sàng, tránh làm quá tải stack mạng. |
| **C3** | Cài đặt `mqtt_callback()` và logic xử lý payload JSON. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- **Bảo mật & Bộ nhớ:** Giới hạn byte payload tối đa (ví dụ: 512 bytes). Sao chép payload bằng `strlcpy` thay vì `strcpy` để phòng chống Buffer Overflow.<br>- Ép dùng `StaticJsonDocument` hoặc `JsonDocument` (V7) của ArduinoJson cấp phát tĩnh trên Stack để phân tích cú pháp, tuyệt đối tránh `DynamicJsonDocument` hay cấp phát động gây phân mảnh RAM (Heap Fragmentation).<br>- Callback phải non-blocking: parse JSON xong đẩy data vào FreeRTOS Queue, không điều khiển thiết bị trực tiếp tại callback. |

### Track D: Tầng Điều phối Core 0 (Sprint 1 - Core 0 Task)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **D1** | Cài đặt `task_core0_communication()` chạy vòng lặp vô tận kiểm tra mạng & MQTT. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Chống tràn Watchdog: Bắt buộc dùng `vTaskDelay(pdMS_TO_TICKS(10))` ở cuối vòng lặp `while(1)` để nhường CPU cho stack mạng chạy ngầm và tránh trigger Task Watchdog Timer (TWDT).<br>- Theo dõi sát Stack High Water Mark để đảm bảo không bị tràn bộ nhớ task. |
| **D2** | Cập nhật hàm `setup()` trong [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp) để ghim Task vào Core 0. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Cấu hình stack size hợp lý (khuyến nghị 4096 bytes) cho tác vụ mạng và phân tích JSON.<br>- Kiểm tra giá trị trả về của `xTaskCreatePinnedToCore` để xử lý khi khởi tạo task thất bại. |

### Track E: Tầng Dữ liệu Cấu trúc (Sprint 2 - Models)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **E1** | Tạo file [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h) định nghĩa các Data Structures. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Gom nhóm data toàn cục để truyền tải qua FreeRTOS Queue. Tuyệt đối không truyền dữ liệu thô dạng biến toàn cục trần (global variables) để tránh xung đột dữ liệu (data race). |
| **E2** | Khởi tạo struct `TelemetryData` và `ActuatorCommand`. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Ép kiểu Plain Old Data (POD). Sắp xếp các trường tối ưu (struct alignment/padding) cho 32-bit MCU để tối ưu tốc độ copy data giữa 2 core qua queue.<br>- Khai báo rõ kiểu dữ liệu cố định kích thước (`uint8_t`, `bool`, `float`).<br>- Ghi chú rõ đơn vị đo lường bằng comment tại từng trường để giảm nợ kỹ thuật và hỗ trợ tích hợp backend dễ dàng. |

### Track F: Tầng Giao tiếp Cảm biến (Sprint 2 - Sensors Mock)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **F1** | Tạo [sensors.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/sensors.h) và [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/hardware/sensors.cpp) với hàm `init_sensors_placeholder()`. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Xây dựng theo mẫu Hardware Abstraction Layer (HAL). Khai báo các interface/hàm giao tiếp độc lập hoàn toàn với main. Khi chuyển sang driver thật (SHT30, DS18B20, SCD30) chỉ cần sửa file `.cpp` triển khai mà không phải sửa logic điều khiển. |
| **F2** | Viết các hàm giả lập đọc SHT30, DS18B20 và SCD30. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Cấu trúc giá trị trả về phải có mã lỗi (Error Code) hoặc cơ chế nhận diện dữ liệu NaN/Out of range để chuẩn bị cho cảm biến thật bị hỏng/chập mạch.<br>- Dữ liệu giả lập phải thực tế (độ ẩm 50-95%, nhiệt độ 20-40 độ C) và có biến thiên ngẫu nhiên nhẹ để kiểm tra logic lọc dữ liệu. |

### Track G: Tầng Giao tiếp Chấp hành (Sprint 2 - Actuators Mock)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **G1** | Tạo [actuators.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/actuators.h) và [actuators.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/hardware/actuators.cpp) với hàm `init_actuators_gpio()`. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- **Fail-Safe Phần cứng:** Hàm khởi tạo phải gọi `digitalWrite(pin, LOW)` (hoặc trạng thái OFF của Relay) NGAY SAU KHI khởi tạo `pinMode` thành `OUTPUT` để tránh Rơ-le tự kích hoạt ngoài ý muốn khi ESP32 reboot (Glitch). |
| **G2** | Viết hàm `set_Relay_State()` xuất log Terminal và thay đổi trạng thái chân. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Bọc hàm này bằng các hằng số kiểm tra ranh giới an toàn chân GPIO.<br>- Bắt buộc ghi log Serial rõ ràng kèm Tick Count (`xTaskGetTickCount()`) để trace bug chính xác trình tự đóng ngắt. |

### Track H: Tầng Điều phối Core 1 (Sprint 2 - Core 1 Task)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| **H1** | Cài đặt `task_core1_control()` đọc cảm biến và ghi rơ-le định kỳ. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Setup FreeRTOS Queue để nhận `ActuatorCommand` từ Core 0.<br>- Thiết kế luồng xử lý ưu tiên (Priority) lớn hơn hoặc bằng Core 0 để đảm bảo đáp ứng thời gian thực (Real-time) cho các tác vụ đo đạc và điều khiển ngoại vi khi mạng chập chờn.<br>- Nghiêm cấm dùng `new`, `malloc` hoặc kiểu dữ liệu `String` trong vòng lặp vô tận của task để ngăn Heap Fragmentation. Dùng `vTaskDelay` thay vì `delay()`. |
| **H2** | Cập nhật hàm `setup()` ghim Task vào Core 1. | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- **Race Condition Prevention:** Tránh tranh chấp tài nguyên khi in ra cổng Serial. Khuyên dùng Mutex cho lệnh `Serial` (hoặc tạo task in log riêng) nếu ghi log từ cả hai Core đồng thời để tránh làm méo mó hoặc mất log. |
