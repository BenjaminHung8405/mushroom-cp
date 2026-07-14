# Sprint 2 — OTA Manager Module (Thread-Safe + Inter-Core Interlock)

**Phạm vi Big Plan:** Nhóm thay đổi #2 — Tạo mới `ota_manager.h` và `ota_manager.cpp`.
**Phụ thuộc:** Sprint 1 phải hoàn thành trước (cần `hTaskCore1Control`, `hTaskHWButton` đã được
khai báo trong `definitions.h` và được gán trong `main.cpp`).

---

## 1. PHẠM VI & MỤC TIÊU

### Module / Component bị tác động trực tiếp

| File | Loại tác động | Mô tả |
|------|--------------|-------|
| `mushroom-iot-firmware/include/ota_manager.h` | NEW | Khai báo public API của namespace `ota` |
| `mushroom-iot-firmware/src/ota_manager.cpp` | NEW | Hiện thực toàn bộ logic OTA: Mutex, Interlock, HTTPS update |

### Mục tiêu của Sprint này
1. Tạo module `ota` độc lập, tự chứa (self-contained), không phụ thuộc vòng vào MQTT hay WiFi.
2. Mutex (`otaMutex`) bảo vệ hoàn toàn biến `shared_ota_url` và `ota_pending` khỏi race condition.
3. Hàm `perform_ota_update()` thực hiện đúng quy trình: tắt relay → suspend Core 1 tasks →
   tải OTA → resume nếu lỗi.
4. WDT được nuôi liên tục trong progress callback để tránh hard reset giữa chừng.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[Context: MQTT Callback Thread — Core 0, ISR-like context]
       |
       v
ota::request_ota_update(url)   <- Gọi khi nhận lệnh ota_update từ MQTT
  ├─ xSemaphoreTake(otaMutex, 100ms)
  ├─ shared_ota_url = url        <- Ghi URL an toàn trong critical section
  ├─ ota_pending = true           <- Set cờ trigger
  └─ xSemaphoreGive(otaMutex)

[Context: Core 0 Main Loop — taskCore0Communication]
       |
       v (mỗi iteration)
ota::check_ota_trigger(out url)   <- Quét định kỳ, không block
  ├─ xSemaphoreTake(otaMutex, 10ms)
  ├─ if (ota_pending):
  │    url = shared_ota_url         <- Copy URL ra local variable
  │    ota_pending = false           <- Clear cờ
  │    xSemaphoreGive(otaMutex)
  │    return true
  └─ else: xSemaphoreGive, return false
       |
       v (nếu check_ota_trigger() trả về true)
