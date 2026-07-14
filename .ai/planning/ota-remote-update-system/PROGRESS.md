# Tiến Độ Triển Khai Hệ Thống Cập Nhật Từ Xa (OTA Remote Update System)

## Started
- **Thời gian khởi tạo:** 2026-07-14T12:44:37+07:00
- **Execution Agent:** Gemini

## Reference Plan
- **Thư mục kế hoạch:** `.ai/planning/ota-remote-update-system/`
- **Các file tham chiếu:**
  - [README.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/ota-remote-update-system/README.md)
  - [sprint_1.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/ota-remote-update-system/sprint_1.md)
  - [sprint_2.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/ota-remote-update-system/sprint_2.md)
  - [sprint_3.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/ota-remote-update-system/sprint_3.md)

## Addition Plan
- **Yêu cầu phát sinh:** Chưa có (Mặc định)

---

## Các Track Triển Khai

### Track A: Tầng Cấu Hình & Khai Báo (Configuration & Declarations)

| Task ID | Mô tả Task | Status | Chỉ thị kỹ thuật & Lưu ý của Kỹ sư trưởng |
| :--- | :--- | :--- | :--- |
| A1 | Bổ sung MQTT buffer flag `-DMQTT_MAX_PACKET_SIZE=2048` vào `[env:base]` | `[ ] QA Review` | **[Sprint 1]** Cấu hình trực tiếp trong `platformio.ini`. Bắt buộc phải đặt trong section `[env:base]` để áp dụng cho cả hai môi trường hardware `env:otg` và `env:uart`. Không xóa/sửa các flag cũ, bảo đảm buffer nhận gói tin OTA payload lớn từ MQTT Broker. |
| A2 | Khai báo extern `TaskHandle_t` cho `hTaskCore1Control` và `hTaskHWButton` | `[ ] QA Review` | **[Sprint 1]** Khai báo trong `mushroom-iot-firmware/include/definitions.h`. Bắt buộc bọc trong block `#ifndef UNIT_TEST ... #endif`. Không được include trực tiếp `<freertos/task.h>` ở phạm vi toàn cục để tránh lỗi biên dịch trên môi trường Native Test. |
| A3 | Định nghĩa `TaskHandle_t` ở file scope trong `main.cpp` | `[ ] QA Review` | **[Sprint 1]** Định nghĩa các biến toàn cục và khởi tạo mặc định về `nullptr` trong `mushroom-iot-firmware/src/main.cpp`. Phải bọc trong block `#ifndef UNIT_TEST ... #endif`. |
| A4 | Tạo file header `ota_manager.h` khai báo public API | `[ ] QA Review` | **[Sprint 2]** Tạo mới `mushroom-iot-firmware/include/ota_manager.h` thuộc `namespace ota`. Sử dụng `#pragma once`. Chỉ chứa khai báo chữ ký hàm, cấm viết mã logic triển khai tại đây. Bọc các header Arduino trong block `#ifndef UNIT_TEST` để đảm bảo tương thích Native Unit Test. |
| A5 | Thêm include `ota_manager.h` vào `core0_tasks.cpp` | `[ ] Pending` | **[Sprint 3]** Include `ota_manager.h` để phục vụ gọi API kiểm tra trigger. Đảm bảo file header có guard đầy đủ và không kéo theo các module phụ thuộc phần cứng khi chạy unit test native. |

### Track B: Tầng Khởi Tạo & Quản Lý Task (Task Initialization & Watchdog)

