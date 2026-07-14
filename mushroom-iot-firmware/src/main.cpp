#include <Arduino.h>
#include "definitions.h"
#include "storage.h"
#include "config.h"
#include "serial_mutex.h"
#include "actuators.h"
#include "sensors.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "Telemetry.h"
#include "Trajectory.h"
#include "encoder.h"
#include "manual_control.h"

// Task handles for Core 1 tasks. Externally declared in definitions.h so
// other modules (e.g. ota_manager) can suspend/resume them safely during
// firmware update. Wrapped in #ifndef UNIT_TEST because TaskHandle_t is a
// FreeRTOS type that is unavailable in the native unit-test environment.
#ifndef UNIT_TEST
TaskHandle_t hTaskCore1Control = nullptr;
TaskHandle_t hTaskHWButton     = nullptr;
#endif

// Global Queue Handles for Manual Control
QueueHandle_t g_manual_request_queue = nullptr;
QueueHandle_t g_manual_ack_queue = nullptr;

// Telemetry samples are produced every 5 s; depth of 4 is enough for Core 0 to
// drain without blocking Core 1.
static constexpr UBaseType_t TELEMETRY_QUEUE_DEPTH = 4;

// Core 1 task has higher (or equal) priority than Core 0 so that sensor reads
// and relay switching are never starved by network activity.
static constexpr UBaseType_t CORE0_TASK_PRIORITY = 1;
static constexpr UBaseType_t CORE1_TASK_PRIORITY = 2;

// Stack budgets (bytes). Core 0 runs HTTP and MQTT networking.
static constexpr uint32_t CORE0_STACK_BYTES = 8192;
static constexpr uint32_t CORE1_STACK_BYTES = 4096;

void initQueues()
{
    // Create FreeRTOS Queues for inter-core communication
    // Must be created BEFORE either task starts so both cores see valid handles.
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

    xBaselineQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
    if (xBaselineQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xBaselineQueue!");
    }
    else
    {
        Serial.printf("[MAIN] xBaselineQueue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ControlSetpointCommand)));
    }

    xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
    if (xOverrideQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xOverrideQueue!");
    }
    else
    {
        Serial.printf("[MAIN] xOverrideQueue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ControlSetpointCommand)));
    }

    xActuatorOverrideQueue = xQueueCreate(1, sizeof(ActuatorOverrideCommand));
    if (xActuatorOverrideQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create xActuatorOverrideQueue!");
    }
    else
    {
        Serial.printf("[MAIN] xActuatorOverrideQueue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ActuatorOverrideCommand)));
    }

    g_manual_request_queue = xQueueCreate(8, sizeof(ManualRequest));
    if (g_manual_request_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_manual_request_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_manual_request_queue created (depth=8, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ManualRequest)));
    }

    g_manual_ack_queue = xQueueCreate(8, sizeof(ManualAck));
    if (g_manual_ack_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_manual_ack_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_manual_ack_queue created (depth=8, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ManualAck)));
    }
}

void initSemaphores()
{
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
}

