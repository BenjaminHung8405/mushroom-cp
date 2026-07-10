# SPRINT 1: Cấu hình Hệ thống & Luồng Truyền thông (Core 0)

## 1. PHẠM VI & MỤC TIÊU
Thiết lập cấu hình tĩnh toàn cục cho phần cứng. Dựng và chạy thành công Task kết nối mạng (WiFi) và Task MQTT Client trên Core 0. Đảm bảo ESP32-S3 có thể nhận cấu hình JSON từ Backend mà không làm treo các tiến trình khác.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
[ESP32 Boot] -> Khởi tạo Task Core 0 -> Kích hoạt WiFi -> Đợi WiFi Connected -> Kích hoạt MQTT Client -> Đăng nhập Broker -> Subscribe Topic Command.
Luồng nhận lệnh: Nhận gói tin MQTT -> Kích hoạt MQTT Callback -> Phân tích cú pháp chuỗi JSON -> Đẩy dữ liệu cấu hình vào FreeRTOS Queue -> Hoàn tất Callback.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Tầng Cấu hình (Configuration)
* Tạo mới file: `include/config.h`
* Hàm/Khai báo cần xử lý:
  - Khai báo `#define` cho 4 chân GPIO Rơ-le (Sương, Quạt, Sưởi 1, Sưởi 2).
  - Khai báo `#define` cho chân I2C (SDA, SCL) và OneWire.
  - Khai báo thông tin cấu hình mạng: `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_BROKER`, `MQTT_PORT`, `MQTT_CLIENT_ID`.

### TRACK 2: Tầng Mạng (Network - WiFi)
* Tạo mới file: `src/network/wifi_manager.cpp` và `include/wifi_manager.h`
* Hàm/Khai báo cần xử lý:
  - Hàm `init_wifi()`: Thiết lập chế độ Station và bắt đầu kết nối.
  - Hàm `check_wifi_connection()`: Hàm non-blocking kiểm tra trạng thái mạng.
  - Hàm `reconnect_wifi()`: Logic xử lý tự động kết nối lại khi rớt mạng.

### TRACK 3: Tầng Mạng (Network - MQTT)
* Tạo mới file: `src/network/mqtt_client.cpp` và `include/mqtt_client.h`
* Hàm/Khai báo cần xử lý:
  - Hàm `init_mqtt()`: Cấu hình server, port và gán callback.
  - Hàm `mqtt_callback(char* topic, byte* payload, unsigned int length)`: Bắt sự kiện có tin nhắn đến, cấp phát bộ nhớ động an toàn để in ra Terminal chuỗi JSON nhận được.
  - Hàm `mqtt_reconnect()`: Vòng lặp kết nối lại broker nếu mất kết nối.

### TRACK 4: Tầng Điều phối (Core 0 Task)
* Sửa đổi file: `src/main.cpp`
* Hàm/Khai báo cần xử lý:
  - Hàm `task_core0_communication(void *pvParameters)`: Vòng lặp vô tận (while 1) chứa `check_wifi_connection()` và `mqtt->loop()`. Kèm `vTaskDelay` chống tràn Watchdog Timer.
  - Hàm `setup()`: Gọi `xTaskCreatePinnedToCore` để ghim `task_core0_communication` vào Core 0.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. Nghiêm cấm sử dụng hàm `delay()` tiêu chuẩn trong toàn bộ khối mã của Sprint này. Chỉ được phép dùng `vTaskDelay`.
2. Hàm `mqtt_callback` phải giới hạn kích thước buffer JSON tối đa (ví dụ 512 bytes) để chống tràn bộ nhớ (Buffer Overflow).
3. Logic reconnect WiFi và MQTT không được đưa vào vòng lặp vô tận khóa luồng (blocking while loop), phải sử dụng state machine kết hợp timer không đồng bộ (non-blocking).