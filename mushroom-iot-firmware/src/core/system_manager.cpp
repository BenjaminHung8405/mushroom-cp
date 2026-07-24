#include "core/system_manager.h"
#include "core/storage.h"
#include "config.h"
#include "core/serial_mutex.h"
#include "core/trajectory.h"
#include "protocols/mqtt_callbacks.h"
#include "core/tuning_config_manager.h"

#include <Arduino.h>
#include <time.h>
#ifndef UNIT_TEST
#include <esp_timer.h>
#endif

#ifndef UNIT_TEST
TaskHandle_t hTaskCore1Control = nullptr;
TaskHandle_t hTaskHWButton = nullptr;
TaskHandle_t hTaskEncoder = nullptr;
TaskHandle_t hTaskCabinetButtons = nullptr;
#endif

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
static constexpr uint32_t ENCODER_STACK_BYTES = 6144;
static constexpr uint32_t CABINET_BUTTONS_STACK_BYTES = 4096;
static constexpr uint32_t NVS_SLOW_OPERATION_WARN_MS = 50;

namespace {
volatile uint32_t g_baseline_config_revision = 0;
volatile uint32_t g_profile_config_revision = 0;
}

const char* controlSourceName(ControlSource source)
{
    switch (source) {
        case ControlSource::SafeOffline: return "safe_offline";
        case ControlSource::TemporaryOverride: return "temporary_override";
        case ControlSource::BaselineSetpoint: return "baseline_setpoint";
        case ControlSource::CropProfile: return "crop_profile";
        case ControlSource::Trajectory: return "trajectory";
    }
    return "unknown";
}

void setBaselineConfigRevision(uint32_t revision) { g_baseline_config_revision = revision; }
uint32_t getBaselineConfigRevision() { return g_baseline_config_revision; }
void setProfileConfigRevision(uint32_t revision) { g_profile_config_revision = revision; }
uint32_t getProfileConfigRevision() { return g_profile_config_revision; }

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

    xHardwareOverridePersistenceRequestQueue =
        xQueueCreate(1, sizeof(HardwareOverridePersistenceRequest));
    if (xHardwareOverridePersistenceRequestQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create hardware override persistence request queue!");
    }
    else
    {
        Serial.printf("[MAIN] hardware override persistence request queue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(HardwareOverridePersistenceRequest)));
    }

    xHardwareOverridePersistenceResultQueue =
        xQueueCreate(1, sizeof(HardwareOverridePersistenceResult));
    if (xHardwareOverridePersistenceResultQueue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create hardware override persistence result queue!");
    }
    else
    {
        Serial.printf("[MAIN] hardware override persistence result queue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(HardwareOverridePersistenceResult)));
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

    // One FIFO establishes the only Core 0 -> Core 1 ordering boundary for
    // MQTT mode/relay commands and physical cabinet-button requests. Producers
    // always use a zero wait time and drop a new event when this queue is full.
    g_control_event_queue = xQueueCreate(8, sizeof(ControlEvent));
    if (g_control_event_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_control_event_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_control_event_queue created (depth=8, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(ControlEvent)));
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

    g_operating_mode_ack_queue = xQueueCreate(8, sizeof(OperatingModeAck));
    if (g_operating_mode_ack_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_operating_mode_ack_queue!");
    }

    g_profile_update_queue = xQueueCreate(1, sizeof(PersistedCropProfile));
    if (g_profile_update_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_profile_update_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_profile_update_queue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(PersistedCropProfile)));
    }

    g_tuning_config_queue = xQueueCreate(1, sizeof(DynamicTuningParams));
    if (g_tuning_config_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_tuning_config_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_tuning_config_queue created (depth=1, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(DynamicTuningParams)));
    }

    mqtt::g_network_worker_queue = xQueueCreate(16, sizeof(mqtt::NetworkMessage));
    if (mqtt::g_network_worker_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: Failed to create g_network_worker_queue!");
    }
    else
    {
        Serial.printf("[MAIN] g_network_worker_queue created (depth=16, item=%u bytes).\n",
                      static_cast<unsigned>(sizeof(mqtt::NetworkMessage)));
    }

    // Create MQTT callback EventGroup for tuning overflow signals.
    // Must be created at this startup tier so the callback and Core-0 loop
    // share a valid handle without any lazy allocation in a setter.
    if (!mqtt::MessageDispatcher::init())
    {
        Serial.println("[MAIN] FATAL: Failed to create tuning callback EventGroup!");
    }
    else
    {
        Serial.println("[MAIN] MessageDispatcher RTOS resources initialised.");
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
    if (g_tuning_config_queue == nullptr)
    {
        Serial.println("[MAIN] FATAL: g_tuning_config_queue is null before task start! Halting.");
        #ifndef UNIT_TEST
        abort();
        #endif
    }

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
            &hTaskCore1Control,  // Task handle
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
            ENCODER_STACK_BYTES,
            nullptr,
            CORE0_TASK_PRIORITY,
            &hTaskEncoder,
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
            &hTaskHWButton,        // Task handle
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

    // Cabinet button events log formatted messages and synchronize with the
    // shared-state mutex; give them headroom beyond the former 2 KB stack.
    {
        BaseType_t result = xTaskCreatePinnedToCore(
            taskCabinetButtons,      // Task function
            "TaskCabinetBtns",       // Name of task
            CABINET_BUTTONS_STACK_BYTES,
            nullptr,                 // Parameter to pass
            1,                       // Task priority (Priority 1)
            &hTaskCabinetButtons,
            0                        // Pin to Core 0
        );

        if (result == pdPASS)
        {
            Serial.println("[MAIN] Pinned taskCabinetButtons to Core 0 successfully.");
        }
        else
        {
            Serial.printf("[MAIN] ERROR: Failed to create taskCabinetButtons (code: %d)!\n",
                          static_cast<int>(result));
        }
    }
#else
    Serial.println("[MAIN] Unit testing mode: Skip creating FreeRTOS tasks.");
#endif
}

