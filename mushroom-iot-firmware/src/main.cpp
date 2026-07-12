#include <Arduino.h>
#include "definitions.h"
#include "storage.h"
#include "config.h"
#include "serial_mutex.h"

// Queue depth constants — sized for the expected inter-core message rate.
// Actuator commands arrive sporadically from MQTT; a depth of 8 absorbs bursts.
// Telemetry samples are produced every 5 s; depth of 4 is enough for Core 0 to
// drain without blocking Core 1.
static constexpr UBaseType_t ACTUATOR_QUEUE_DEPTH  = 8;
static constexpr UBaseType_t TELEMETRY_QUEUE_DEPTH = 4;

// Core 1 task has higher (or equal) priority than Core 0 so that sensor reads
// and relay switching are never starved by network activity.
static constexpr UBaseType_t CORE0_TASK_PRIORITY = 1;
static constexpr UBaseType_t CORE1_TASK_PRIORITY = 2;

// Stack budgets (bytes). Core 0 runs HTTP and MQTT networking.
static constexpr uint32_t CORE0_STACK_BYTES = 12288;
static constexpr uint32_t CORE1_STACK_BYTES = 4096;

void setup()
{
    // Initialize Serial interface
    Serial.begin(115200);
    // Native USB CDC (ARDUINO_USB_CDC_ON_BOOT=1) cần thời gian để re-enumerate
    // sau khi esptool hard-reset. delay(500) không đủ — tăng lên 2000ms.
    // Thêm wait loop để không miss log nếu monitor mở chậm hơn.
    uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 3000) { ; } // chờ tối đa 3s
    delay(200); // buffer nhỏ cho USB host xử lý
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

    // 3. Create Serial mutex (protects UART from concurrent Core 0/Core 1 writes)
    init_serial_mutex();

    // 4. Create FreeRTOS Queues for inter-core communication
    //    Must be created BEFORE either task starts so both cores see valid handles.
    xActuatorQueue = xQueueCreate(ACTUATOR_QUEUE_DEPTH, sizeof(ActuatorCommand));
    if (xActuatorQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xActuatorQueue!");
    }
    else
    {
        Serial.printf("[MAIN] xActuatorQueue created (depth=%u, item=%u bytes).\n",
                      static_cast<unsigned>(ACTUATOR_QUEUE_DEPTH),
                      static_cast<unsigned>(sizeof(ActuatorCommand)));
    }

    xTelemetryQueue = xQueueCreate(TELEMETRY_QUEUE_DEPTH, sizeof(TelemetryData));
    if (xTelemetryQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xTelemetryQueue!");
    }
    else
    {
        Serial.printf("[MAIN] xTelemetryQueue created (depth=%u, item=%u bytes).\n",
                      static_cast<unsigned>(TELEMETRY_QUEUE_DEPTH),
                      static_cast<unsigned>(sizeof(TelemetryData)));
    }

    xWifiEventGroup = xEventGroupCreate();
    if (xWifiEventGroup == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xWifiEventGroup!");
    }
    else
    {
        Serial.println("[MAIN] xWifiEventGroup created successfully.");
    }

#ifndef UNIT_TEST
    xTelemetryMutex = xSemaphoreCreateMutex();
    if (xTelemetryMutex == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xTelemetryMutex!");
    }
    else
    {
        Serial.println("[MAIN] xTelemetryMutex created successfully.");
    }
#endif

    #ifndef UNIT_TEST
    // 4. Create and pin Task Core 0 Communication to Core 0
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            task_core0_communication, // Task function
            "TaskCore0Comm",          // Name of task
            CORE0_STACK_BYTES,        // Stack size in bytes
            nullptr,                  // Parameter to pass
            CORE0_TASK_PRIORITY,      // Task priority
            nullptr,                  // Task handle
            0                         // Pin to Core 0
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned task_core0_communication to Core 0 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create task_core0_communication (code: %d)!\n",
                          static_cast<int>(result));
        }
    }

    // 5. Create and pin Task Core 1 Control to Core 1
    //    Higher priority than Core 0 ensures real-time sensor/actuator response.
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            task_core1_control,  // Task function
            "TaskCore1Ctrl",     // Name of task
            CORE1_STACK_BYTES,   // Stack size in bytes
            nullptr,             // Parameter to pass
            CORE1_TASK_PRIORITY, // Task priority (higher than Core 0)
            nullptr,             // Task handle
            1                    // Pin to Core 1
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned task_core1_control to Core 1 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create task_core1_control (code: %d)!\n",
                          static_cast<int>(result));
        }
    }
    // 6. Create Hardware Button Task (Core 1) — Track I
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            task_hardware_button,  // Task function
            "TaskHWButton",        // Name of task
            2048,                  // Stack size in bytes
            nullptr,               // Parameter to pass
            CORE1_TASK_PRIORITY,   // Priority (same as Core 1 control)
            nullptr,               // Task handle
            1                      // Pin to Core 1
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned task_hardware_button to Core 1 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create task_hardware_button (code: %d)!\n",
                          static_cast<int>(result));
        }
    }
    #else
    Serial.println("[MAIN] Unit testing mode: Skip creating FreeRTOS tasks.");
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
