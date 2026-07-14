# Sprint 1 — PlatformIO Config, WDT & Task Handle Foundation

**Phạm vi Big Plan:** Nhóm thay đổi #1 (PlatformIO & WDT) + phần Task Handle của Nhóm #2.
**Phụ thuộc:** Không có — Sprint này là nền tảng cho Sprint 2 và 3.

---

## 1. PHẠM VI & MỤC TIÊU

### Module / Component bị tác động trực tiếp

| File | Loại tác động | Mô tả |
|------|--------------|-------|
| `mushroom-iot-firmware/platformio.ini` | MODIFY | Bổ sung build flag `-DMQTT_MAX_PACKET_SIZE=2048` vào `[env:base]` |
| `mushroom-iot-firmware/include/definitions.h` | MODIFY | Khai báo `extern TaskHandle_t hTaskCore1Control` và `hTaskHWButton` |
| `mushroom-iot-firmware/src/main.cpp` | MODIFY | Định nghĩa Task Handles; gán handle khi tạo task trong `createCoreTasks()` |
| `mushroom-iot-firmware/src/core0_tasks.cpp` | MODIFY | Thêm WDT init (8s), đăng ký task với WDT, feed WDT trong vòng lặp |

### Mục tiêu của Sprint này
1. MQTT buffer đủ lớn (2048 bytes) để nhận payload OTA URL từ broker.
2. Task WDT của Core 0 được cấu hình 8 giây — sẵn sàng cho tác vụ Flash/HTTPS dài.
3. Task Handles `hTaskCore1Control` và `hTaskHWButton` được khai báo, định nghĩa, và gán đúng khi
   tạo task — để Sprint 2 có thể gọi `vTaskSuspend` / `vTaskResume` an toàn.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[setup() trong main.cpp]
       |
       v
createCoreTasks()
  ├─ xTaskCreatePinnedToCore(taskCore1Control, ..., &hTaskCore1Control, 1)
  │      -> hTaskCore1Control (TaskHandle_t, defined in main.cpp, extern in definitions.h)
  └─ xTaskCreatePinnedToCore(taskHardwareButton, ..., &hTaskHWButton, 1)
         -> hTaskHWButton    (TaskHandle_t, defined in main.cpp, extern in definitions.h)

[taskCore0Communication() trong core0_tasks.cpp]
       |
       v (khởi tạo một lần, trước while loop)
esp_task_wdt_init(8, true)   <- Đặt lại ngưỡng WDT toàn hệ thống lên 8 giây
esp_task_wdt_add(nullptr)    <- Đăng ký task hiện tại (Core 0) với WDT daemon
       |
       v (mỗi iteration của while(1) loop)
[Các bước xử lý hiện tại 1-6]
       |
       v
esp_task_wdt_reset()         <- Feed watchdog, reset bộ đếm 8 giây
vTaskDelay(1ms)              <- CPU yield

[platformio.ini — compile time]
build_flags trong [env:base]:
  -DMQTT_MAX_PACKET_SIZE=2048  <- PubSubClient cấp phát buffer 2048 bytes khi init
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK A — Tầng Cấu Hình Build

#### Task A-1: Bổ sung MQTT buffer flag vào platformio.ini

**File:** `mushroom-iot-firmware/platformio.ini`
**Hàm/Phương thức:** Không có — thay đổi cấu hình build.

**Chi tiết:**
- Trong section `[env:base]`, thêm dòng `-DMQTT_MAX_PACKET_SIZE=2048` vào `build_flags`.
- Flag này phải nằm SAU các flag hiện tại (không xóa flag cũ).
- Vị trí thêm vào: sau dòng `-D MQTT_SOCKET_TIMEOUT=2`.

**Trạng thái hiện tại của build_flags trong [env:base]:**
```ini
build_flags =
    -D CORE_DEBUG_LEVEL=3
    -D BOARD_HAS_PSRAM
    -D MQTT_SOCKET_TIMEOUT=2
```

