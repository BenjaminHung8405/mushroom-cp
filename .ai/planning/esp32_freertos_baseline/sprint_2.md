# SPRINT 2: Vùng chờ Ngoại vi & Luồng Điều khiển (Core 1)

## 1. PHẠM VI & MỤC TIÊU
Xây dựng lớp phần cứng ảo (Mock Hardware Layer). Khởi tạo Task đọc cảm biến định kỳ và Task xuất lệnh điều khiển trên Core 1. Đảm bảo Core 1 hoạt động độc lập, in log ra Terminal chính xác mà không bị ảnh hưởng bởi tình trạng mạng của Core 0.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
[ESP32 Boot] -> Khởi tạo Task Core 1 -> [Vòng lặp Timer 5 phút ảo].
Luồng Thu thập: Gọi hàm đọc Cảm biến (Mock) -> Trả về float giả lập -> Đóng gói vào Struct -> Gửi qua Queue (chuẩn bị cho module Telemetry sau này).
Luồng Điều khiển: Nhận lệnh từ Queue -> Gọi hàm kích Rơ-le (Mock) -> In trạng thái High/Low ra Serial Monitor.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Tầng Dữ liệu Cấu trúc (Models)
* Tạo mới file: `include/models.h`
* Hàm/Khai báo cần xử lý:
  - Khởi tạo struct `TelemetryData` (chứa `temp_substrate`, `humidity_air`, `co2_level`).
  - Khởi tạo struct `ActuatorCommand` (chứa `relay_id`, `state`).

### TRACK 2: Tầng Giao tiếp Cảm biến (Sensors Mock)
* Tạo mới file: `src/hardware/sensors.cpp` và `include/sensors.h`
* Hàm/Khai báo cần xử lý:
  - Hàm `init_sensors_placeholder()`: Khởi tạo các biến giả lập.
  - Hàm `read_Air_Humidity_SHT30()`: Trả về giá trị float tĩnh (ví dụ: 75.0).
  - Hàm `read_Substrate_Temp_DS18B20()`: Trả về giá trị float tĩnh (ví dụ: 30.5).
  - Hàm `read_CO2_SCD30()`: Trả về giá trị float tĩnh (ví dụ: 1000.0).

### TRACK 3: Tầng Giao tiếp Chấp hành (Actuators Mock)
* Tạo mới file: `src/hardware/actuators.cpp` và `include/actuators.h`
* Hàm/Khai báo cần xử lý:
  - Hàm `init_actuators_gpio()`: Cấu hình `pinMode` thành `OUTPUT` cho 4 chân GPIO định nghĩa trong `config.h`. Đặt trạng thái mặc định ban đầu là `LOW` (Tắt).
  - Hàm `set_Relay_State(uint8_t relay_pin, bool state)`: Hàm nhận ID chân và trạng thái. Viết lệnh `digitalWrite(relay_pin, state)` và kèm lệnh `printf` log ra Console rõ ràng (VD: "[ACTUATOR] Pin 12 set to HIGH").

### TRACK 4: Tầng Điều phối (Core 1 Task)
* Sửa đổi file: `src/main.cpp`
* Hàm/Khai báo cần xử lý:
  - Hàm `task_core1_control(void *pvParameters)`: Vòng lặp xử lý định kỳ gọi các hàm `read_*` từ `sensors.cpp`. Sau đó gọi thử nghiệm `set_Relay_State` đảo trạng thái luân phiên để test console.
  - Hàm `setup()`: Gọi `xTaskCreatePinnedToCore` để ghim `task_core1_control` vào Core 1.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. Các GPIO khai báo trong `init_actuators_gpio` phải được kiểm tra (assert) không trùng lặp với các chân dùng cho Flash nội bộ hoặc strapping pins của ESP32-S3 (tránh bootloop).
2. Tác vụ trên Core 1 phải chạy ở mức ưu tiên (Priority) cao hơn hoặc bằng Core 0 để đảm bảo việc đọc cảm biến và đóng ngắt rơ-le không bị gián đoạn khi mạng chập chờn.
3. Không thực hiện cấp phát động bộ nhớ (malloc/new) bên trong vòng lặp vô tận của `task_core1_control` để tránh phân mảnh RAM (Memory Fragmentation).