#include "core/system_manager.h"
#include "core/sensors.h"
#include "core/actuator_controller.h"
#include "config.h"
#include "core/models.h"
#include "core/trajectory.h"
#include "core/adaptive_tuner.h"
#include "core/fuzzy_controller.h"
#include "core/actuator_controller.h"
#include "core/serial_mutex.h"
#include "core/storage.h"
#include "core/manual_control.h"
#include "core/protector.h"
#include "core/crop_profile_storage.h"
#include "core/light_schedule.h"
#include "core/time_confidence.h"
#include "core/offline_storage.h"
#include "network/mqtt_manager.h"
#include <ctime>

#ifndef UNIT_TEST
#include <Arduino.h>
#include <cmath>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <esp_task_wdt.h>
#else
#include "Arduino.h"
#include <cmath>
#include <time.h>
#endif

// ---------------------------------------------------------------------------
// FreeRTOS Queue and Event Group handles (defined here, declared in definitions.h)
// ---------------------------------------------------------------------------
QueueHandle_t xTelemetryQueue = nullptr;
QueueHandle_t xBaselineQueue  = nullptr;
QueueHandle_t xOverrideQueue  = nullptr;
QueueHandle_t xHardwareOverridePersistenceRequestQueue = nullptr;
QueueHandle_t xHardwareOverridePersistenceResultQueue = nullptr;
QueueHandle_t xActuatorOverrideQueue = nullptr;
QueueHandle_t g_control_event_queue = nullptr;
QueueHandle_t g_manual_request_queue = nullptr; // deprecated compatibility only
QueueHandle_t g_mqtt_override_queue = nullptr; // deprecated compatibility only
QueueHandle_t g_manual_ack_queue = nullptr;
QueueHandle_t g_operating_mode_ack_queue = nullptr;
QueueHandle_t g_profile_update_queue = nullptr;
QueueHandle_t g_tuning_config_queue = nullptr;
EventGroupHandle_t xWifiEventGroup = nullptr;

bool enqueueControlEvent(const ControlEvent& event)
{
    return g_control_event_queue != nullptr &&
           xQueueSend(g_control_event_queue, &event, 0) == pdTRUE;
}

config::OperatingMode getOperatingModeSnapshot()
{
    return config::GLOBAL_OPERATING_MODE;
}

volatile bool shared_forceFullPublish = false;
static PersistedCropProfile activeProfile;
static bool hasActiveProfile = false;
#ifndef UNIT_TEST
SemaphoreHandle_t xTelemetryMutex = nullptr;
#endif

bool getSharedForceFullPublish()
{
#ifndef UNIT_TEST
    if (xTelemetryMutex != nullptr)
    {
        if (xSemaphoreTake(xTelemetryMutex, portMAX_DELAY) == pdTRUE)
        {
            const bool val = shared_forceFullPublish;
            xSemaphoreGive(xTelemetryMutex);
            return val;
        }
    }
#endif
    return shared_forceFullPublish;
}

bool consumeSharedForceFullPublish()
{
#ifndef UNIT_TEST
    if (xTelemetryMutex != nullptr)
    {
        if (xSemaphoreTake(xTelemetryMutex, portMAX_DELAY) == pdTRUE)
        {
            const bool val = shared_forceFullPublish;
            shared_forceFullPublish = false;
            xSemaphoreGive(xTelemetryMutex);
            return val;
        }
    }
#endif
    const bool val = shared_forceFullPublish;
    shared_forceFullPublish = false;
    return val;
}

void setSharedForceFullPublish(bool val)
{
#ifndef UNIT_TEST
    if (xTelemetryMutex != nullptr)
    {
        if (xSemaphoreTake(xTelemetryMutex, portMAX_DELAY) == pdTRUE)
        {
            shared_forceFullPublish = val;
            xSemaphoreGive(xTelemetryMutex);
        }
        return;
    }
#endif
    shared_forceFullPublish = val;
}

#ifndef UNIT_TEST
SharedSystemState shared_systemState = {NAN, NAN, NAN, NAN, NAN, NAN, 0.0f, 0.0f, 0.0f, 0.0f, {false, false, false, false, false, false, {0, 0}}, ControlSource::SafeOffline, 0};
#else
static SharedSystemState shared_systemState = {NAN, NAN, NAN, NAN, NAN, NAN, 0.0f, 0.0f, 0.0f, 0.0f, {false, false, false, false, false, false, {0, 0}}, ControlSource::SafeOffline, 0};
#endif

void updateSharedSystemState(const SharedSystemState& state)
{
#ifndef UNIT_TEST
    if (xTelemetryMutex != nullptr)
    {
        if (xSemaphoreTake(xTelemetryMutex, portMAX_DELAY) == pdTRUE)
        {
            shared_systemState = state;
            xSemaphoreGive(xTelemetryMutex);
        }
        return;
    }
#endif
    shared_systemState = state;
}

SharedSystemState getSharedSystemState()
{
#ifndef UNIT_TEST
    if (xTelemetryMutex != nullptr)
    {
        if (xSemaphoreTake(xTelemetryMutex, portMAX_DELAY) == pdTRUE)
        {
            SharedSystemState state = shared_systemState;
            xSemaphoreGive(xTelemetryMutex);
            return state;
        }
    }
#endif
    return shared_systemState;
}


