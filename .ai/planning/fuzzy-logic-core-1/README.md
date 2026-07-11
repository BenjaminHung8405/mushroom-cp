# KẾ HOẠCH TỔNG THỂ: HỆ THỐNG ĐIỀU KHIỂN NẤM RƠM FUZZY LOGIC ESP32 (NẤM RƠM CP)

## 1. MỤC TIÊU KỸ THUẬT TỔNG QUÁT
Xây dựng firmware cho vi điều khiển ESP32 áp dụng kiến trúc phân rã đa nhân (Dual-Core Isolation) để điều khiển nhà trồng nấm rơm indoor. Hệ thống tự động bám sát quỹ đạo sinh trưởng (Nhiệt độ, Độ ẩm, CO2) kéo dài 20 ngày. Cốt lõi kỹ thuật bao gồm giải thuật mờ thuần toán học (Fuzzy Math), bộ trộn phân rã điều khiển CO2 (Decoupled Arbitrator), tự học thích nghi (Adaptive Tuning) để bù đắp nhiễu thời tiết khắc nghiệt tại khu vực An Giang, và giao thức viễn đo đạc nén dữ liệu MQTT Delta mã hóa Base64.

## 2. TECHSTACK CỐT LÕI
- **Ngôn ngữ:** C/C++ (Tiêu chuẩn C++11 trở lên).
- **Nền tảng / OS:** Arduino Core cho ESP32, FreeRTOS (xTaskCreatePinnedToCore).
- **Thư viện bên thứ 3:**
  - `PubSubClient` (Xử lý giao thức MQTT).
  - `ArduinoJson` (v6/v7) (Trích xuất và đóng gói dữ liệu Delta JSON).
  - `mbedtls/base64.h` (Thư viện C native của ESP32 để mã hóa payload).
  - `WebServer`, `WiFi` (Quản lý SoftAP + Station).
- **Hardware:** ESP32, SSR Relays, Cảm biến SHT30 (I2C), Cảm biến SCD30 (I2C).
- **⚠️ Lưu ý phần cứng:** Hệ thống hiện chỉ điều khiển relay **ON/OFF** (SSR Relays). **Không dùng PWM**, không băm xung thời gian (TPC), không duty cycle tỉ lệ. Mọi output fuzzy được ánh xạ nhị phân: `0.0` = OFF, `1.0` = ON qua `digitalWrite()`.

## 3. QUY TẮC VIẾT CODE TOÀN CỤC (CODING CONVENTIONS)
- **Kiến trúc:** Phân tách rõ ràng giữa tầng thuật toán (Fuzzy/Math) và tầng phần cứng (GPIO/I2C). Các mô-đun thuật toán không được chứa hàm delay() hay gọi trực tiếp thư viện phần cứng.
- **Biến toàn cục (Shared States):** Mọi biến chia sẻ giữa Core 0 và Core 1 bắt buộc phải sử dụng từ khóa `volatile` và áp dụng cơ chế khóa an toàn (Mutex/Spinlock) nếu dữ liệu có kích thước lớn hơn 32-bit để tránh Data Race.
- **Quy tắc đặt tên:** - Class/Struct: `PascalCase` (VD: `FuzzyMathEngine`).
  - Hàm/Phương thức: `camelCase` (VD: `updateAdaptiveTuning`).
  - Hằng số/Macro: `UPPER_SNAKE_CASE` (VD: `TPC_WINDOW_MS`).
  - Biến toàn cục chia sẻ đa nhân: Bắt buộc có tiền tố `shared_` (VD: `shared_roomTemp`).
- **Non-blocking:** Tuyệt đối không dùng hàm `delay()`. Mọi bộ định thời phải sử dụng hàm so sánh `millis()` (cho Core 0) hoặc `vTaskDelay()` (cho cấu trúc luồng của FreeRTOS ở Core 1).