ota::perform_ota_update(url)   <- Chạy đồng bộ trên Core 0
  |
  ├─ [BƯỚC 1] Publish offline status
  │    mqtt::MqttClient::getInstance().publishStatus(false)
  |
  ├─ [BƯỚC 2] Relay Safety — Default-Off
  │    digitalWrite(GPIO_RELAY_1, LOW)  // Sương
  │    digitalWrite(GPIO_RELAY_2, LOW)  // Quạt
  │    digitalWrite(GPIO_RELAY_3, LOW)  // Sưởi nhiệt
  │    digitalWrite(GPIO_RELAY_4, LOW)  // Dự phòng
  |
  ├─ [BƯỚC 3] Inter-Core Interlock — Suspend Core 1
  │    #ifndef UNIT_TEST
  │    vTaskSuspend(hTaskCore1Control)
  │    vTaskSuspend(hTaskHWButton)
  │    #endif
  |
  ├─ [BƯỚC 4] HTTPS OTA Download
  │    WiFiClientSecure client;
  │    client.setInsecure();
  │    httpUpdate.onProgress(progressCallback)  <- Feed WDT trong callback
  │    t_httpUpdate_return result = httpUpdate.update(client, url)
  |
  ├─ [BƯỚC 5 - SUCCESS] OTA thành công => chip tự reboot (không cần resume)
  |
  └─ [BƯỚC 6 - FAILURE] OTA thất bại => Resume Core 1 tasks
       #ifndef UNIT_TEST
       vTaskResume(hTaskCore1Control)
       vTaskResume(hTaskHWButton)
       #endif
       Serial.printf("[OTA] FAILED: %s
", httpUpdate.getLastErrorString().c_str())
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK A — Tầng Khai Báo API (ota_manager.h)

#### Task A-1: Tạo file header ota_manager.h

**File:** `mushroom-iot-firmware/include/ota_manager.h`
**Hàm/Phương thức:** Khai báo toàn bộ public API của `namespace ota`.

**Chi tiết — nội dung đầy đủ của file:**
```cpp
#pragma once

// ota_manager.h — Public API for OTA update orchestration.
// All functions must be called from Core 0 context only,
// except request_ota_update() which is safe to call from MQTT callback.

#ifndef UNIT_TEST
#include <Arduino.h>
#endif

#include <WString.h>

namespace ota {

    /// @brief Khởi tạo Mutex Semaphore cho OTA. Gọi trong wifi::init_wifi() hoặc setup().
    void init();

    /// @brief Lưu URL OTA một cách thread-safe. An toàn để gọi từ MQTT Callback.
    /// @param url URL HTTPS trỏ đến file firmware .bin mới.
    void request_ota_update(const String& url);

    /// @brief Kiểm tra xem có OTA pending không và lấy URL ra. Gọi định kỳ từ Core 0 loop.
    /// @param[out] url Nếu trả về true, url chứa địa chỉ firmware cần tải.
    /// @return true nếu có OTA pending, false nếu không.
    bool check_ota_trigger(String& url);

    /// @brief Thực hiện toàn bộ quy trình OTA: Safety → Interlock → Download.
    ///        Chạy đồng bộ trên Core 0. Chip sẽ reboot nếu thành công.
    ///        Nếu thất bại, Core 1 tasks sẽ được Resume lại.
    /// @param url URL HTTPS đến file .bin firmware.
    void perform_ota_update(const String& url);

} // namespace ota
```

**Ràng buộc:**
- Không có bất kỳ implementation code nào trong file `.h`.
- Chỉ dùng `String` (Arduino type) — không dùng `std::string` để tương thích với Arduino framework.

---

### TRACK B — Tầng Hiện Thực (ota_manager.cpp)

#### Task B-1: Khai báo biến nội bộ và include

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** File scope static variables.

**Chi tiết — phần đầu file:**
```cpp
#include "ota_manager.h"
#include "definitions.h"   // hTaskCore1Control, hTaskHWButton, ScopedSerialLock
#include "mqtt_client.h"   // mqtt::MqttClient::getInstance().publishStatus()
#include "serial_mutex.h"

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <esp_task_wdt.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>
#endif

namespace ota {
namespace {  // anonymous namespace — implementation details

static SemaphoreHandle_t otaMutex     = nullptr;
static volatile bool     ota_pending  = false;
static String            shared_ota_url = "";

// GPIO pins cho Relay (căn cứ theo HARDWARE_DEPLOYMENT.md và actuators.cpp)
// Đây là hard fallback safety — không dùng actuators API để tránh phụ thuộc
// vào trạng thái Core 1 task đã bị Suspend.
static constexpr int RELAY_GPIO_PINS[] = {10, 11, 12, 13};
static constexpr int RELAY_GPIO_COUNT  = 4;

} // anonymous namespace
```

#### Task B-2: Hiện thực hàm `init()`

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::init()`

**Chi tiết:**
```cpp
void init() {
#ifndef UNIT_TEST
    if (otaMutex == nullptr) {
        otaMutex = xSemaphoreCreateMutex();
        if (otaMutex == nullptr) {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[OTA] FATAL: Failed to create otaMutex!");
        } else {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[OTA] otaMutex created successfully.");
        }
    }
#endif
}
```

**Ghi chú quan trọng:**
- Kiểm tra `otaMutex == nullptr` trước khi tạo để tránh gọi `init()` nhiều lần.
- Log lỗi rõ ràng với prefix `[OTA]` nếu tạo Mutex thất bại.

#### Task B-3: Hiện thực hàm `request_ota_update()`

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::request_ota_update(const String& url)`

**Chi tiết:**
```cpp
void request_ota_update(const String& url) {
    if (url.length() == 0) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] request_ota_update(): Empty URL ignored.");
        return;
    }
#ifndef UNIT_TEST
    if (otaMutex == nullptr) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] ERROR: otaMutex not initialized. Call ota::init() first.");
        return;
    }
    if (xSemaphoreTake(otaMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        shared_ota_url = url;
        ota_pending    = true;
        xSemaphoreGive(otaMutex);
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[OTA] OTA update requested. URL: %s
", url.c_str());
    } else {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] WARNING: Could not acquire mutex to set OTA URL.");
    }
#else
    // Unit test stub: simply set flags directly
    shared_ota_url = url;
    ota_pending    = true;
#endif
}
```

**Logic quan trọng:**
- Timeout Mutex là `100ms` — đủ dài để tránh bỏ lỡ, đủ ngắn để không block MQTT callback.
- Trong `#else` (unit test), truy cập trực tiếp không cần Mutex (single-threaded).

#### Task B-4: Hiện thực hàm `check_ota_trigger()`

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::check_ota_trigger(String& url)`

**Chi tiết:**
```cpp
bool check_ota_trigger(String& url) {
#ifndef UNIT_TEST
    if (otaMutex == nullptr) return false;
    if (xSemaphoreTake(otaMutex, pdMS_TO_TICKS(10)) != pdTRUE) return false;

    bool triggered = ota_pending;
    if (triggered) {
        url        = shared_ota_url;
        ota_pending = false;
        shared_ota_url = "";
    }
    xSemaphoreGive(otaMutex);
    return triggered;
#else
    // Unit test stub
    if (ota_pending) {
        url        = shared_ota_url;
        ota_pending = false;
        shared_ota_url = "";
        return true;
    }
    return false;
#endif
}
```

**Logic quan trọng:**
- Timeout Mutex `10ms` — rất ngắn vì hàm này được gọi mỗi iteration của Core 0 loop. Nếu không
  lấy được Mutex, return `false` và thử lại ở iteration sau.
- Clear `shared_ota_url = ""` sau khi copy ra `url` để tránh rò rỉ bộ nhớ String trên heap.

#### Task B-5: Hiện thực hàm `perform_ota_update()` — Bước 1 & 2 (Safety)

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::perform_ota_update(const String& url)` — phần Safety Setup.

**Chi tiết — đầu hàm:**
```cpp
void perform_ota_update(const String& url) {
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[OTA] Starting OTA update. URL: %s
", url.c_str());
    }

    // BƯỚC 1: Publish offline status sạch sẽ
    mqtt::MqttClient::getInstance().publishStatus(false);

    // BƯỚC 2: Relay Safety — Chuyển tất cả Relay về LOW (Default-Off)
    // Thao tác trực tiếp GPIO để không phụ thuộc vào state machine của actuators module.
#ifndef UNIT_TEST
    for (int i = 0; i < RELAY_GPIO_COUNT; ++i) {
        digitalWrite(RELAY_GPIO_PINS[i], LOW);
    }
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] All relay GPIOs set to LOW (Default-Off). Safe to proceed.");
    }
#endif
```

#### Task B-6: Hiện thực `perform_ota_update()` — Bước 3 (Inter-Core Interlock)

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::perform_ota_update()` — phần Suspend Core 1.

**Chi tiết:**
```cpp
    // BƯỚC 3: Inter-Core Interlock — Suspend tất cả task chạy trên Core 1
    // MỤC ĐÍCH: Ngăn Core 1 truy cập Flash cache trong khi ghi OTA → tránh Guru Meditation Error.
#ifndef UNIT_TEST
    if (hTaskCore1Control != nullptr) {
        vTaskSuspend(hTaskCore1Control);
    }
    if (hTaskHWButton != nullptr) {
        vTaskSuspend(hTaskHWButton);
    }
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] Core 1 tasks suspended. Inter-Core Interlock engaged.");
    }