void processHardwareOverridePersistence()
{
    if (xHardwareOverridePersistenceRequestQueue == nullptr ||
        xHardwareOverridePersistenceResultQueue == nullptr) {
        return;
    }

    HardwareOverridePersistenceRequest request{};
    if (xQueueReceive(xHardwareOverridePersistenceRequestQueue, &request, 0) != pdTRUE) {
        return;
    }

#ifndef UNIT_TEST
    const int64_t started_us = esp_timer_get_time();
#else
    const unsigned long started_ms = millis();
#endif

    bool success = false;
    if (request.operation == HardwareOverridePersistenceOperation::Save) {
        const storage::HardwareOverrideSnapshot snapshot = {
            request.temp_target, request.humidity_target, true};
        success = storage::StorageManager::get_instance().save_hardware_override(snapshot);
    } else {
        success = storage::StorageManager::get_instance().clear_hardware_override();
    }

#ifndef UNIT_TEST
    const uint32_t latency_ms = static_cast<uint32_t>((esp_timer_get_time() - started_us) / 1000LL);
#else
    const uint32_t latency_ms = static_cast<uint32_t>(millis() - started_ms);
#endif

    if (latency_ms > NVS_SLOW_OPERATION_WARN_MS) {
        Serial.printf("[NVS] WARN: Hardware override %s blocked for %lu ms.\n",
                      request.operation == HardwareOverridePersistenceOperation::Save ? "save" : "clear",
                      static_cast<unsigned long>(latency_ms));
    }

    const HardwareOverridePersistenceResult result = {
        request.sequence, request.operation, success, {0, 0, 0}, latency_ms};
    if (xQueueOverwrite(xHardwareOverridePersistenceResultQueue, &result) != pdTRUE) {
        Serial.println("[NVS] ERROR: Failed to publish hardware override persistence result.");
    }
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
        uint32_t revision = 0;
        storage.load_baseline_config_revision(revision);
        setBaselineConfigRevision(revision);
        Serial.printf("[MAIN] Hydrated baseline from NVS rev=%u: T=%.2f, H=%.2f, CO2=%.2f\n",
                      static_cast<unsigned>(revision),
                      baselineCmd.temp_target, baselineCmd.humidity_target, baselineCmd.co2_target);
    }
    else
    {
        // An absent baseline is not a trajectory fallback. Mark it inactive so
        // Core 1 can select the crop profile (or built-in trajectory) instead.
        // Treating this as an active Day 0 baseline permanently masked profiles.
        baselineCmd.temp_target = NAN;
        baselineCmd.humidity_target = NAN;
        baselineCmd.co2_target = NAN;
        baselineCmd.active = false;
        setBaselineConfigRevision(0);
        Serial.println("[MAIN] No valid baseline in NVS; crop profile/trajectory remains eligible.");
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

    // 4. Hydrate dynamic tuning parameters
    storage::TuningConfigManager &tuner = storage::TuningConfigManager::getInstance();
    tuner.init();

    DynamicTuningParams tuningParams = tuner.getActiveParams();
    if (g_tuning_config_queue != nullptr)
    {
        xQueueOverwrite(g_tuning_config_queue, &tuningParams);
        Serial.printf("[MAIN] Hydrated dynamic tuning parameters: rev=%u, L_gain=%.2f, M_gain=%.2f\n",
                      static_cast<unsigned>(tuningParams.revision),
                      tuningParams.lamp_gain_scale, tuningParams.mist_gain_scale);
    }
    else
    {
        Serial.println("[MAIN] ERROR: g_tuning_config_queue is null during hydration!");
    }
}