void createCoreTasks()
{
#ifndef UNIT_TEST
    // Create and pin Task Core 0 Communication to Core 0
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            taskCore0Communication, // Task function
            "TaskCore0Comm",          // Name of task
            CORE0_STACK_BYTES,        // Stack size in bytes
            nullptr,                  // Parameter to pass
            CORE0_TASK_PRIORITY,      // Task priority
            nullptr,                  // Task handle
            0                         // Pin to Core 0
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned taskCore0Communication to Core 0 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create taskCore0Communication (code: %d)!\n",
                          static_cast<int>(result));
        }
    }

    // Create and pin Task Core 1 Control to Core 1
    // Higher priority than Core 0 ensures real-time sensor/actuator response.
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            taskCore1Control,  // Task function
            "TaskCore1Ctrl",     // Name of task
            CORE1_STACK_BYTES,   // Stack size in bytes
            nullptr,             // Parameter to pass
            CORE1_TASK_PRIORITY, // Task priority (higher than Core 0)
            nullptr,             // Task handle
            1                    // Pin to Core 1
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned taskCore1Control to Core 1 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create taskCore1Control (code: %d)!\n",
                          static_cast<int>(result));
        }
    }

    // Create KY-040 input task on Core 0.
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            taskEncoderInput,
            "TaskEncoder",
            2048,
            nullptr,
            CORE0_TASK_PRIORITY,
            nullptr,
            0
        );
        if (result != pdPASS)
        {
            Serial.printf("[MAIN] ERROR: Failed to create taskEncoderInput (code: %d)!\n", static_cast<int>(result));
        }
    }

    // Create Hardware Button Task (Core 1) — Track I
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            taskHardwareButton,  // Task function
            "TaskHWButton",        // Name of task
            2048,                  // Stack size in bytes
            nullptr,               // Parameter to pass
            CORE1_TASK_PRIORITY,   // Priority (same as Core 1 control)
            nullptr,               // Task handle
            1                      // Pin to Core 1
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned taskHardwareButton to Core 1 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create taskHardwareButton (code: %d)!\n",
                          static_cast<int>(result));
        }
    }
#else
    Serial.println("[MAIN] Unit testing mode: Skip creating FreeRTOS tasks.");
#endif
}

void hydrateSetpointsFromNVS()
{
    storage::StorageManager &storage = storage::StorageManager::get_instance();

    // 1. Hydrate baseline setpoint
    storage::BackendSetpointSnapshot backendSnap;
    ControlSetpointCommand baselineCmd = {0.0f, 0.0f, 0.0f, false, {0, 0, 0}};
    if (storage.load_backend_snapshot(backendSnap) && backendSnap.valid)
    {
        baselineCmd.temp_target = backendSnap.temp_target;
        baselineCmd.humidity_target = backendSnap.humidity_target;
        baselineCmd.co2_target = backendSnap.co2_target;
        baselineCmd.active = true;
        Serial.printf("[MAIN] Hydrated baseline from NVS: T=%.2f, H=%.2f, CO2=%.2f\n",
                      baselineCmd.temp_target, baselineCmd.humidity_target, baselineCmd.co2_target);
    }
    else
    {
        // Fallback to trajectory Day 0
        Trajectory::SetpointPod day0 = Trajectory::interpolateSetpoints(0.0f);
        baselineCmd.temp_target = day0.temp_target;
        baselineCmd.humidity_target = day0.humidity_target;
        baselineCmd.co2_target = day0.co2_target;
        baselineCmd.active = true;
        Serial.printf("[MAIN] NVS baseline empty/invalid. Fallback to Trajectory Day 0: T=%.2f, H=%.2f, CO2=%.2f\n",
                      baselineCmd.temp_target, baselineCmd.humidity_target, baselineCmd.co2_target);
    }
    
    if (xBaselineQueue != nullptr)
    {
        xQueueOverwrite(xBaselineQueue, &baselineCmd);
    }

    // 2. Hydrate hardware override setpoint (if active)
    storage::HardwareOverrideSnapshot overrideSnap;
    if (storage.load_hardware_override(overrideSnap) && overrideSnap.active)
    {
        ControlSetpointCommand overrideCmd = {0.0f, 0.0f, 0.0f, false, {0, 0, 0}};
        overrideCmd.temp_target = overrideSnap.temp_target;
        overrideCmd.humidity_target = overrideSnap.humidity_target;
        overrideCmd.co2_target = NAN; // CO2 is not manually overridden
        overrideCmd.active = true;
        
        if (xOverrideQueue != nullptr)
        {
            xQueueOverwrite(xOverrideQueue, &overrideCmd);
        }
        Serial.printf("[MAIN] Hydrated hardware override from NVS: T=%.2f, H=%.2f\n",
                      overrideCmd.temp_target, overrideCmd.humidity_target);
    }
    else
    {
        ControlSetpointCommand overrideCmd = {NAN, NAN, NAN, false, {0, 0, 0}};
        if (xOverrideQueue != nullptr)
        {
            xQueueOverwrite(xOverrideQueue, &overrideCmd);
        }
        Serial.println("[MAIN] No active hardware override in NVS. Sent inactive override command.");
    }

    // 3. Hydrate actuator manual overrides
    storage::ActuatorOverrideSnapshot actSnap;
    if (storage.load_actuator_override(actSnap))
    {
        ActuatorOverrideCommand actCmd;
        actCmd.mist_override = actSnap.mist_override;
        actCmd.fan_override = actSnap.fan_override;
        actCmd.heater_air_override = actSnap.heater_air_override;
        actCmd.active = actSnap.active;

        if (xActuatorOverrideQueue != nullptr)
        {
            xQueueOverwrite(xActuatorOverrideQueue, &actCmd);
        }
        Serial.printf("[MAIN] Hydrated actuator overrides: Mist:%d, Fan:%d, HAir:%d, Active:%d\n",
                      actCmd.mist_override, actCmd.fan_override, actCmd.heater_air_override, actCmd.active);
    }
    else
    {
        ActuatorOverrideCommand actCmd = { 0, 0, 0, false };
        if (xActuatorOverrideQueue != nullptr)
        {
            xQueueOverwrite(xActuatorOverrideQueue, &actCmd);
        }
        Serial.println("[MAIN] No active actuator overrides in NVS. Sent inactive override command.");
    }
}