// ---------------------------------------------------------------------------
// Local constants — no heap allocation inside the infinite loop
// ---------------------------------------------------------------------------
// Sensor read / telemetry publish interval (ms). Sprint 2 uses a short mock
// interval so console output is observable during development; production will
// raise this to 5 minutes.
static constexpr unsigned long SENSOR_READ_INTERVAL_MS = 5000UL;

// ===========================================================================
// Track I: Hardware Button Task (BOOT/GPIO0) — runs on Core 1
// ===========================================================================
// Poll interval for debounced button sampling (ms).
static constexpr unsigned long BUTTON_POLL_INTERVAL_MS = 50UL;
// Time to hold BOOT to enter SoftAP provisioning portal (ms).
static constexpr unsigned long BUTTON_HOLD_SOFTAP_MS   = 5000UL;
// Time to hold BOOT to perform full factory reset (ms).
static constexpr unsigned long BUTTON_HOLD_FACTORY_MS  = 10000UL;

/**
 * @brief FreeRTOS task polling BOOT/GPIO0 for hardware WiFi reset.
 * @details Active-LOW with internal pull-up.
 *   • Hold ≥ 5 s → set WIFI_FORCE_PROVISION_BIT (forces SoftAP provisioning portal).
 *   • Hold ≥ 10 s → set WIFI_FACTORY_RESET_BIT (clears all NVS + restart).
 *   • Release before thresholds → cancel, no action taken.
 */
static void handleButtonPress(unsigned long& press_start_ms, bool& softap_triggered, bool& factory_triggered)
{
    press_start_ms = millis();
    softap_triggered = false;
    factory_triggered = false;
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[BUTTON_TASK] BOOT button pressed. Hold 5s for SoftAP, 10s for Factory Reset.");
    }
}

static void handleButtonRelease(unsigned long& press_start_ms, bool& softap_triggered, bool& factory_triggered)
{
    press_start_ms = 0;
    if (!softap_triggered && !factory_triggered) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[BUTTON_TASK] BOOT button released — cancelled.");
    }
    softap_triggered = false;
    factory_triggered = false;
}

static void handleButtonHold(unsigned long press_start_ms, bool& softap_triggered, bool& factory_triggered)
{
    unsigned long held_ms = millis() - press_start_ms;

    if (!factory_triggered && held_ms >= BUTTON_HOLD_FACTORY_MS)
    {
        factory_triggered = true;
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[BUTTON_TASK] >>> HOLD 10s REACHED — FACTORY RESET <<<");
        }
        if (xWifiEventGroup)
        {
            xEventGroupSetBits(xWifiEventGroup, WIFI_FACTORY_RESET_BIT);
        }
    }
    else if (!softap_triggered && !factory_triggered && held_ms >= BUTTON_HOLD_SOFTAP_MS)
    {
        softap_triggered = true;
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[BUTTON_TASK] >>> HOLD 5s REACHED — FORCING SOFTAP <<<");
        }
        if (xWifiEventGroup)
        {
            xEventGroupSetBits(xWifiEventGroup, WIFI_FORCE_PROVISION_BIT);
        }
    }
}

void taskHardwareButton(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[BUTTON_TASK] Starting on Core 1...");
    }

    bool prev_pressed = (digitalRead(config::pins::PIN_WIFI_CONFIG_BUTTON) == LOW);

#ifndef UNIT_TEST
    while (1)
#else
    for (int _iter = 0; _iter < 1; ++_iter)
#endif
    {
        bool now_pressed = (digitalRead(config::pins::PIN_WIFI_CONFIG_BUTTON) == LOW);

        static unsigned long press_start_ms = 0;
        static bool softap_triggered = false;
        static bool factory_triggered = false;

        if (!prev_pressed && now_pressed)
        {
            handleButtonPress(press_start_ms, softap_triggered, factory_triggered);
        }
        else if (prev_pressed && !now_pressed)
        {
            handleButtonRelease(press_start_ms, softap_triggered, factory_triggered);
        }
        else if (prev_pressed && now_pressed && press_start_ms != 0)
        {
            handleButtonHold(press_start_ms, softap_triggered, factory_triggered);
        }

        prev_pressed = now_pressed;

        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_INTERVAL_MS));
    }
}


// Physical relays are controlled only by the direct ON/OFF dispatcher below.

constexpr float CONTROL_PERIOD_SECONDS = 0.050f;
constexpr float SAFE_DEFAULT_CROP_DAY = 0.0f;

bool isFinite(float value)
{
    return std::isfinite(value);
}

// The local timezone is configured at boot. This sample is usable only while
// SNTP trust (or bounded holdover) remains valid; the safety helper fails closed.
relay_control::RtcTimePod readRtcTimeFailSafe()
{
#ifndef UNIT_TEST
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    
    if (time_conf::isTimeUsable()) {
        return relay_control::RtcTimePod{
            true,
            static_cast<uint8_t>(timeinfo.tm_hour),
            static_cast<uint8_t>(timeinfo.tm_min)
        };
    }
#endif
    return relay_control::RtcTimePod{false, 0U, 0U};
}