#endif
```

#### Task B-7: Hiện thực `perform_ota_update()` — Bước 4 & 5 (HTTPS OTA Download)

**File:** `mushroom-iot-firmware/src/ota_manager.cpp`
**Hàm/Phương thức:** `ota::perform_ota_update()` — phần HTTPUpdate.

**Chi tiết:**
```cpp
    // BƯỚC 4 & 5: HTTPS OTA Download với WDT Feed trong progress callback
#ifndef UNIT_TEST
    WiFiClientSecure client;
    client.setInsecure();  // Bỏ qua verify certificate — phù hợp môi trường thực địa không có CA bundle

    // Nuôi WDT trong mỗi progress tick để tránh hard reset khi tải chậm
    httpUpdate.onProgress([](int current, int total) {
        esp_task_wdt_reset();
        // Log tiến trình mỗi 10% để không flood Serial
        static int last_pct = -1;
        int pct = (total > 0) ? (current * 100 / total) : 0;
        if (pct / 10 != last_pct / 10) {
            last_pct = pct;
            Serial.printf("[OTA] Download progress: %d%%
", pct);
        }
    });

    t_httpUpdate_return result = httpUpdate.update(client, url);

    // BƯỚC 5: Xử lý kết quả
    switch (result) {
        case HTTP_UPDATE_FAILED:
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[OTA] FAILED (error %d): %s
",
                              httpUpdate.getLastError(),
                              httpUpdate.getLastErrorString().c_str());
            }
            // BƯỚC 6: Khôi phục Core 1 nếu OTA thất bại
            if (hTaskCore1Control != nullptr) vTaskResume(hTaskCore1Control);
            if (hTaskHWButton     != nullptr) vTaskResume(hTaskHWButton);
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[OTA] Core 1 tasks resumed after OTA failure.");
            }
            break;

        case HTTP_UPDATE_NO_UPDATES:
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[OTA] No update available (server returned 304).");
            }
            if (hTaskCore1Control != nullptr) vTaskResume(hTaskCore1Control);
            if (hTaskHWButton     != nullptr) vTaskResume(hTaskHWButton);
            break;

        case HTTP_UPDATE_OK:
            // Chip sẽ reboot tự động — code dưới đây không bao giờ được thực thi
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[OTA] SUCCESS. Rebooting...");
            }
            break;
    }