void setup()
{
    // Initialize Serial interface
    Serial.begin(115200);
    // 1. Quy trình khởi tạo Fail-Safe: Khởi tạo GPIO cho các Relay ở mức LOW (OFF) ngay lập tức
    actuators::init_actuators_gpio();

    Serial.println("[MAIN] ESP32 Firmware Starting...");

    // 2. Khởi tạo I2C bus và cảm biến SHT30
    sensors::init_sensors_placeholder();

    // 3. Initialize NVS Storage
    storage::StorageManager &storage = storage::StorageManager::get_instance();
    if (storage.init())
    {
        Serial.println("[MAIN] NVS Storage initialized successfully.");
    }
    else
    {
        Serial.println("[MAIN] ERROR: NVS Storage initialization failed!");
    }

    // 4. Load runtime configuration from NVS
    config::network::load_runtime_config();

    // 5. Create Serial mutex (protects UART from concurrent Core 0/Core 1 writes)
    init_serial_mutex();

    // 6. Create queues and semaphores
    initQueues();
    initSemaphores();

    // Hydrate setpoints from NVS to queues
    hydrateSetpointsFromNVS();

    // 7. Initialize and activate WiFi
    wifi::init_wifi();

    // 8. Create tasks
    createCoreTasks();
}

void loop()
{
    // The main loop is running on Core 1 by default in Arduino-ESP32,
    // but we can delay or delete it since logic is delegated to FreeRTOS tasks.
    #ifndef UNIT_TEST
    vTaskDelay(pdMS_TO_TICKS(1000));
    #else
    // Trong môi trường UNIT_TEST, ta chạy loop của Core 0 để kiểm thử đồng bộ
    // (như duy trì Webserver, MQTT loop, check delta telemetry)
    // Điều này đảm bảo biên dịch thành công và kiểm chứng được các luồng logic trong test suite.
    wifi::check_wifi_connection();
    mqtt::MqttClient::getInstance().loop();

    static unsigned long last_delta_scan = 0;
    unsigned long now = millis();
    if (now - last_delta_scan >= 5000)
    {
        last_delta_scan = now;
        static Telemetry::TelemetryState telemetryState = Telemetry::makeInitialState();
        TelemetryData mock_tel = {25.0f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}}};
        processTelemetryPublication(now, mock_tel, telemetryState);
    }
    #endif
}
