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
- **Hardware:** ESP32-S3 WROOM N16R8, SSR Relays, Cảm biến SHT30 (I2C), Cảm biến SCD30 (I2C).
- **⚠️ Lưu ý phần cứng:** Hệ thống dùng SSR với **TPC (Time-Proportional Control)**. Output fuzzy là duty demand `[0.0, 1.0]`, được TPC Task chuyển thành các pha ON/OFF trong cửa sổ thời gian bằng `digitalWrite()`. Không dùng `analogWrite()`, `ledcWrite()` hoặc PWM tần số cao; phải áp dụng cửa sổ TPC và thời gian ON/OFF tối thiểu theo từng thiết bị.

## 2.1 QUYẾT ĐỊNH KỸ THUẬT PHASE 1 — SSR, TPC VÀ BLACKOUT
- **Giữ kiến trúc TPC:** Không chuyển sang Macro Interval Control hay PWM. TPC vẫn là tầng duy nhất chuyển duty demand sang GPIO; chỉ tinh chỉnh thời lượng cửa sổ, minimum ON/OFF và tần suất tính fuzzy.
- **SSR AC:** MVP dùng SSR AC **zero-crossing** cho cả bốn kênh. Không dùng random-fire SSR cho tải AC này. Chuyển nguồn/vỉ siêu âm sang điều khiển DC bằng MOSFET là hạng mục phần cứng hậu MVP, không phải điều kiện triển khai Phase 1.
- **TPC target ban đầu:** HAir/HWat: window 300 s, min ON 10 s, min OFF 10 s; Mist: window 300 s, min ON 5 s, min OFF 10 s; Exhaust: window 120 s, min ON/OFF 3 s. Các giá trị phải được xác nhận bằng log vận hành và thông số thiết bị thực tế trước khi xem là production-final.
- **Giảm tải tính toán nhưng không giảm tick scheduler:** Core 1 vẫn tick TPC mỗi 50 ms để thực thi lịch chính xác; fuzzy/arbitration/adaptive tuning chỉ được cập nhật theo chu kỳ 5 s. `dtSeconds` truyền vào `AdaptiveTuner::updateGains()` phải là elapsed time thực tế, không hard-code.
- **Chống inrush đồng thời:** Trong cùng cửa sổ TPC, các kênh công suất lớn phải có startup offset: HAir 0 s, HWat +3 s, Mist +8 s; Exhaust không cần offset. Offset là thuộc tính cấu hình scheduler và không được kéo dài ON vượt giới hạn cửa sổ.
- **Blackout là interlock bắt buộc:** Core 0 đồng bộ giờ qua NTP sau khi WiFi Station kết nối; Core 1 đọc giờ hệ thống để cung cấp `RtcTimePod`. Chưa đồng bộ/mất hiệu lực thời gian => `valid=false` và `hardwareProtectionOverride()` vẫn ép HWat/Mist OFF.

## 3. QUY TẮC VIẾT CODE TOÀN CỤC (CODING CONVENTIONS)
- **Kiến trúc:** Phân tách rõ ràng giữa tầng thuật toán (Fuzzy/Math) và tầng phần cứng (GPIO/I2C). Các mô-đun thuật toán không được chứa hàm delay() hay gọi trực tiếp thư viện phần cứng.
- **Biến toàn cục (Shared States):** Mọi biến chia sẻ giữa Core 0 và Core 1 bắt buộc phải sử dụng từ khóa `volatile` và áp dụng cơ chế khóa an toàn (Mutex/Spinlock) nếu dữ liệu có kích thước lớn hơn 32-bit để tránh Data Race.
- **Quy tắc đặt tên:** - Class/Struct: `PascalCase` (VD: `FuzzyMathEngine`).
  - Hàm/Phương thức: `camelCase` (VD: `updateAdaptiveTuning`).
  - Hằng số/Macro: `UPPER_SNAKE_CASE` (VD: `TPC_WINDOW_MS`).
  - Biến toàn cục chia sẻ đa nhân: Bắt buộc có tiền tố `shared_` (VD: `shared_roomTemp`).
- **Non-blocking:** Tuyệt đối không dùng hàm `delay()`. Mọi bộ định thời phải sử dụng hàm so sánh `millis()` (cho Core 0) hoặc `vTaskDelay()` (cho cấu trúc luồng của FreeRTOS ở Core 1).