// ---------------------------------------------------------------------------
// Helper: sample sensors and enqueue telemetry without changing GPIO state.
// ---------------------------------------------------------------------------
static void sampleAndEnqueueTelemetry(TelemetryData& data, const RelayOutputsPod& actuators, bool ok)
{
    data.actuators = actuators;

    // Hiding periodic telemetry printing to avoid serial console spam during connection testing
    /*
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf(
            "[CORE1_TASK] Telemetry: temp_air=%.2f°C humidity=%.2f%% co2=%.2f ok=%d\n",
            data.temp_air,
            data.humidity_air,
            data.co2_level,
            static_cast<int>(ok));
    }
    */

    if (xTelemetryQueue != nullptr)
    {
        // Non-blocking send: telemetry must never stall real-time SSR control.
        const BaseType_t sent = xQueueSend(xTelemetryQueue, &data, 0);
        if (sent != pdTRUE)
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[CORE1_TASK] WARNING: Telemetry queue full — sample dropped.");
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers to decompose runControlPipelineStep (<50 lines)
// ---------------------------------------------------------------------------
static bool isValidBaselineCommand(const ControlSetpointCommand& cmd)
{
    if (!cmd.active) return true;
    return (std::isfinite(cmd.temp_target) && cmd.temp_target >= 10.0f && cmd.temp_target <= 45.0f &&
            std::isfinite(cmd.humidity_target) && cmd.humidity_target >= 30.0f && cmd.humidity_target <= 95.0f &&
            std::isfinite(cmd.co2_target) && cmd.co2_target >= 400.0f && cmd.co2_target <= 10000.0f);
}

static bool isValidOverrideCommand(const ControlSetpointCommand& cmd)
{
    if (!cmd.active) return true;
    return (std::isfinite(cmd.temp_target) && cmd.temp_target >= 20.0f && cmd.temp_target <= 40.0f &&
            std::isfinite(cmd.humidity_target) && cmd.humidity_target >= 50.0f && cmd.humidity_target <= 95.0f);
}

static float calculateCurrentCropDay()
{
    storage::StorageManager &storage = storage::StorageManager::get_instance();
    uint32_t start_time = 0;
    storage.load_start_epoch_time(start_time);

    time_t now = time(nullptr);
    bool ntp_valid = (now > 1600000000); // NTP synced if time is after 2020

    if (ntp_valid && start_time > 0 && now >= start_time)
    {
        uint32_t elapsed = now - start_time;
        // Periodically (e.g. every 5 minutes) write back to NVS to keep it fresh
        static unsigned long last_nvs_save = 0;
        if (millis() - last_nvs_save > 300000) // 5 minutes
        {
            last_nvs_save = millis();
            storage.save_elapsed_seconds(elapsed);
        }
        return (float)elapsed / 86400.0f;
    }
    else
    {
        // Offline autonomy path
        uint32_t stored_elapsed = 0;
        storage.load_elapsed_seconds(stored_elapsed);
        // Calculate elapsed seconds since boot
        uint32_t elapsed_since_boot = millis() / 1000;
        uint32_t total_elapsed = stored_elapsed + elapsed_since_boot;
        
        // Periodically save total_elapsed to NVS
        static unsigned long last_offline_save = 0;
        if (millis() - last_offline_save > 300000) // 5 minutes
        {
            last_offline_save = millis();
            storage.save_elapsed_seconds(total_elapsed);
        }
        
        return (float)total_elapsed / 86400.0f;
    }
}

static uint16_t getCurrentCropDay()
{
    if (time_conf::getTimeConfidence() == TimeConfidence::Uncertain)
    {
        return 0;
    }
    if (hasActiveProfile)
    {
        time_t now_epoch_s = time(nullptr);
        int64_t diff = now_epoch_s - activeProfile.crop_start_epoch_s;
        int32_t day_val = 1 + (diff / 86400);
        if (day_val < 1) day_val = 1;
        if (day_val > activeProfile.total_crop_days) day_val = activeProfile.total_crop_days;
        return static_cast<uint16_t>(day_val);
    }
    float currentDay = calculateCurrentCropDay();
    return static_cast<uint16_t>(currentDay);
}

static Trajectory::SetpointPod getControlSetpointsAndErrors(
    const TelemetryData& telemetry,
    const ControlSetpointCommand& baselineCmd,
    const ControlSetpointCommand& overrideCmd,
    float& errorTemp,
    float& errorHumid,
    float& errorCO2)
{
    Trajectory::SetpointPod setpoints;

    if (time_conf::getTimeConfidence() == TimeConfidence::Uncertain)
    {
        // B4: Uncertain boot fallback to safe offline profile
        setpoints.temp_target = config::safe_offline::TEMP_TARGET_C;
        setpoints.humidity_target = config::safe_offline::HUMIDITY_TARGET_RH;
        setpoints.co2_target = config::safe_offline::CO2_TARGET_PPM;
    }
    else
    {
        float currentDay = calculateCurrentCropDay();
        const Trajectory::SetpointPod trajectory =
            Trajectory::interpolateSetpoints(currentDay);

        float base_temp_target = trajectory.temp_target;
        float base_humidity_target = trajectory.humidity_target;

        if (hasActiveProfile)
        {
            uint16_t cropDay = getCurrentCropDay();
            float temp_t = 0.0f;
            float hum_t = 0.0f;
            if (Trajectory::interpolateSetpoint(cropDay, activeProfile, temp_t, hum_t))
            {
                base_temp_target = temp_t;
                base_humidity_target = hum_t;
            }
        }

        // Temperature Target Priority: override > baseline > trajectory/profile target
        if (overrideCmd.active && std::isfinite(overrideCmd.temp_target))
        {
            setpoints.temp_target = overrideCmd.temp_target;
        }
        else if (baselineCmd.active && std::isfinite(baselineCmd.temp_target))
        {
            setpoints.temp_target = baselineCmd.temp_target;
        }
        else
        {
            setpoints.temp_target = base_temp_target;
        }

        // Humidity Target Priority: override > baseline > trajectory/profile target
        if (overrideCmd.active && std::isfinite(overrideCmd.humidity_target))
        {
            setpoints.humidity_target = overrideCmd.humidity_target;
        }
        else if (baselineCmd.active && std::isfinite(baselineCmd.humidity_target))
        {
            setpoints.humidity_target = baselineCmd.humidity_target;
        }
        else
        {
            setpoints.humidity_target = base_humidity_target;
        }

        // CO2 Target Priority: override > baseline > trajectory Day 0
        if (overrideCmd.active && std::isfinite(overrideCmd.co2_target))
        {
            setpoints.co2_target = overrideCmd.co2_target;
        }
        else if (baselineCmd.active && std::isfinite(baselineCmd.co2_target))
        {
            setpoints.co2_target = baselineCmd.co2_target;
        }
        else
        {
            setpoints.co2_target = trajectory.co2_target;
        }
    }

    errorTemp = std::isfinite(telemetry.temp_air)
        ? setpoints.temp_target - telemetry.temp_air : NAN;
    errorHumid = std::isfinite(telemetry.humidity_air)
        ? setpoints.humidity_target - telemetry.humidity_air : NAN;
    errorCO2 = std::isfinite(telemetry.co2_level)
        ? setpoints.co2_target - telemetry.co2_level : NAN;
    return setpoints;
}

static void updateWebInterfaceState(
    const TelemetryData& telemetry,
    const Trajectory::SetpointPod& setpoints,
    const FuzzyController::ArbitratedOutputsPod& outputs,
    ControlSource controlSource,
    uint32_t configRevision)
{
    // Cập nhật trạng thái chia sẻ cho WebInterface
    SharedSystemState localState;
    localState.temp_air = telemetry.temp_air;
    localState.humidity_air = telemetry.humidity_air;
    localState.co2_level = telemetry.co2_level;
    localState.temp_target = setpoints.temp_target;
    localState.humidity_target = setpoints.humidity_target;
    localState.co2_target = setpoints.co2_target;
    localState.h_lamp_duty = outputs.HLamp;
    localState.h_wat_duty = outputs.HWat;
    localState.mist_duty = outputs.Mist;
    localState.exhaust_duty = outputs.Exh;
    localState.actuators = telemetry.actuators;
    localState.control_source = controlSource;
    localState.config_revision = configRevision;
    updateSharedSystemState(localState);
}

namespace {

void enqueueManualAck(const ManualAck& ack)
{
    if (g_manual_ack_queue != nullptr) {
        (void)xQueueSend(g_manual_ack_queue, &ack, 0);
    }
}

void enqueueOperatingModeAck(const OperatingModeAck& ack)
{
    if (g_operating_mode_ack_queue != nullptr) {
        (void)xQueueSend(g_operating_mode_ack_queue, &ack, 0);
    }
}

void clearAllManualOverrides(manual::ManualLatchArray& manualLatch)
{
    manual::resetAllManualLatchesOnAOffTransition(manualLatch);
    for (size_t i = 0; i < manualLatch.size(); ++i) {
        const AppChannel channel = static_cast<AppChannel>(i);
        storage::CropProfileStorage::getInstance().clearManualOverride(channel);
        if (channel == AppChannel::MIST || channel == AppChannel::FAN ||
            channel == AppChannel::LAMP) {
            cabinet_buttons::notify_latch_released(channel);
        }
    }
}

void applyManualControlEvent(
    const ManualRequest& request,
    uint32_t now,
    bool fuzzyEnabled,
    manual::ManualLatchArray& manualLatch,
    const TelemetryData& telemetry,
    const Trajectory::SetpointPod& setpoints,
    const protector::SystemProtector& protector)
{
    const relay_control::RtcTimePod rtcTime = readRtcTimeFailSafe();
    ManualDecision decision = manual::evaluateSafetyGate(
        request, telemetry, setpoints, rtcTime, getCurrentCropDay());

    if (decision == ManualDecision::Accepted && request.intent == AppIntent::FORCE_ON) {
        if (protector.isChannelLocked(request.channel, now)) {
            if (request.channel == AppChannel::LAMP) decision = ManualDecision::RejectedTemp;
            else if (request.channel == AppChannel::MIST) decision = ManualDecision::RejectedHumi;
            else decision = ManualDecision::RejectedLocked;
        }
    }

    ManualAck ack{};
    ack.channel = request.channel;
    ack.requested_intent = request.intent;
    ack.decision = decision;
    ack.release_reason = ManualReleaseReason::None;
    ack.time_confidence = time_conf::getTimeConfidence();
    ack.ack_ms = now;

    const size_t index = static_cast<size_t>(request.channel);
    if (decision == ManualDecision::Accepted) {
        manual::updateLatchOnAccepted(request, now, manualLatch, fuzzyEnabled);
        ack.effective_intent = request.intent;
        ack.expires_ms = index < manualLatch.size() ? manualLatch[index].expires_ms : 0U;
    } else if (index < manualLatch.size() && manualLatch[index].active) {
        ack.effective_intent = manualLatch[index].forced_state;
        ack.expires_ms = manualLatch[index].expires_ms;
    } else {
        ack.effective_intent = AppIntent::AUTO;
        ack.expires_ms = 0U;
    }
    enqueueManualAck(ack);
}

void applyOperatingModeControlEvent(
    const ControlEvent& event,
    uint32_t now,
    manual::ManualLatchArray& manualLatch)
{
    OperatingModeAck ack{};
    strncpy(ack.command_id, event.command_id, sizeof(ack.command_id) - 1U);
    ack.latency_ms = now - event.received_ms;

    const bool validMode = event.mode == static_cast<uint8_t>(config::OperatingMode::AI) ||
                           event.mode == static_cast<uint8_t>(config::OperatingMode::MANUAL);
    if (!validMode) {
        ack.success = false;
        strncpy(ack.error_code, "INVALID_OPERATING_MODE", sizeof(ack.error_code) - 1U);
        strncpy(ack.error_message, "mode must be AI or MANUAL", sizeof(ack.error_message) - 1U);
        enqueueOperatingModeAck(ack);
        return;
    }

    const config::OperatingMode nextMode = static_cast<config::OperatingMode>(event.mode);
    const config::OperatingMode previousMode = config::GLOBAL_OPERATING_MODE;
    if (!storage::StorageManager::get_instance().save_operating_mode(static_cast<uint8_t>(nextMode))) {
        ack.success = false;
        strncpy(ack.error_code, "PERSISTENCE_FAILED", sizeof(ack.error_code) - 1U);
        strncpy(ack.error_message, "Unable to persist operating mode", sizeof(ack.error_message) - 1U);
        enqueueOperatingModeAck(ack);
        return;
    }

    // Core 1 is the sole writer. Re-entering Fuzzy ON releases persistent
    // Fuzzy-OFF latches, while ON -> OFF deliberately keeps the final state.
    config::GLOBAL_OPERATING_MODE = nextMode;
    if (previousMode == config::OperatingMode::MANUAL &&
        nextMode == config::OperatingMode::AI) {
        clearAllManualOverrides(manualLatch);
    }
    setSharedForceFullPublish(true);
    ack.success = true;
    enqueueOperatingModeAck(ack);
}

void drainControlEvents(
    uint32_t now,
    const TelemetryData& telemetry,
    const Trajectory::SetpointPod& setpoints,
    manual::ManualLatchArray& manualLatch,
    const protector::SystemProtector& protector)
{
    if (g_control_event_queue == nullptr) return;

    ControlEvent event{};
    while (xQueueReceive(g_control_event_queue, &event, 0) == pdTRUE) {
        if (event.type == ControlEventType::OperatingMode) {
            applyOperatingModeControlEvent(event, now, manualLatch);
        } else if (event.type == ControlEventType::ManualRequest) {
            const bool fuzzyEnabled = config::GLOBAL_OPERATING_MODE == config::OperatingMode::AI &&
                                       config::FUZZY_CONTROL_ENABLED;
            applyManualControlEvent(event.manual, now, fuzzyEnabled, manualLatch, telemetry, setpoints, protector);
        }
    }
}

} // namespace

// ---------------------------------------------------------------------------
// FreeRTOS task entry point — pinned to Core 1
// ---------------------------------------------------------------------------
static void runControlPipelineStep(
    TelemetryData& telemetry,
    FuzzyController::CO2RuleState& co2State,
    AdaptiveTuner::IntegralState& tunerState,
    relay_control::RelayStatePod& relayState,
    DynamicTuningParams& s_activeTuning,
    ControlSetpointCommand& baselineCmd,
    ControlSetpointCommand& overrideCmd,
    manual::ManualLatchArray& manualLatch,
    unsigned long& lastSensorMs,
    unsigned long& lastControlMs)
{
    // Core 1 exclusively owns this local copy. Core 0 publishes validated POD
    // snapshots; adoption is non-blocking and happens only at a tick boundary.
    if (g_tuning_config_queue != nullptr)
    {
        DynamicTuningParams pendingTuning;
        if (xQueueReceive(g_tuning_config_queue, &pendingTuning, 0) == pdTRUE)
        {
            s_activeTuning = pendingTuning;
        }
    }

    // S4-C1: Adopt profile update only at beginning of a control tick
    if (g_profile_update_queue != nullptr)
    {
        PersistedCropProfile newProfile;
        if (xQueueReceive(g_profile_update_queue, &newProfile, 0) == pdTRUE)
        {
            activeProfile = newProfile;
            hasActiveProfile = true;
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[CORE1_TASK] Adopted new crop profile. Checkpoints: %u, Version: %u\n",
                          activeProfile.checkpoint_count, activeProfile.schema_version);
        }
    }
    // Non-blocking drain baseline and override queues at the beginning of tick 50 ms
    if (xBaselineQueue != nullptr)
    {
        ControlSetpointCommand temp;
        while (xQueueReceive(xBaselineQueue, &temp, 0) == pdTRUE)
        {
            if (isValidBaselineCommand(temp))
            {
                baselineCmd = temp;
            }
            else
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[CORE1_TASK] ERROR: Rejected invalid baseline command: T=%.2f, H=%.2f, CO2=%.2f\n",
                              temp.temp_target, temp.humidity_target, temp.co2_target);
            }
        }
    }
    if (xOverrideQueue != nullptr)
    {
        ControlSetpointCommand temp;
        while (xQueueReceive(xOverrideQueue, &temp, 0) == pdTRUE)
        {
            if (isValidOverrideCommand(temp))
            {
                overrideCmd = temp;
            }
            else
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[CORE1_TASK] ERROR: Rejected invalid override command: T=%.2f, H=%.2f, CO2=%.2f\n",
                              temp.temp_target, temp.humidity_target, temp.co2_target);
            }
        }
    }
    static bool bootControlSourceLogged = false;
    if (!bootControlSourceLogged)
    {
        bootControlSourceLogged = true;
        const char* source = overrideCmd.active ? "temporary-override" :
                             baselineCmd.active ? "baseline-nvs" :
                             hasActiveProfile ? "crop-profile" : "trajectory";
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[CONTROL] Boot state: active_source=%s baseline_active=%d profile_active=%d override_active=%d\n",
                      source, static_cast<int>(baselineCmd.active),
                      static_cast<int>(hasActiveProfile), static_cast<int>(overrideCmd.active));
    }

    if (xActuatorOverrideQueue != nullptr)
    {
        ActuatorOverrideCommand temp;
        while (xQueueReceive(xActuatorOverrideQueue, &temp, 0) == pdTRUE)
        {
            // Drained and ignored
        }
    }

    const unsigned long now = millis();
    static bool lastSensorReadOk = true;
    bool newSensorRead = false;
    if (lastSensorMs == 0U || (now - lastSensorMs) >= SENSOR_READ_INTERVAL_MS)
    {
        lastSensorReadOk = sensors::read_all_telemetry(telemetry);
        newSensorRead = true;
    }

    // Rate of change calculation for inertia compensation
    static float prevTemp = NAN;
    static float prevHumid = NAN;
    static float tempRateFiltered = 0.0f;
    static float humidRateFiltered = 0.0f;
    static unsigned long lastCalcMs = 0;

    if (newSensorRead && lastSensorReadOk)
    {
        if (std::isfinite(telemetry.temp_air) && std::isfinite(telemetry.humidity_air))
        {
            if (std::isfinite(prevTemp) && std::isfinite(prevHumid) && lastCalcMs != 0)
            {
                float dt = static_cast<float>(now - lastCalcMs) / 1000.0f;
                if (dt > 0.5f)
                {
                    float rawTempRate = (telemetry.temp_air - prevTemp) / dt;
                    float rawHumidRate = (telemetry.humidity_air - prevHumid) / dt;

                    constexpr float alpha = 0.3f;
                    tempRateFiltered = alpha * rawTempRate + (1.0f - alpha) * tempRateFiltered;
                    humidRateFiltered = alpha * rawHumidRate + (1.0f - alpha) * humidRateFiltered;
                }
            }
            prevTemp = telemetry.temp_air;
            prevHumid = telemetry.humidity_air;
            lastCalcMs = now;
        }
    }

    float errorTemp = NAN;
    float errorHumid = NAN;
    float errorCO2 = NAN;
    const Trajectory::SetpointPod setpoints =
        getControlSetpointsAndErrors(telemetry, baselineCmd, overrideCmd, errorTemp, errorHumid, errorCO2);

    // Apply inertia compensation to errorTemp and errorHumid
    if (std::isfinite(errorTemp))
    {
        float tempComp = telemetry.temp_air + config::control::K_INERTIA_TEMP * tempRateFiltered;
        errorTemp = setpoints.temp_target - tempComp;
    }
    if (std::isfinite(errorHumid))
    {
        float humidComp = telemetry.humidity_air + config::control::K_INERTIA_HUMID * humidRateFiltered;
        errorHumid = setpoints.humidity_target - humidComp;
    }

    const unsigned long elapsedMs = now - lastControlMs;
    lastControlMs = now;
    const float dtSeconds = (elapsedMs == 0U)
        ? CONTROL_PERIOD_SECONDS
        : static_cast<float>(elapsedMs) / 1000.0f;
    const AdaptiveTuner::GainsPod gains = AdaptiveTuner::updateGains(
        tunerState, errorTemp, errorHumid, dtSeconds);

    static protector::SystemProtector systemProtector;

    // All cross-core commands are applied by this Core-1-owned FIFO before
    // constructing the tick's base demand or entering SystemProtector.
    drainControlEvents(now, telemetry, setpoints, manualLatch, systemProtector);

    const config::OperatingMode operatingMode = config::GLOBAL_OPERATING_MODE;

    FuzzyController::ArbitratedOutputsPod outputs;
    const bool fuzzyEnabled = config::FUZZY_CONTROL_ENABLED &&
        operatingMode == config::OperatingMode::AI;
    if (fuzzyEnabled)
    {
        const FuzzyController::DualHeaterOutputsPod thermalDemands =
            FuzzyController::executeDualHeaterRules(errorTemp, errorHumid);
        const float co2Demand = FuzzyController::executeCO2Rules(co2State, errorCO2);
        // The arbiter applies adaptive gain and the two tuning scales before
        // its final clamp, then manual latches and safety protection follow.
        outputs = FuzzyController::arbitrateOutputs(
            thermalDemands,
            co2Demand,
            gains,
            s_activeTuning.lamp_gain_scale,
            s_activeTuning.mist_gain_scale);
    }
    else
    {
        // Fuzzy OFF retains the preceding final state as the base demand;
        // manual latches and the protector still arbitrate every relay.
        outputs = {
            relayState.lamp_active ? 1.0f : 0.0f,
            relayState.hwat_active ? 1.0f : 0.0f,
            relayState.mist_active ? 1.0f : 0.0f,
            relayState.fan_active ? 1.0f : 0.0f,
        };
    }

    const uint16_t cropDay = getCurrentCropDay();
    if (hasActiveProfile && !schedule::isLampAllowedBySchedule(cropDay, activeProfile)) {
        outputs.HLamp = 0.0f;
    }

    // E3: Apply manual latch to outputs (handles expiration, warnings, releases)
    const relay_control::RtcTimePod rtcTimeBeforeLatch = readRtcTimeFailSafe();

    manual::ManualLatchArray prevLatch = manualLatch;

    manual::applyManualLatchToOutputs(outputs, manualLatch, now, telemetry, setpoints, rtcTimeBeforeLatch, cropDay);

    // Check for auto-releases and push events
    for (size_t i = 0; i < manualLatch.size(); ++i) {
        if (prevLatch[i].active && !manualLatch[i].active) {
            storage::CropProfileStorage::getInstance().clearManualOverride(static_cast<AppChannel>(i));
            ManualReleaseReason reason = ManualReleaseReason::None;
            if (prevLatch[i].expires_ms != 0U &&
                static_cast<int32_t>(now - prevLatch[i].expires_ms) >= 0) {
                reason = ManualReleaseReason::TTLExpired;
            } else {
                reason = ManualReleaseReason::SafetyLimitReached;
            }

            ManualAck ack;
            ack.channel = static_cast<AppChannel>(i);
            ack.requested_intent = prevLatch[i].forced_state;
            ack.decision = ManualDecision::Accepted;
            ack.effective_intent = AppIntent::AUTO;
            ack.release_reason = reason;
            ack.time_confidence = time_conf::getTimeConfidence();
            ack.expires_ms = 0;
            ack.ack_ms = now;
            if (g_manual_ack_queue != nullptr) {
                xQueueSend(g_manual_ack_queue, &ack, 0);
            }
        }
    }

    const relay_control::RtcTimePod rtcTime = readRtcTimeFailSafe();
    
    // Apply hardware protection override to outputs before mapping direct demands
    relay_control::hardwareProtectionOverride(outputs, rtcTime);
    relay_control::applyDirectOutputs(outputs, s_activeTuning, relayState);

    // Run the SystemProtector safety gate to enforce cooldowns, bio-rules, and transitions
    systemProtector.update(
        now,
        fuzzyEnabled,
        telemetry.temp_air,
        telemetry.humidity_air,
        relay_control::isSafetyBlackoutActive(rtcTime),
        manualLatch,
        relayState
    );

    // Defense in depth at the final GPIO boundary. The interlock already ran
    // inside SystemProtector; enforcing it here guarantees a later code change
    // cannot accidentally bypass blackout rules.
    if (relay_control::isSafetyBlackoutActive(rtcTime)) {
        relayState.mist_active = false;
    }

    // Apply the final protected binary states to the physical active-LOW relays.
    relay_control::writeRelays(relayState);

    const RelayOutputsPod actuatorSnapshot = {
        relayState.mist_active,
        relayState.fan_active,
        relayState.lamp_active,  // lamp_stage_active
        false,                   // lamp_stage2_active (single-lamp hardware)
        relayState.hwat_active,
        relay_control::isSafetyBlackoutActive(rtcTime),
        {0, 0},
    };
    telemetry.actuators = actuatorSnapshot;

    // The ring stores only while MQTT is down. Sampling is fixed at 30 seconds
    // regardless of the faster control/sensor cadence.
    static unsigned long lastOfflineCaptureMs = 0;
    if (!mqtt::MqttManager::getInstance().isConnected() &&
        (lastOfflineCaptureMs == 0U || now - lastOfflineCaptureMs >= 30000UL))
    {
        offline_storage::OfflineStorage::getInstance().capture(
            telemetry.temp_air, telemetry.humidity_air,
            actuatorSnapshot.mist_active, actuatorSnapshot.lamp_stage_active,
            now / 1000UL);
        lastOfflineCaptureMs = now;
    }

    static RelayOutputsPod lastEnqueuedActuators = {false, false, false, false, false, false, {0, 0}};
    const bool actuatorChanged =
        actuatorSnapshot.mist_active != lastEnqueuedActuators.mist_active ||
        actuatorSnapshot.fan_active != lastEnqueuedActuators.fan_active ||
        actuatorSnapshot.lamp_stage_active != lastEnqueuedActuators.lamp_stage_active ||
        actuatorSnapshot.lamp_stage2_active != lastEnqueuedActuators.lamp_stage2_active ||
        actuatorSnapshot.heater_water_active != lastEnqueuedActuators.heater_water_active ||
        actuatorSnapshot.midday_blackout_active != lastEnqueuedActuators.midday_blackout_active;
    if (lastSensorMs == 0U || (now - lastSensorMs) >= SENSOR_READ_INTERVAL_MS || actuatorChanged)
    {
        if (lastSensorMs == 0U || (now - lastSensorMs) >= SENSOR_READ_INTERVAL_MS)
        {
            lastSensorMs = now;
        }
        sampleAndEnqueueTelemetry(telemetry, actuatorSnapshot, lastSensorReadOk);
        lastEnqueuedActuators = actuatorSnapshot;
        if (actuatorChanged)
        {
            // Core 0 publishes this final, protector-resolved relay snapshot immediately.
            setSharedForceFullPublish(true);
        }
    }

    const ControlSource controlSource =
        time_conf::getTimeConfidence() == TimeConfidence::Uncertain ? ControlSource::SafeOffline :
        (overrideCmd.active ? ControlSource::TemporaryOverride :
        (baselineCmd.active ? ControlSource::BaselineSetpoint :
        (hasActiveProfile ? ControlSource::CropProfile : ControlSource::Trajectory)));
    const uint32_t configRevision =
        controlSource == ControlSource::BaselineSetpoint ? getBaselineConfigRevision() :
        controlSource == ControlSource::CropProfile ? getProfileConfigRevision() : 0;
    static ControlSource lastLoggedSource = ControlSource::SafeOffline;
    static uint32_t lastLoggedRevision = UINT32_MAX;
    if (controlSource != lastLoggedSource || configRevision != lastLoggedRevision)
    {
        lastLoggedSource = controlSource;
        lastLoggedRevision = configRevision;
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[CONTROL] Active setpoint: T=%.2f H=%.2f source=%s rev=%lu\n",
                      setpoints.temp_target, setpoints.humidity_target,
                      controlSourceName(controlSource), static_cast<unsigned long>(configRevision));
    }
    updateWebInterfaceState(telemetry, setpoints, outputs, controlSource, configRevision);
}

