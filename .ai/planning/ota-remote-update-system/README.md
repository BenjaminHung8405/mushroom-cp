# OTA Remote Update System — Kế hoạch Triển Khai Kết Nối Từ Xa

## 1. Mục Tiêu Kỹ Thuật Tổng Quát

Kế hoạch này triển khai một hệ thống **OTA (Over-The-Air) an toàn thực địa** cho firmware ESP32-S3
chạy tại trang trại nấm An Giang. Mục tiêu là cho phép cập nhật firmware từ xa qua MQTT + HTTPS mà
không làm gián đoạn hoạt động điều khiển môi trường (Quạt, Sưởi, Sương) hay gây lỗi
Guru Meditation Error do xung đột cache giữa hai core.

### Các mục tiêu cụ thể

- **Thread-Safe OTA Trigger:** Biến cờ và URL OTA được bảo vệ bởi FreeRTOS Mutex để ngăn Memory
  Corruption giữa MQTT Callback (Core 0 ISR context) và Core 0 Loop.
- **WDT 8 giây:** Task Watchdog Timer được cấu hình lại từ mặc định (~5s) lên 8 giây để đủ biên an
  toàn cho các tác vụ ghi Flash NVS và kết nối HTTPS.
- **Inter-Core Interlock:** Tự động tắt toàn bộ relay (Default-Off) và Suspend các task Core 1
  (`taskCore1Control`, `taskHardwareButton`) trước khi ghi Flash OTA, ngăn Guru Meditation Error
  do Flash cache race condition. Tự động Resume nếu OTA thất bại.
- **Tự động JWT Auth:** Sau khi kết nối WiFi, firmware tự động lấy JWT từ backend qua HTTPS và gán
  vào `MQTT_PASSWORD_VAL` — xóa bỏ yêu cầu hardcode credential.

---

## 2. Tech Stack Cốt Lõi

| Hạng mục          | Lựa chọn                                                      |
|-------------------|---------------------------------------------------------------|
| **Platform**      | ESP32-S3 (Espressif IDF via Arduino framework)                |
| **Build System**  | PlatformIO (v6.x), `env:otg` / `env:uart`                    |
| **Language**      | C++17 (ISO standard với Arduino HAL)                          |
| **RTOS**          | FreeRTOS (tích hợp sẵn trong ESP-IDF 5.x)                    |
| **MQTT**          | `PubSubClient @ ^2.8` (`knolleary/PubSubClient`)             |
| **HTTP/HTTPS**    | `HTTPClient`, `WiFiClientSecure` (Arduino-ESP32 built-in)     |
| **OTA Engine**    | `HTTPUpdate` (Arduino-ESP32 built-in `<HTTPUpdate.h>`)        |
| **JSON**          | `ArduinoJson @ ^6.21.3` (`bblanchon/ArduinoJson`)            |
| **NVS Storage**   | ESP-IDF `nvs_flash` qua `storage::StorageManager`            |
| **Unit Test**     | PlatformIO Native Test (`pio test -e native`), guard `#ifndef UNIT_TEST` |
| **Serial Lock**   | `ScopedSerialLock` / `SerialLock` (đã có sẵn trong codebase) |

---

## 3. Quy Tắc Viết Code Toàn Cục (Coding Conventions)

Mọi Agent thực thi trong Plan này **BẮT BUỘC** tuân theo các quy tắc sau:

### 3.1. Kiến Trúc Tổng Thể (Clean Architecture / SRP)

- **Single Responsibility:** Mỗi file `.cpp` / `.h` chịu trách nhiệm một domain duy nhất.
  `ota_manager.cpp` chỉ chứa logic OTA; không trộn logic WiFi hay MQTT vào đây.
- **Namespace bắt buộc:** Mọi symbol mới khai báo trong file `.h` phải nằm trong `namespace`
  (ví dụ: `namespace ota`). Không dùng global function trần.