| Task ID | Mô tả Task | Status | Chỉ thị kỹ thuật & Lưu ý của Kỹ sư trưởng |
| :--- | :--- | :--- | :--- |
| B1 | Gán Task Handle khi tạo `taskCore1Control` | `[ ] Pending` | **[Sprint 1]** Trong hàm `createCoreTasks()` của `main.cpp`, truyền địa chỉ `&hTaskCore1Control` vào tham số thứ 6 của hàm `xTaskCreatePinnedToCore` thay cho `nullptr`. Kiểm tra kết quả trả về của hàm tạo task trước khi sử dụng handle. |
| B2 | Gán Task Handle khi tạo `taskHardwareButton` | `[ ] Pending` | **[Sprint 1]** Tương tự B1, truyền địa chỉ `&hTaskHWButton` vào tham số thứ 6 của hàm `xTaskCreatePinnedToCore` trong `main.cpp`. |
| B3 | Thêm include `<esp_task_wdt.h>` vào `core0_tasks.cpp` | `[ ] Pending` | **[Sprint 1]** Import thư viện SDK Watchdog để quản lý WDT thủ công. Bắt buộc đặt trong block `#ifndef UNIT_TEST` để tránh lỗi build môi trường native. |
| B4 | Cấu hình WDT 8 giây và đăng ký task Core 0 | `[ ] Pending` | **[Sprint 1]** Gọi `esp_task_wdt_init(8, true)` và `esp_task_wdt_add(nullptr)` trước vòng lặp chính của `taskCore0Communication()`. **Chỉ gọi 1 lần duy nhất**, cấm đặt trong vòng lặp. Bọc toàn bộ trong `#ifndef UNIT_TEST`. |
| B5 | Feed WDT trong vòng lặp chính của Core 0 | `[ ] Pending` | **[Sprint 1]** Gọi `esp_task_wdt_reset()` tại bước yield (cuối loop). Tuyệt đối không chèn thêm bất kỳ delay hay block dài nào làm giảm tần suất feed, giữ nguyên latency của loop Core 0. Bọc trong `#ifndef UNIT_TEST`. |

### Track C: Tầng Hiện Thực OTA Manager (OTA Manager Module)

| Task ID | Mô tả Task | Status | Chỉ thị kỹ thuật & Lưu ý của Kỹ sư trưởng |
| :--- | :--- | :--- | :--- |
| C1 | Khai báo biến nội bộ và GPIO relay trong `ota_manager.cpp` | `[ ] Pending` | **[Sprint 2]** Định nghĩa các biến `otaMutex`, `ota_pending`, `shared_ota_url` bên trong anonymous namespace để đóng gói dữ liệu (Encapsulation). Khai báo mảng GPIO relay `{10, 11, 12, 13}` tĩnh, đối chiếu chính xác với `actuators.cpp` và file `HARDWARE_DEPLOYMENT.md`. |
| C2 | Hiện thực hàm `init()` để khởi tạo Mutex | `[ ] Pending` | **[Sprint 2]** Sử dụng `xSemaphoreCreateMutex()`. Phải kiểm tra chống trùng lặp khởi tạo (`otaMutex == nullptr`) và log lỗi rõ ràng qua `ScopedSerialLock` nếu thất bại. Bọc FreeRTOS API trong `#ifndef UNIT_TEST`. |
| C3 | Hiện thực hàm `request_ota_update()` lưu URL thread-safe | `[ ] Pending` | **[Sprint 2]** Gọi `xSemaphoreTake(otaMutex, pdMS_TO_TICKS(100))` để bảo vệ ghi dữ liệu URL. Timeout `100ms` để tránh block MQTT callback context. Tránh deadlock và giải phóng mutex ngay sau khi ghi. Hỗ trợ stub trực tiếp trong môi trường unit test (block `#else`). |
| C4 | Hiện thực hàm `check_ota_trigger()` đọc trạng thái trigger | `[ ] Pending` | **[Sprint 2]** Gọi `xSemaphoreTake(otaMutex, pdMS_TO_TICKS(10))` với timeout cực ngắn. Nếu lấy được, copy URL ra biến ngoài và **phải** reset `shared_ota_url = ""` nhằm giải phóng bộ nhớ String trên heap. Trả về true nếu phát hiện trigger và clear cờ. |
| C5 | Thực hiện `perform_ota_update()` - Bước 1 & 2: Status & Relay Safety | `[ ] Pending` | **[Sprint 2]** Gửi bản tin offline sạch sẽ lên MQTT Broker. Thực hiện ép cứng các chân GPIO relay về mức `LOW` (Default-Off) bằng lệnh `digitalWrite` trực tiếp để cách ly phần cứng an toàn, tránh phụ thuộc vào module `actuators` do các task Core 1 sắp bị suspend. |
| C6 | Thực hiện `perform_ota_update()` - Bước 3: Inter-Core Interlock | `[ ] Pending` | **[Sprint 2]** Gọi `vTaskSuspend(hTaskCore1Control)` và `vTaskSuspend(hTaskHWButton)` để dừng các task điều khiển và đọc nút trên Core 1. Việc này ngăn chặn triệt để Guru Meditation Error do xung đột truy cập Flash cache khi OTA ghi dữ liệu. Phải bọc trong `#ifndef UNIT_TEST`. |
| C7 | Thực hiện `perform_ota_update()` - Bước 4, 5 & 6: HTTPS Download & Reboot/Recovery | `[ ] Pending` | **[Sprint 2]** Dùng `WiFiClientSecure` gọi `setInsecure()` để bỏ qua bước verify SSL certificate. Đăng ký progress callback và gọi `esp_task_wdt_reset()` đầu tiên trong callback để nuôi watchdog. Nếu OTA thành công, chip tự reboot. Nếu thất bại hoặc không có cập nhật, **bắt buộc** gọi `vTaskResume()` cho cả hai task Core 1 để phục hồi hệ thống. |

