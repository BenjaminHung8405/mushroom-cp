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
        Serial.printf("[OTA] OTA update requested. URL: %s\n", url.c_str());
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

void perform_ota_update(const String& url) {
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[OTA] Starting OTA update. URL: %s\n", url.c_str());
    }

    // BƯỚC 1: Publish offline status sạch sẽ
    mqtt::MqttClient::getInstance().publishStatus(false);

    // BƯỚC 2: Relay Safety — Chuyển tất cả Relay về HIGH (Default-Off cho SSR)
    // Thao tác trực tiếp GPIO để không phụ thuộc vào state machine của actuators module.
#ifndef UNIT_TEST
    for (int i = 0; i < RELAY_GPIO_COUNT; ++i) {
        digitalWrite(RELAY_GPIO_PINS[i], HIGH);
    }
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] All relay GPIOs set to HIGH (Default-Off for SSR). Safe to proceed.");
    }
#endif

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
            Serial.printf("[OTA] Download progress: %d%%\n", pct);
        }
    });

    t_httpUpdate_return result = httpUpdate.update(client, url);

    // BƯỚC 5: Xử lý kết quả
    switch (result) {
        case HTTP_UPDATE_FAILED:
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[OTA] FAILED (error %d): %s\n",
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
}

} // namespace ota