**Sau khi sửa:**
```ini
build_flags =
    -D CORE_DEBUG_LEVEL=3
    -D BOARD_HAS_PSRAM
    -D MQTT_SOCKET_TIMEOUT=2
    -D MQTT_MAX_PACKET_SIZE=2048
```

---

### TRACK B — Tầng Khai Báo / Extern (definitions.h)

#### Task B-1: Khai báo extern TaskHandle_t cho hai task Core 1

**File:** `mushroom-iot-firmware/include/definitions.h`
**Hàm/Phương thức:** Không có hàm — thêm khai báo extern toàn cục.

**Chi tiết:**
- Thêm vào cuối block `#ifndef UNIT_TEST` hiện có (sau dòng `extern SemaphoreHandle_t xTelemetryMutex;`):
  ```cpp
  extern TaskHandle_t hTaskCore1Control;
  extern TaskHandle_t hTaskHWButton;
  ```
- Cả hai khai báo đều phải nằm trong block `#ifndef UNIT_TEST ... #endif`.
- Type `TaskHandle_t` đã được include qua `<freertos/task.h>` trong block `#ifndef UNIT_TEST` ở đầu file.

**Tác động:** Mọi translation unit include `definitions.h` sẽ thấy hai handles này, đặc biệt là
`ota_manager.cpp` ở Sprint 2.

---

### TRACK C — Tầng Khởi Tạo Task (main.cpp)

#### Task C-1: Định nghĩa TaskHandle_t ở file scope

**File:** `mushroom-iot-firmware/src/main.cpp`
**Hàm/Phương thức:** File scope (global definitions).

**Chi tiết:**
- Thêm NGAY SAU các dòng `#include` ở đầu file, trong block `#ifndef UNIT_TEST`:
  ```cpp
  #ifndef UNIT_TEST
  TaskHandle_t hTaskCore1Control = nullptr;
  TaskHandle_t hTaskHWButton     = nullptr;
  #endif
  ```
- Khởi tạo về `nullptr` để kiểm tra an toàn được thực hiện đúng trước khi assign.

#### Task C-2: Gán Task Handle khi tạo taskCore1Control

**File:** `mushroom-iot-firmware/src/main.cpp`
**Hàm/Phương thức:** `createCoreTasks()` — block tạo `taskCore1Control` (khoảng dòng 120-138).

**Chi tiết:**
- Trong lời gọi `xTaskCreatePinnedToCore` cho `taskCore1Control`, thay đổi tham số thứ 6 (Task handle):
  - Hiện tại: `nullptr`
  - Sau khi sửa: `&hTaskCore1Control`

**Trạng thái hiện tại:**
```cpp
BaseType_t result = xTaskCreatePinnedToCore(
    taskCore1Control,
    "TaskCore1Ctrl",
    CORE1_STACK_BYTES,
    nullptr,
    CORE1_TASK_PRIORITY,
    nullptr,       // <- đây
    1
);
```

**Sau khi sửa:**
```cpp
BaseType_t result = xTaskCreatePinnedToCore(
    taskCore1Control,
    "TaskCore1Ctrl",
    CORE1_STACK_BYTES,
    nullptr,
    CORE1_TASK_PRIORITY,
    &hTaskCore1Control,  // <- gán handle
    1
);
```

#### Task C-3: Gán Task Handle khi tạo taskHardwareButton

**File:** `mushroom-iot-firmware/src/main.cpp`
**Hàm/Phương thức:** `createCoreTasks()` — block tạo `taskHardwareButton` (khoảng dòng 158-178).

**Chi tiết:**
- Tương tự Task C-2 nhưng cho `taskHardwareButton`:
  - Thay `nullptr` ở tham số handle thứ 6 bằng `&hTaskHWButton`.

---

### TRACK D — Tầng Runtime Core 0 (core0_tasks.cpp)

#### Task D-1: Thêm include esp_task_wdt.h

