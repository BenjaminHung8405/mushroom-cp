# WALKTHROUGH_LOG.md

## [2026-07-10T11:01:51+07:00] - Task F2: Viết các hàm giả lập đọc SHT30, DS18B20 và SCD30
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [sensors.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/sensors.h)
  - Sửa đổi: [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/sensors.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Giả lập dữ liệu động**:
    - Sử dụng hàm lượng giác `std::sin` và `std::cos` kết hợp thời gian hệ thống qua `millis()` để mô phỏng các giá trị cảm biến thay đổi liên tục theo thời gian thực (nhiệt độ không khí SHT30: `[23.0, 27.0]°C`, độ ẩm không khí SHT30: `[75.0, 85.0]%`, nhiệt độ cơ chất DS18B20: `[20.5, 23.5]°C`, nồng độ CO2 SCD30: `[450.0, 750.0] ppm`).
  - **Quản lý lỗi & An toàn phần cứng**:
    - Định nghĩa enum `SensorError` chứa chi tiết các trạng thái lỗi cảm biến: `SUCCESS`, `ERR_NOT_INITIALIZED`, `ERR_TIMEOUT`, `ERR_CRC_MISMATCH`, `ERR_DISCONNECTED`, `ERR_OUT_OF_RANGE`.
    - Hỗ trợ cơ chế Fault Injection qua các hàm `set_simulated_health_*`. Khi cờ health của một cảm biến chuyển sang `false`, hàm đọc tương ứng sẽ trả về `false`, ghi nhận lỗi `ERR_DISCONNECTED` và đặt dữ liệu ngõ ra thành `NAN`.
    - Thêm cơ chế kiểm tra dải đo an toàn vật lý. Nếu dữ liệu vượt qua ngưỡng vật lý giới hạn của cảm biến thật, hàm đọc sẽ gán lỗi `ERR_OUT_OF_RANGE` và trả về `false` kèm giá trị `NAN`.
    - Hàm `read_all_telemetry` sẽ trả về `false` và gán giá trị `NAN` cho trường tương ứng của cảm biến bị lỗi để luồng logic phía trên có thể nhận biết được sự cố chập mạch/hỏng cảm biến.
  - **Tự kiểm tra (Self-test)**:
    - Bổ sung Test Case 16 vào file kiểm thử `test/run_tests.cpp` để xác thực toàn bộ các trường hợp: lỗi khi chưa khởi tạo, đọc giá trị giả lập biến động chính xác, giả lập lỗi và trả về `NAN` cho từng cảm biến đơn lẻ cũng như tích hợp qua `read_all_telemetry`.
    - Biên dịch và chạy bộ kiểm thử offline `run_tests` thành công 100% không lỗi.

## [2026-07-10T11:00:35+07:00] - Task F1: Tạo `sensors.h` và `sensors.cpp` với hàm `init_sensors_placeholder()`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [sensors.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/sensors.h)
  - Sửa đổi: [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/sensors.cpp)
- **Giải trình giải pháp**:
  - **Thiết kế giao diện phần cứng HAL cho Sensors**:
    - Định nghĩa các interface đọc cảm biến trong namespace `sensors` độc lập hoàn toàn với hàm main: `init_sensors_placeholder()`, `read_sht30()`, `read_ds18b20()`, `read_scd30()`, và `read_all_telemetry()`.
    - Trả về kiểu dữ liệu boolean thể hiện trạng thái thành công/thất bại của quá trình đọc cảm biến để phục vụ việc xử lý ngoại lệ và lỗi cảm biến thật ở các bước tiếp theo.
  - **Triển khai Placeholder & Trạng thái khởi tạo**:
    - Hàm `init_sensors_placeholder()` quản lý biến trạng thái khởi tạo `sensors_initialized`, ghi nhận và in log thông báo chi tiết ra cổng Serial.
    - Cài đặt placeholder trả về giá trị mặc định cho các hàm đọc cụ thể (`temp = 25.0f`, `hum = 60.0f` đối với SHT30, `temp = 28.0f` đối với DS18B20, và `co2 = 800.0f` đối với SCD30), đồng thời gán dữ liệu `NAN` và ghi log báo lỗi nếu cố tình đọc trước khi gọi khởi tạo.
  - **Tự kiểm tra & Biên dịch**:
    - Tiến hành biên dịch dự án firmware ESP32-S3 sử dụng PlatformIO trong môi trường local. Quá trình biên dịch hoàn tất thành công 100% không có cảnh báo hay lỗi biên dịch nào.

## [2026-07-10T10:59:00+07:00] - Task E2: Khởi tạo struct `TelemetryData` và `ActuatorCommand`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Kiểm chứng các mô hình dữ liệu (Models)**:
    - Rà soát cấu trúc `TelemetryData` (chứa `temp_substrate`, `humidity_air`, `co2_level`) và `ActuatorCommand` (chứa `relay_id`, `state`, kèm theo 2 bytes padding) trong [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h).
    - Cả hai đều được thiết kế là Plain Old Data (POD) và áp dụng cấu trúc alignment 4 bytes (`__attribute__((aligned(4)))`) để tối ưu việc copy dữ liệu qua FreeRTOS Queue giữa Core 0 và Core 1 trên ESP32 mà không bị phân mảnh hoặc lỗi offset alignment.
  - **Cập nhật Unit Test & Thử nghiệm**:
    - Sửa đổi log thông báo trong bộ kiểm thử `test/run_tests.cpp` để phản ánh đúng việc kiểm thử cho cả Task E1 và Task E2.
    - Thực hiện build lại chương trình kiểm thử offline trên máy host và chạy thành công vượt qua 100% assertions, xác nhận kích thước của `TelemetryData` là 12 bytes và `ActuatorCommand` là 4 bytes.

## [2026-07-10T10:57:00+07:00] - Task E1: Tạo file `include/models.h` định nghĩa các Data Structures
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Tạo cấu trúc dữ liệu mô hình (Models)**:
    - Định nghĩa cấu trúc `TelemetryData` (chứa `temp_substrate`, `humidity_air`, `co2_level`).
    - Định nghĩa cấu trúc `ActuatorCommand` (chứa `relay_id`, `state`, kèm theo 2 bytes padding tường minh để tối ưu hóa memory alignment 32-bit MCU).
    - Cả hai cấu trúc đều được định nghĩa là Plain Old Data (POD) và được tối ưu hóa alignment 4 bytes (`__attribute__((aligned(4)))`) để truyền tải hiệu quả qua FreeRTOS Queue mà không bị lỗi padding hoặc hiệu năng copy giữa các Core.
  - **Bổ sung Unit Test**:
    - Thêm test case 15 vào bộ kiểm thử offline `test/run_tests.cpp` để kiểm nghiệm thuộc tính `is_pod` của `TelemetryData` và `ActuatorCommand`, cũng như kiểm tra kích thước bộ nhớ (`sizeof`) và độ căn chỉnh (`alignof`) chính xác 4-byte.
    - Biên dịch và chạy bộ kiểm thử thành công vượt qua 100% không lỗi.

## [2026-07-10T10:53:50+07:00] - Sprint 1 QA Review & Code Approval
- **Trạng thái**: LGTM (Looks Good To Me) - Approved
- **Danh sách file kiểm duyệt**:
  - [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
  - [config.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/config.cpp)
  - [wifi_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/wifi_manager.h)
  - [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
- **Đánh giá chi tiết**:
  - **Kiến trúc & Conventions**: Tuân thủ đúng mô hình phân tách Clean Architecture. Không vi phạm DRY (SoftAP SSID/PASS đã được dọn dẹp tập trung tại `config.h`, MqttClient ID sử dụng hàm helper dùng chung). Không có hàm nào dài quá 50 dòng (hàm parsing và reconnect đã được phân rã kỹ càng).
  - **Bảo mật**: Không có credentials/SSID/Broker bị hardcode trong source code (hoàn toàn lấy từ NVS dynamic). Input payload MQTT JSON đã được validate chống overflow (MAX_PAYLOAD_SIZE = 512 bytes), ép kiểu float, kiểm tra boundary vật lý nghiêm ngặt (Nhiệt độ `[10.0, 45.0]`, Độ ẩm `[30.0, 95.0]`), chống NaN.
  - **Logic & Edge-Cases**: Error handling chặt chẽ (kiểm tra Null Pointer cho MQTT topic/payload đầu callback, ngắt kết nối MQTT khi WiFi mất). Xử lý chống Watchdog tốt (delay 100ms trong Core 0 Task).
  - **Tối ưu hóa**: Không có vòng lặp lồng nhau vô tội vạ hoặc query database/đọc NVS liên tục trong loop (SSID/PASS và MQTT config được nạp vào RAM cache 1 lần duy nhất tại hàm `setup()`).
- **Kết luận**: Đạt yêu cầu 100% chất lượng kiểm soát. Chuyển trạng thái toàn bộ các task của Sprint 1 sang `[x] Done`.

## [2026-07-10T10:50:50+07:00] - Task A2, B1, C3: Sửa lỗi DRY và tái cấu trúc MqttClient theo feedback của QA
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Danh sách file thay đổi**:
  - Sửa đổi: [wifi_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/wifi_manager.h)
  - Sửa đổi: [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - Sửa đổi: [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
- **Giải trình giải pháp**:
  - **Khắc phục vi phạm DRY**: Xóa bỏ hoàn toàn định nghĩa các hằng số SoftAP cứu hộ `AP_SSID` và `AP_PASS` trong `wifi_manager.h`. Mọi module khác cần sử dụng SoftAP cứu hộ sẽ tham chiếu đến `config::network::AP_SSID` và `config::network::AP_PASS` tập trung ở `config.h`.
  - **Khắc phục lỗi độ dài hàm**: Tách logic kiểm tra ranh giới và xác thực giá trị float trong `MqttClient::process_setpoints` thành hàm private helper `validate_single_setpoint` trong lớp `MqttClient`. Hàm `process_setpoints` được rút gọn đáng kể (dưới 25 dòng), đảm bảo tuân thủ giới hạn 50 dòng theo quy tắc kiến trúc.
  - **Kiểm thử**: Biên dịch và chạy bộ kiểm thử offline `run_tests` thành công 100%.

## [2026-07-10T10:45:00+07:00] - Sprint 1 Fixes: Sửa lỗi bảo mật, logic, và tái cấu trúc mã nguồn theo yêu cầu của Chuyên gia Kiểm toán (Round 2)
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Danh sách file thay đổi**:
  - Sửa đổi: [config.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/config.cpp)
  - Sửa đổi: [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - Sửa đổi: [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - Sửa đổi: [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Khắc phục lỗi bảo mật hardcode**: Loại bỏ hoàn toàn tài khoản MQTT broker mặc định trong `src/config.cpp`. Khi NVS không chứa cấu hình, biến `MQTT_BROKER_VAL` sẽ để trống, cổng port 0, dẫn tới việc `MqttClient::init()` đánh dấu trạng thái `MqttState::ERROR_NO_CONFIG`.
  - **Ngăn chặn SSID rỗng khi tái kết nối**: Bổ sung kiểm tra SSID hợp lệ (độ dài > 0) trong `reconnect_wifi()` của `src/wifi_manager.cpp`.
  - **Tái cấu trúc code (SRP & DRY)**:
    - Thêm hàm helper `get_effective_client_id()` để dùng chung và giải quyết lặp code (DRY).
    - Phân tách hàm `handle_message()`, `reconnect_mqtt()`, và `loop()` thành các hàm helper nhỏ hơn (`process_setpoints`, `check_wifi_for_mqtt`, `maintain_mqtt_connection`, `perform_mqtt_connection`) nhằm đảm bảo SRP và giới hạn độ dài hàm dưới 50 dòng.
  - **Bảo mật và an toàn dữ liệu setpoint (Physical Safety Boundaries)**:
    - Bổ sung kiểm tra Null Pointer cho `topic` và `payload` ở đầu callback.
    - Giới hạn ranh giới vật lý: Nhiệt độ setpoint phải thuộc đoạn `[10.0, 45.0]`°C và độ ẩm setpoint phải thuộc đoạn `[30.0, 95.0]`%.
    - Tăng dung lượng `StaticJsonDocument` của ArduinoJson lên 768 bytes tránh lỗi phân tách `NoMemory`.
  - **Cập nhật Unit Test**: Bổ sung các kịch bản kiểm thử (Case F, G, H) cho Null topic/payload, giá trị ngoài ranh giới và NaN. Tất cả các test cases biên dịch và vượt qua 100% thành công.

## [2026-07-10T10:36:00+07:00] - Task D2: Cập nhật hàm `setup()` trong `main.cpp` để ghim Task vào Core 0
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Triển khai setup() & loop() trong main.cpp**: Hoàn thiện hàm `setup()` thực hiện khởi tạo kết nối Serial baudrate 115200, khởi tạo quản lý bộ nhớ `StorageManager` (NVS), nạp cấu hình dynamic `load_runtime_config()`, và thực hiện tạo và ghim tác vụ truyền thông `task_core0_communication` vào Core 0 thông qua `xTaskCreatePinnedToCore` với dung lượng stack 4096 bytes và độ ưu tiên priority 1.
  - **Cập nhật Mock & Môi trường Unit Test**:
    - Bổ sung mock cho `delay` và `Serial.begin` vào `test/Arduino.h`.
    - Cập nhật test case số 14 trong `test/run_tests.cpp` để gọi `setup()` và `loop()` trong môi trường giả lập.
    - Biên dịch và chạy thử nghiệm cục bộ thành công với kết quả 14/14 test cases đều đạt 100%.

## [2026-07-10T10:34:00+07:00] - Task D1: Cài đặt `task_core0_communication()` chạy vòng lặp vô tận kiểm tra mạng & MQTT
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - Sửa đổi: [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Triển khai Task Core 0 điều phối truyền thông**: Cài đặt hàm `task_core0_communication()` chạy vòng lặp vô hạn điều khiển mạng WiFi và duy trì MQTT. Tác vụ này thực hiện gọi `wifi::init_wifi()` và `mqtt::MqttClient::get_instance().init()` khi khởi tạo, sau đó chạy vòng lặp cập nhật kết nối mạng qua `wifi::check_wifi_connection()` và `MqttClient::loop()`.
  - **Chống tràn Watchdog & An toàn luồng**: Đảm bảo an toàn WDT bằng cách sử dụng `vTaskDelay(pdMS_TO_TICKS(100))` để nhả CPU ở mỗi chu kỳ lặp. Đo đạc và in Stack High Water Mark của tác vụ định kỳ mỗi 5 giây (`uxTaskGetStackHighWaterMark(nullptr)`) phục vụ việc tối ưu hóa dung lượng stack thực tế khi ghim tác vụ trên ESP32.
  - **Khả năng tự kiểm thử (Self-test)**: Tích hợp cấu trúc macro `#ifndef UNIT_TEST` bao bọc các lời gọi FreeRTOS. Giới hạn vòng lặp chạy đúng 1 lần trong môi trường UNIT_TEST để tránh treo bộ kiểm thử. Cập nhật file mock `test/Arduino.h` và bổ sung test case số 13 trong `test/run_tests.cpp`. Toàn bộ bộ test offline đã chạy và đạt kết quả đúng 100%.

## [2026-07-10T10:32:00+07:00] - Task C3: Cài đặt `mqtt_callback()` và logic xử lý payload JSON
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Giới hạn kích thước Payload tối đa**: Thiết lập ngưỡng chặn kích thước Payload tối đa 512 bytes (`MAX_PAYLOAD_SIZE = 512`) nhằm chống tràn bộ nhớ đệm (Buffer Overflow) và tấn công DoS qua gói tin MQTT quá dung lượng.
  - **Không phân mảnh RAM (Heap Segmentation Avoidance)**: Triển khai vùng đệm an toàn trên stack (`char safe_payload[513]`) cho việc in chuỗi và parsing mà không cần cấp phát động bộ nhớ (heap). Sử dụng thư viện `StaticJsonDocument` của `ArduinoJson` phiên bản 6 (dung lượng cố định 512 bytes) để đảm bảo không phân mảnh vùng nhớ heap của ESP32.
  - **Trích xuất Setpoints linh hoạt**: Hỗ trợ bóc tách linh hoạt các tham số điều khiển Setpoint từ backend, bao gồm cả hai định dạng key `"temperatureSetpoint"` / `"temperature"` và `"humiditySetpoint"` / `"humidity"`. Có log cảnh báo khi JSON không chứa các trường setpoint hợp lệ hoặc phân tích cú pháp (Deserialization) thất bại.
  - **Kiểm soát & Phân lọc Topic**: Kiểm tra tính chính xác của MQTT Topic nhận được, chỉ xử lý gói tin có topic khớp hoàn toàn với `resolved_topics.setpoint` đã đăng ký.
  - **Cập nhật Mock & Tự kiểm thử (Self-test)**: Bổ sung lưu trữ callback pointer trong lớp mock `PubSubClient` và mở rộng 5 kịch bản kiểm thử toàn diện tại `test/run_tests.cpp`. Toàn bộ bộ test offline đã chạy và vượt qua 100% thành công trên môi trường macOS host.

## [2026-07-10T10:27:07+07:00] - Task C2: Cài đặt `init_mqtt()` và `mqtt_reconnect()`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - Sửa đổi: [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
- **Giải trình giải pháp**:
  - **Triển khai logic kết nối lại không đồng bộ (Non-blocking reconnect)**: Cài đặt biến `last_reconnect_attempt` kết hợp với hằng số trễ 5 giây để kiểm soát tần suất kết nối lại MQTT, tránh spam socket gây block CPU luồng chính của Core 0 và nguy cơ sập WDT.
  - **Ràng buộc an toàn mạng (Network State Safeguard)**: Tích hợp kiểm tra trạng thái WiFi trước khi reconnect. Nếu trạng thái WiFi không phải `STA_CONNECTED` (ví dụ đang ở chế độ cấu hình không dây SoftAP/Captive Portal hoặc đang trong quá trình scan/connecting), ngắt kết nối MQTT client ngay lập tức và chặn tuyệt đối việc gọi hàm `reconnect_mqtt()`.
  - **Cơ chế khóa đa luồng (Mutex Locking)**: Khai báo và tích hợp FreeRTOS Mutex (`xSemaphoreCreateMutex()`) cho ESP32 trong môi trường thực tế khi gọi hàm `reconnect_mqtt()`, đảm bảo an toàn truy cập tài nguyên, chống race condition nếu luồng mạng/nhận lệnh từ Core khác gọi đồng thời. Sử dụng wrapper tiền xử lý `#ifndef UNIT_TEST` để đảm bảo tương thích biên dịch offline hoàn hảo.
  - **Kết quả tự kiểm thử (Self-test)**: Chạy thành công bộ unit tests offline bằng trình biên dịch g++/clang++ cục bộ. Logic chuyển đổi trạng thái khi ngắt kết nối WiFi và tự động kết nối lại sau khoảng trễ 5s hoạt động hoàn hảo và vượt qua 100% các assertions hiện có.

## [2026-07-10T10:26:00+07:00] - Task C1: Tạo khung file `mqtt_client.h` và `mqtt_client.cpp`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - Tạo mới: [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Thiết kế cấu trúc lớp MQTT Client**: Tạo lớp Singleton `MqttClient` quản lý trạng thái, vòng lặp mạng và callback.
  - **Phân nhóm Topic rõ ràng**: Gom nhóm các topic publish và subscribe vào struct `MqttTopics`. Định nghĩa cơ chế phân giải các topic động theo Client ID khi khởi tạo:
    - Status (LWT): `mushroom/device/{clientId}/status`
    - Telemetry (Publish): `mushroom/device/{clientId}/telemetry`
    - Setpoint (Subscribe): `mushroom/device/{clientId}/setpoint`
  - **Xây dựng khung logic kết nối và Last Will**: Cài đặt kết nối với Last Will and Testament cấu hình sẵn (`status` offline, QoS 1, Retain true), tự động đăng ký topic setpoint và publish trạng thái online khi kết nối thành công.
  - **Tương thích Mock Test**: Bổ sung mock cho `WiFiClient` và `PubSubClient` (bao gồm static field `mock_connected` để kiểm soát trạng thái kết nối ảo) trong `test/Arduino.h`, giúp chạy kiểm thử offline mượt mà không cần các preprocessor guards phức tạp.
  - **Tự kiểm duyệt (Self-test)**: Thêm bộ kiểm thử toàn diện (Test Case 12) vào `test/run_tests.cpp` bao quát quá trình khởi tạo lỗi khi thiếu config, khởi tạo thành công phân giải topic chính xác, xử lý lỗi mất WiFi (`ERROR_NO_WIFI`), và logic kết nối lại, gửi bản tin telemetry và status khi có mạng trở lại. Vượt qua 100% các bài test offline thành công.

## [2026-07-10T10:23:00+07:00] - Task B2: Cài đặt logic `init_wifi()` và `check_wifi_connection()`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Triển khai máy trạng thái WiFi Manager**: Cài đặt logic xử lý trạng thái WiFi non-blocking hoạt động qua 5 trạng thái (`IDLE`, `STA_CONNECTING`, `STA_CONNECTED`, `STA_DISCONNECTED`, `SOFTAP_ACTIVE`).
  - **Hàm `init_wifi()`**: Tuân thủ tuyệt đối quy định thiết kế, bắt buộc gọi nạp cấu hình dynamic từ NVS trước. Nếu NVS chưa được cấu hình, hệ thống sẽ rơi về `SOFTAP_ACTIVE` mà không thực hiện bất kỳ hardcode kết nối WiFi nào. Nếu có cấu hình, khởi chạy `WiFi.begin()` và chuyển sang `STA_CONNECTING`.
  - **Hàm `check_wifi_connection()` & `reconnect_wifi()`**:
    - Khi ở `STA_CONNECTING`: Theo dõi trạng thái kết nối. Nếu thành công (`WL_CONNECTED`), chuyển sang `STA_CONNECTED` và ghi nhận IP. Nếu quá thời gian chờ (15 giây), ngắt kết nối, chuyển sang `STA_DISCONNECTED` và đặt mốc thời gian chờ kết nối lại.
    - Khi ở `STA_CONNECTED`: Nếu mất kết nối, chuyển trạng thái sang `STA_DISCONNECTED`.
    - Khi ở `STA_DISCONNECTED`: Thực hiện kiểm tra định kỳ (mỗi 10 giây) một cách non-blocking và tự động kết nối lại qua hàm `reconnect_wifi()`.
  - **Tự kiểm duyệt (Self-test)**:
    - Bổ sung mock cho lớp `WiFiClass`, `wl_status_t`, `wifi_mode_t`, `IPAddress` và cơ chế cộng dồn thời gian ảo `mock_millis_offset` vào `test/Arduino.h` và `test/run_tests.cpp` để giả lập quá trình trôi đi của thời gian.
    - Phát triển bộ 8 testcase kiểm nghiệm toàn diện luồng chuyển trạng thái: Từ khởi tạo rỗng (SoftAP), kết nối thành công (STA_CONNECTED), mất kết nối (STA_DISCONNECTED), tự kết nối lại thành công, và timeout kết nối (quá 15s tự ngắt và chuyển về DISCONNECTED).
    - Biên dịch và vượt qua 100% các bài kiểm tra offline thành công trên macOS.

## [2026-07-10T10:21:00+07:00] - Task B1: Tạo khung file `wifi_manager.h` và `wifi_manager.cpp`
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [wifi_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/wifi_manager.h)
  - Tạo mới: [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp**:
  - **Tạo khung cho WiFi Manager**: Khai báo và cấu trúc hóa module `wifi` dưới dạng namespace để tránh xung đột tên. Dựng sẵn khung các hàm giao tiếp mạng non-blocking bao gồm `init_wifi()`, `check_wifi_connection()`, `reconnect_wifi()`, và `get_wifi_state()`.
  - **Khởi tạo thông tin WiFi SoftAP dự phòng**: Khai báo các hằng số tĩnh dạng `constexpr` cho `AP_SSID` và `AP_PASS` dùng làm mạng phát sóng phục vụ cơ chế Captive Portal cứu hộ cấu hình.
  - **Tương thích môi trường Test**: Sử dụng chỉ thị tiền xử lý `#ifndef UNIT_TEST` bao bọc lấy `#include <WiFi.h>` để cho phép mã nguồn WiFi Manager biên dịch độc lập offline trên máy chủ host mà không cần thư viện phần cứng ESP32.
  - **Tự kiểm duyệt (Self-test)**: Bổ sung Test Case 11 trong `test/run_tests.cpp` để kiểm nghiệm logic chuyển trạng thái của `init_wifi()`. Khi NVS rỗng, trạng thái chuyển về `SOFTAP_ACTIVE`. Khi NVS có cấu hình hợp lệ, chuyển sang `STA_CONNECTING`. Biên dịch và vượt qua toàn bộ kiểm thử thành công trên macOS host.

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