- **Encapsulation qua `static`:** Các biến nội bộ module (ví dụ: `otaMutex`, `shared_ota_url`) phải
  khai báo `static` ở file scope trong `.cpp` — chỉ expose qua hàm API trong header.

### 3.2. Thread Safety

- **Mutex cho mọi shared state:** Bất kỳ biến nào đọc/ghi từ nhiều task/context khác nhau **PHẢI**
  được bảo vệ bằng `SemaphoreHandle_t` (Mutex). Sử dụng pattern `xSemaphoreTake` / `xSemaphoreGive`
  với timeout tường minh (không dùng `portMAX_DELAY` khi có thể).
- **Thời gian giữ Mutex tối thiểu:** Không thực hiện I/O (HTTPS, Flash write) khi đang giữ Mutex.
  Chỉ đọc/ghi biến trong vùng critical section, sau đó nhả Mutex ngay.
- **Guard `#ifndef UNIT_TEST`:** Mọi lời gọi FreeRTOS API (`xSemaphoreCreateMutex`,
  `vTaskSuspend`, v.v.) phải được bao trong `#ifndef UNIT_TEST ... #endif`.

### 3.3. Watchdog Timer

- **Feed WDT định kỳ:** Mọi vòng lặp dài (OTA progress callback, vòng lặp chính Core 0) **PHẢI**
  gọi `esp_task_wdt_reset()` ở đầu mỗi iteration hoặc trong callback progress.
- **Không block quá 8 giây:** Không có lời gọi blocking nào giữ Core 0 quá 8 giây liên tục.

### 3.4. Đặt Tên

- **Hàm:** `snake_case` (ví dụ: `request_ota_update`, `check_ota_trigger`, `perform_ota_update`).
- **Biến file-scope static:** `snake_case` trơn (ví dụ: `ota_pending`, `shared_ota_url`).
- **Hằng số compile-time:** `SCREAMING_SNAKE_CASE` (ví dụ: `AUTH_HTTP_TIMEOUT_MS`).
- **Macro guard:** Dùng `#pragma once` cho tất cả file `.h` mới. Không dùng `#ifndef HEADER_H`.
- **Task Handles:** `hTask<TênTask>` (ví dụ: `hTaskCore1Control`, `hTaskHWButton`).

### 3.5. Xử Lý Lỗi (Error Handling)

- **Không im lặng thất bại:** Mọi lỗi runtime phải in log qua `ScopedSerialLock` + `Serial.printf`
  với prefix `[MODULE_NAME]` rõ ràng (ví dụ: `[OTA]`, `[WIFI]`, `[MQTT]`).
- **Fail-Safe Default-Off:** Khi có nghi ngờ về trạng thái relay, luôn ghi `LOW` ra GPIO. Không để
  relay ở trạng thái không xác định.
- **Kiểm tra nullptr:** Mọi `TaskHandle_t` và `SemaphoreHandle_t` phải kiểm tra `!= nullptr` trước
  khi dùng.

### 3.6. Unit Test Compatibility

- Mọi file `.cpp` mới phải biên dịch sạch với `pio test -e native` (không warning, không error).
- Logic nghiệp vụ thuần (kiểm tra cờ, build URL) phải có thể test được mà không cần phần cứng.
- Phần phụ thuộc phần cứng (`WiFiClientSecure`, `HTTPUpdate`, GPIO) phải cô lập sau `#ifndef UNIT_TEST`.

---

## 4. Danh Sách Sprint

| Sprint | Tiêu đề                                             | Files chính bị tác động                                     |
|--------|-----------------------------------------------------|-------------------------------------------------------------|
| **1**  | PlatformIO Config, WDT & Task Handle Foundation     | `platformio.ini`, `definitions.h`, `main.cpp`, `core0_tasks.cpp` |
| **2**  | OTA Manager Module (Thread-Safe + Interlock)        | `ota_manager.h` [NEW], `ota_manager.cpp` [NEW]             |
| **3**  | MQTT Integration & WiFi Auth JWT                    | `mqtt_client.cpp`, `wifi_manager.cpp`, `core0_tasks.cpp`   |