void taskCore1Control(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE1_TASK] Starting direct ON/OFF control pipeline on Core 1...");
    }

    // GPIO is initialized HIGH (OFF) before this task accepts any demand.
    sensors::init_sensors_placeholder();
    actuators::init_actuators_gpio();

    // Core 1 owns the mode mirror from initialization onward.
    uint8_t persistedMode = static_cast<uint8_t>(config::OperatingMode::AI);
    if (storage::StorageManager::get_instance().load_operating_mode(persistedMode) &&
        persistedMode == static_cast<uint8_t>(config::OperatingMode::MANUAL)) {
        config::GLOBAL_OPERATING_MODE = config::OperatingMode::MANUAL;
    } else {
        config::GLOBAL_OPERATING_MODE = config::OperatingMode::AI;
    }

    // Load persisted crop profile once on boot
    hasActiveProfile = storage::CropProfileStorage::getInstance().loadProfile(activeProfile);
    if (hasActiveProfile) {
        uint32_t revision = 0;
        storage::CropProfileStorage::getInstance().loadProfileConfigRevision(revision);
        setProfileConfigRevision(revision);
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[CORE1_TASK] Loaded crop profile from NVS successfully. Checkpoints: %u, Version: %u\n",
                      activeProfile.checkpoint_count, activeProfile.schema_version);
    } else {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE1_TASK] No persisted crop profile found.");
    }

    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[CONTROL] Profile active=%d; baseline and override will be reported after NVS hydration.\n",
                      static_cast<int>(hasActiveProfile));
    }

