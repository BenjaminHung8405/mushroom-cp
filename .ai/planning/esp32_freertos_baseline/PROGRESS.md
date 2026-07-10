# PROGRESS - ESP32 FreeRTOS Baseline implementation

## Started
- **Thời gian khởi tạo**: `2026-07-10T09:51:16+07:00`
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

## Track A: Hệ thống, Mạng & Truyền thông Core 0 (Sprint 1)

| Task ID | Mô tả Task | Status | Note |
| :--- | :--- | :--- | :--- |
| **A1** | Khởi tạo cấu hình tĩnh phần cứng và thông số mạng tại [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Ép áp dụng đặt tên `UPPER_SNAKE_CASE` cho tất cả hằng số và macro chân GPIO.<br>- Tránh các chân boot strapping của ESP32-S3 (GPIO 0, 3, 45, 46) và các chân SPI flash nội bộ. Đề xuất: Rơ-le (GPIO 10, 11, 12, 13), I2C (SDA=8, SCL=9), OneWire (14).<br>- Bảo mật: Bọc thông số WiFi/MQTT trong block `#ifndef` / `#define` để hỗ trợ ghi đè từ compiler flag, tránh lưu thông tin nhạy cảm vào Git. |
| **A2** | Triển khai module WiFi non-blocking tại [wifi_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/wifi_manager.h) và [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/wifi_manager.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Bắt buộc dùng WiFi Station mode non-blocking. Tuyệt đối không dùng vòng lặp blocking `while(!connected)` trong runtime.<br>- Áp dụng cơ chế Exponential Backoff cho logic tự động kết nối lại (`2s -> 4s -> 8s -> ... -> max 60s`) để tránh làm nghẽn AP và tiết kiệm CPU.<br>- Định dạng log chuẩn hóa `[WIFI][INFO]/[ERROR]` giúp phân tích và giám sát lỗi từ xa. |
| **A3** | Triển khai Client MQTT an toàn tại [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h) và [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/mqtt_client.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Bảo mật: Trong `mqtt_callback`, sao chép payload sang buffer an toàn có giới hạn kích thước nghiêm ngặt (tối đa 512 bytes) bằng `strlcpy` để phòng chống Buffer Overflow.<br>- Chống nợ kỹ thuật: Sử dụng `StaticJsonDocument` hoặc `JsonDocument` (V7) phân bổ tĩnh trên Stack để parse JSON. Không dùng `DynamicJsonDocument` hay cấp phát động trên Heap để chống phân mảnh RAM.<br>- Luồng dữ liệu: Hàm callback phải hoàn tất nhanh chóng (non-blocking). Chỉ parse và đẩy dữ liệu vào FreeRTOS Queue, không điều khiển phần cứng trực tiếp tại đây. |
| **A4** | Tích hợp và khởi chạy task Core 0 trong [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Vòng lặp `task_core0_communication` phải chứa `vTaskDelay(pdMS_TO_TICKS(10))` ở mỗi chu kỳ để tránh kích hoạt Task Watchdog Timer (TWDT) và nhường CPU cho stack mạng chạy ngầm.<br>- Kiểm tra mã lỗi trả về của `xTaskCreatePinnedToCore` để đảm bảo Task được tạo thành công trên Core 0. Stack size khuyến nghị: 4096 bytes. |

---

## Track B: Ngoại vi & Điều khiển Core 1 (Sprint 2)

| Task ID | Mô tả Task | Status | Note |
| :--- | :--- | :--- | :--- |
| **B1** | Thiết lập cấu trúc dữ liệu dùng chung tại [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Tối ưu hóa bộ nhớ: Sắp xếp các trường của struct `TelemetryData` và `ActuatorCommand` theo alignment tự nhiên của compiler để tránh lãng phí RAM do padding.<br>- Dùng kiểu dữ liệu kích thước cố định (`uint8_t`, `bool`, `float`).<br>- Ghi chú rõ đơn vị đo lường bằng comment tại từng trường để giảm nợ kỹ thuật và hỗ trợ tích hợp backend dễ dàng. |
| **B2** | Triển khai mock lớp cảm biến tại [sensors.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/sensors.h) và [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/hardware/sensors.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Thiết kế theo Abstraction Pattern (Interface-driven): Signature các hàm đọc cảm biến `read_*` phải độc lập với phần cứng thật bên dưới, giúp chuyển sang driver thật (SHT30, DS18B20, SCD30) dễ dàng mà không làm thay đổi logic điều phối.<br>- Giá trị giả lập phải hợp lệ và mô phỏng sự biến thiên nhẹ (thêm nhiễu ngẫu nhiên nhỏ) để tránh các bộ lọc hoặc logic kiểm soát biên coi là lỗi. |
| **B3** | Triển khai mock lớp chấp hành tại [actuators.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/actuators.h) và [actuators.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/hardware/actuators.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- **Safe Boot State**: Trong `init_actuators_gpio()`, ngay lập tức kéo các chân GPIO điều khiển rơ-le về trạng thái mặc định an toàn (`LOW` hoặc tắt) ngay sau khi cấu hình `pinMode` thành `OUTPUT`, tránh rơ-le tự đóng ngắt khi ESP32 khởi động lại.<br>- Log: Hàm `set_Relay_State` phải in log rõ ràng định dạng chuẩn kèm theo Tick Count của FreeRTOS (`xTaskGetTickCount()`) để hỗ trợ kiểm tra thời gian thực. |
| **B4** | Tích hợp và khởi chạy task Core 1 trong [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp) | `[ ] Pending` | **Chỉ thị kỹ thuật:**<br>- Ghim Task bằng `xTaskCreatePinnedToCore` vào Core 1 (Core ID = 1).<br>- Độ ưu tiên (Priority) của Task điều khiển Core 1 phải bằng hoặc cao hơn Task Core 0 để đảm bảo tính thời gian thực cho việc giám sát cảm biến và an toàn thiết bị khi mạng bị ngắt hoặc nghẽn.<br>- Nghiêm cấm dùng `new`, `malloc` hoặc kiểu dữ liệu `String` trong vòng lặp vô tận của `task_core1_control` để ngăn ngừa rò rỉ và phân mảnh Heap. Dùng `vTaskDelay` thay vì `delay()`. |