### Track D: Tầng Tích Hợp Hệ Thống (Network & Integration)

| Task ID | Mô tả Task | Status | Chỉ thị kỹ thuật & Lưu ý của Kỹ sư trưởng |
| :--- | :--- | :--- | :--- |
| D1 | Gọi `ota::init()` trong `wifi::init_wifi()` | `[ ] Pending` | **[Sprint 3]** Khởi tạo Mutex ngay khi WiFi khởi động để sẵn sàng xử lý yêu cầu cập nhật từ MQTT Broker bất kỳ lúc nào. |
| D2 | Hạ `AUTH_HTTP_TIMEOUT_MS` xuống 3000ms trong `wifi_manager.cpp` | `[ ] Pending` | **[Sprint 3]** Giảm timeout của HTTP request xuống `3000ms` (từ `10000ms`) để đảm bảo không bị WDT reset (ngưỡng 8s) kích hoạt nếu mạng bị gián đoạn hoặc phản hồi chậm. |
| D3 | Hiện thực hàm `wifi::fetch_auth_token()` lấy JWT | `[ ] Pending` | **[Sprint 3]** Gửi HTTPS GET request đến auth endpoint, truyền kèm HTTP header `X-Device-Id`. Sử dụng `ArduinoJson` để parse an toàn, gán token vào `config::network::MQTT_PASSWORD_VAL`. Đảm bảo dọn dẹp tài nguyên http client sau khi xong. |
| D4 | Gọi `fetch_auth_token()` khi WiFi chuyển sang `STA_CONNECTED` | `[ ] Pending` | **[Sprint 3]** Đăng ký trigger ngay khi WiFi kết nối thành công để lấy JWT động. Bọc trong `#ifndef UNIT_TEST` để đảm bảo Native Unit Test không bị lỗi liên kết phần cứng. |
| D5 | Refactor handler lệnh `ota_update` thành dạng non-blocking (fire-and-forget) | `[ ] Pending` | **[Sprint 3]** Trong hàm `handleMqttCommand()`, sau khi nhận URL, chỉ gọi `ota::request_ota_update(url)` và return ngay lập tức. Cấm thực hiện tải xuống OTA trực tiếp tại đây để tránh treo và reset chip do WDT. |
| D6 | Tích hợp kiểm tra trigger OTA vào Core 0 loop | `[ ] Pending` | **[Sprint 3]** Tại hàm `taskCore0Communication()`, chèn bước check `ota::check_ota_trigger(ota_url)` tại bước 5.5. Nếu có yêu cầu, thực hiện gọi đồng bộ `ota::perform_ota_update(ota_url)`. |