#ifndef UNIT_TEST
    if (esp_task_wdt_add(nullptr) != ESP_OK)
    {
        Serial.println("[CORE1_TASK] WARNING: Failed to register Core 1 task with Task WDT.");
    }
#endif

    TelemetryData telemetry = {NAN, NAN, NAN, {false, false, false, false, false, false, {0, 0}}};
    FuzzyController::CO2RuleState co2State = FuzzyController::makeInitialCO2State();
    AdaptiveTuner::IntegralState tunerState = AdaptiveTuner::makeInitialState();
    relay_control::RelayStatePod relayState = {false, false, false, false};
    DynamicTuningParams s_activeTuning{};
    s_activeTuning.lamp_gain_scale = 1.0f;
    s_activeTuning.mist_gain_scale = 1.0f;
    s_activeTuning.mist_on_threshold = 0.25f;
    s_activeTuning.mist_off_threshold = 0.15f;
    ControlSetpointCommand baselineCmd = {NAN, NAN, NAN, false, {0, 0, 0}};
    ControlSetpointCommand overrideCmd = {NAN, NAN, NAN, false, {0, 0, 0}};
    manual::ManualLatchArray manualLatch{};
    
    // Manual latches never survive reboot: relays start fail-safe OFF.
    for (size_t i = 0; i < manualLatch.size(); ++i) {
        storage::CropProfileStorage::getInstance().clearManualOverride(static_cast<AppChannel>(i));
    }
    unsigned long lastSensorMs = 0U;
    unsigned long lastControlMs = millis();

#ifndef UNIT_TEST
    while (true)
#else
    // Host unit-test path executes exactly one complete pipeline iteration.
    for (int iteration = 0; iteration < 1; ++iteration)
#endif
    {
        runControlPipelineStep(
            telemetry,
            co2State,
            tunerState,
            relayState,
            s_activeTuning,
            baselineCmd,
            overrideCmd,
            manualLatch,
            lastSensorMs,
            lastControlMs);

#ifndef UNIT_TEST
        esp_task_wdt_reset();
#endif
        // Required yielding point: no delay(), no busy wait, and no heap work.
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
