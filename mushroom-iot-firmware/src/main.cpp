#include <Arduino.h>
#include "definitions.h"
#include "storage.h"
#include "config.h"

void setup()
{
    // Initialize Serial interface
    Serial.begin(115200);
    delay(500); // Give serial monitor time to connect
    Serial.println("[MAIN] ESP32 Firmware Starting...");

    // 1. Initialize NVS Storage
    storage::StorageManager &storage = storage::StorageManager::get_instance();
    if (storage.init())
    {
        Serial.println("[MAIN] NVS Storage initialized successfully.");
    }
    else
    {
        Serial.println("[MAIN] ERROR: NVS Storage initialization failed!");
    }

    // 2. Load runtime configuration from NVS
    config::network::load_runtime_config();

    // 3. Create and pin Task Core 0 Communication to Core 0
    // Stack size: 4096 bytes
    // Priority: 1
    // Pinned to Core 0
    #ifndef UNIT_TEST
    BaseType_t result = xTaskCreatePinnedToCore(
        task_core0_communication,    // Task function
        "TaskCore0Comm",             // Name of task
        4096,                        // Stack size in bytes (4096)
        nullptr,                     // Parameter to pass
        1,                           // Task priority
        nullptr,                     // Task handle
        0                            // Pin to Core 0
    );

    if (result == pdPASS)
    {
        Serial.println("[MAIN] Pinned task_core0_communication to Core 0 successfully.");
    }
    else
    {
        Serial.printf("[MAIN] ERROR: Failed to create task_core0_communication (code: %d)!\n", (int)result);
    }
    #else
    Serial.println("[MAIN] Unit testing mode: Skip creating FreeRTOS task.");
    #endif
}

void loop()
{
    // The main loop is running on Core 1 by default in Arduino-ESP32,
    // but we can delay or delete it since logic is delegated to FreeRTOS tasks.
    #ifndef UNIT_TEST
    vTaskDelay(pdMS_TO_TICKS(1000));
    #endif
}