#endif  // end of !UNIT_TEST block

}  // end perform_ota_update()
```

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **[BẢO MẬT] Mutex PHẢI được khởi tạo trước khi dùng:**
   Gọi `ota::init()` TRƯỚC khi `ota::request_ota_update()` có thể được gọi từ bất kỳ context nào.
   Nếu `otaMutex == nullptr` khi `request_ota_update()` được gọi, hàm phải log lỗi và return sớm,
   không được dereference null pointer.

2. **[BẢO MẬT] Inter-Core Interlock phải đảo chiều khi OTA thất bại:**
   Bất kỳ code path nào trong `perform_ota_update()` mà không kết thúc bằng chip reboot (tức là
   `HTTP_UPDATE_FAILED`, `HTTP_UPDATE_NO_UPDATES`) **PHẢI** gọi `vTaskResume()` cho cả
   `hTaskCore1Control` và `hTaskHWButton`. Không được để Core 1 tasks bị treo vĩnh viễn.

3. **[HIỆU NĂNG] WDT phải được feed trong OTA progress callback:**
   `httpUpdate.onProgress` lambda phải gọi `esp_task_wdt_reset()` là lời gọi ĐẦU TIÊN. Không được
   thực hiện bất kỳ thao tác nặng nào (malloc, Serial lock) trước khi feed WDT trong callback.

4. **[TÍNH ĐÚNG ĐẮN] `client.setInsecure()` là bắt buộc:**
   Thiết bị thực địa An Giang không có CA bundle đầy đủ. Nếu không gọi `setInsecure()`, kết nối
   HTTPS sẽ fail với SSL certificate verify error. Đây là chấp nhận rủi ro có chủ đích.

5. **[TÍNH ĐÚNG ĐẮN] Relay GPIO pins phải khớp với actuators.cpp:**
   Mảng `RELAY_GPIO_PINS[]` trong `ota_manager.cpp` phải khớp 100% với GPIO assignments trong
   `actuators.cpp`. Trước khi commit, cross-check với `HARDWARE_DEPLOYMENT.md`.

6. **[UNIT TEST] File phải biên dịch sạch ở native env:**
   Toàn bộ phần phụ thuộc hardware (`WiFiClientSecure`, `HTTPUpdate`, `esp_task_wdt_reset`,
   `vTaskSuspend`, `vTaskResume`, `digitalWrite`) phải nằm sau `#ifndef UNIT_TEST`.
   Sau khi tạo file, chạy `pio test -e native` phải pass.