**File:** `mushroom-iot-firmware/src/core0_tasks.cpp`
**Hàm/Phương thức:** Phần include ở đầu file.

**Chi tiết:**
- Thêm vào block `#ifndef UNIT_TEST`:
  ```cpp
  #ifndef UNIT_TEST
  #include <Arduino.h>
  #include <freertos/FreeRTOS.h>
  #include <freertos/task.h>
  #include <freertos/queue.h>
  #include <esp_task_wdt.h>    // <- thêm dòng này
  #else
  ```

#### Task D-2: Cấu hình WDT 8 giây và đăng ký task

**File:** `mushroom-iot-firmware/src/core0_tasks.cpp`
**Hàm/Phương thức:** `taskCore0Communication(void* pvParameters)` — phần init (trước while loop).

**Chi tiết:**
- Thêm ngay SAU dòng khởi tạo MQTT (`mqtt::MqttClient::getInstance().init();`) và TRƯỚC `while(1)`:
  ```cpp
  #ifndef UNIT_TEST
  esp_task_wdt_init(8, true);  // Cấu hình ngưỡng WDT lên 8 giây, hard-reset nếu timeout
  esp_task_wdt_add(nullptr);   // Đăng ký task hiện tại (Core 0) với WDT daemon
  #endif
  ```
- `nullptr` trong `esp_task_wdt_add` có nghĩa là đăng ký task đang chạy hiện tại.

#### Task D-3: Feed WDT trong vòng lặp chính

**File:** `mushroom-iot-firmware/src/core0_tasks.cpp`
**Hàm/Phương thức:** `taskCore0Communication()` — bên trong `while(1)` loop, bước số 7.

**Chi tiết:**
- Thay hàm `delayCore0Task()` (hiện không làm gì) bằng lời gọi feed WDT tường minh:
  - Sửa nội dung hàm `delayCore0Task()` hoặc thay thế lời gọi trong bước 7:
    ```cpp
    // 7. Yield và Feed Watchdog
    #ifndef UNIT_TEST
    esp_task_wdt_reset();
    #endif
    ```
- Đảm bảo WDT được feed ở CUỐI mỗi iteration, sau khi tất cả các bước 1-6 đã xử lý.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **[BẢO MẬT] Không tác động đến `env:native` test build:**
   Toàn bộ lời gọi `esp_task_wdt_init`, `esp_task_wdt_add`, `esp_task_wdt_reset` PHẢI nằm trong
   `#ifndef UNIT_TEST`. Chạy `pio test -e native` sau khi sửa phải pass 100%.

2. **[HIỆU NĂNG] Thứ tự gọi WDT init trước while(1):**
   `esp_task_wdt_init(8, true)` và `esp_task_wdt_add(nullptr)` chỉ được gọi MỘT LẦN duy nhất
   trong lifecycle của task. Không được đặt bên trong vòng lặp.

3. **[TÍNH ĐÚNG ĐẮN] nullptr TaskHandle trước khi gán:**
   `hTaskCore1Control` và `hTaskHWButton` PHẢI được khởi tạo về `nullptr` trước khi
   `createCoreTasks()` được gọi. `xTaskCreatePinnedToCore` sẽ ghi đè handle hợp lệ vào đó —
   bất kỳ code nào đọc handle trước khi task được tạo phải handle trường hợp `nullptr`.

4. **[TÍNH ĐÚNG ĐẮN] MQTT_MAX_PACKET_SIZE trong [env:base]:**
   Flag `-D MQTT_MAX_PACKET_SIZE=2048` PHẢI được đặt trong `[env:base]` (không phải chỉ trong
   `[env:otg]` hay `[env:uart]`), để áp dụng cho cả hai môi trường hardware.

5. **[HIỆU NĂNG] Không thêm delay mới vào Core 0 loop:**
   Việc thêm `esp_task_wdt_reset()` không được kéo theo thêm `vTaskDelay` hay sleep mới.
   Latency của vòng lặp Core 0 phải được giữ nguyên.
