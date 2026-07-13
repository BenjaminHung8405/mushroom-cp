#include "definitions.h"
#include "sensors.h"
#include "actuators.h"
#include "config.h"
#include "models.h"
#include "Trajectory.h"
#include "AdaptiveTuner.h"
#include "FuzzyController.h"
#include "TPC_Task.h"
#include "serial_mutex.h"

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
QueueHandle_t xActuatorQueue  = nullptr;
QueueHandle_t xTelemetryQueue = nullptr;
QueueHandle_t xBaselineQueue  = nullptr;
QueueHandle_t xOverrideQueue  = nullptr;
EventGroupHandle_t xWifiEventGroup = nullptr;

volatile bool shared_forceFullPublish = false;
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
SharedSystemState shared_systemState = {NAN, NAN, NAN, NAN, NAN, NAN, 0.0f, 0.0f, 0.0f, 0.0f};
#else
static SharedSystemState shared_systemState = {NAN, NAN, NAN, NAN, NAN, NAN, 0.0f, 0.0f, 0.0f, 0.0f};
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

// How long to wait when draining the actuator command queue each tick.
// Non-blocking (0) so the task never stalls waiting for Core 0.
static constexpr TickType_t ACTUATOR_QUEUE_WAIT_TICKS = 0;

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


// Physical SSR assignments. The TPC layer is the exclusive owner of their
// HIGH/LOW phase; no other Core 1 path writes these output pins after init.
constexpr TPC_Task::TpcChannelConfig H_AIR_TPC_CONFIG = {
    config::pins::PIN_RELAY_HEATER_1, 300000U, 10000U, 10000U, 0U};
constexpr TPC_Task::TpcChannelConfig H_WAT_TPC_CONFIG = {
    config::pins::PIN_RELAY_HEATER_2, 300000U, 10000U, 10000U, 3000U};
constexpr TPC_Task::TpcChannelConfig MIST_TPC_CONFIG = {
    config::pins::PIN_RELAY_MIST, 300000U, 5000U, 10000U, 8000U};
constexpr TPC_Task::TpcChannelConfig EXHAUST_TPC_CONFIG = {
    config::pins::PIN_RELAY_FAN, 120000U, 3000U, 3000U, 0U};

constexpr float CONTROL_PERIOD_SECONDS = 0.050f;
constexpr float SAFE_DEFAULT_CROP_DAY = 0.0f;

bool isFinite(float value)
{
    return std::isfinite(value);
}

// RTC integration is intentionally fail-safe until an RTC/NTP provider is
// wired into Core 1. An invalid sample makes hardwareProtectionOverride()
// force HWat and Mist OFF, as required by the biosafety hard rule.
TPC_Task::RtcTimePod readRtcTimeFailSafe()
{
#ifndef UNIT_TEST
    time_t now;
    struct tm timeinfo;
    time(&now);
    localtime_r(&now, &timeinfo);
    
    // Check if the system time is synchronized. If not synced, year will be 1970 (tm_year = 70)
    // We assume any year >= 2026 is synced since current local time is 2026.
    if (timeinfo.tm_year >= (2026 - 1900))
    {
        return TPC_Task::RtcTimePod{
            true, 
            static_cast<uint8_t>(timeinfo.tm_hour), 
            static_cast<uint8_t>(timeinfo.tm_min)
        };
    }
#endif
    return TPC_Task::RtcTimePod{false, 0U, 0U};
}

// ---------------------------------------------------------------------------
// Helper: sample sensors and enqueue telemetry without changing GPIO state.
// ---------------------------------------------------------------------------
static void sampleAndEnqueueTelemetry(TelemetryData& data)
{
    const bool ok = sensors::read_all_telemetry(data);

    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf(
            "[CORE1_TASK] Telemetry: temp_air=%.2f°C humidity=%.2f%% co2=%.2f ok=%d\n",
            data.temp_air,
            data.humidity_air,
            data.co2_level,
            static_cast<int>(ok));
    }

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
// Helper: drain legacy commands without allowing them to bypass the pipeline.
// ---------------------------------------------------------------------------
static void drainLegacyActuatorQueue()
{
    if (xActuatorQueue == nullptr)
    {
        return;
    }

    ActuatorCommand cmd;
    while (xQueueReceive(xActuatorQueue, &cmd, ACTUATOR_QUEUE_WAIT_TICKS) == pdTRUE)
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf(
            "[CORE1_TASK] Dropped legacy ActuatorCommand pin=%u; TPC pipeline owns SSRs.\n",
            static_cast<unsigned>(cmd.relay_id));
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

static Trajectory::SetpointPod getControlSetpointsAndErrors(
    const TelemetryData& telemetry,
    const ControlSetpointCommand& baselineCmd,
    const ControlSetpointCommand& overrideCmd,
    float& errorTemp,
    float& errorHumid,
    float& errorCO2)
{
    const Trajectory::SetpointPod trajectory =
        Trajectory::interpolateSetpoints(SAFE_DEFAULT_CROP_DAY);

    Trajectory::SetpointPod setpoints;

    // Temperature Target Priority: override > baseline > trajectory Day 0
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
        setpoints.temp_target = trajectory.temp_target;
    }

    // Humidity Target Priority: override > baseline > trajectory Day 0
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
        setpoints.humidity_target = trajectory.humidity_target;
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
    const FuzzyController::ArbitratedOutputsPod& outputs)
{
    // Cập nhật trạng thái chia sẻ cho WebInterface
    SharedSystemState localState;
    localState.temp_air = telemetry.temp_air;
    localState.humidity_air = telemetry.humidity_air;
    localState.co2_level = telemetry.co2_level;
    localState.temp_target = setpoints.temp_target;
    localState.humidity_target = setpoints.humidity_target;
    localState.co2_target = setpoints.co2_target;
    localState.h_air_duty = outputs.HAir;
    localState.h_wat_duty = outputs.HWat;
    localState.mist_duty = outputs.Mist;
    localState.exhaust_duty = outputs.Exh;
    updateSharedSystemState(localState);
}

// ---------------------------------------------------------------------------
// FreeRTOS task entry point — pinned to Core 1
// ---------------------------------------------------------------------------
static void runControlPipelineStep(
    TelemetryData& telemetry,
    FuzzyController::CO2RuleState& co2State,
    AdaptiveTuner::IntegralState& tunerState,
    TPC_Task::TpcSchedulerState& tpcState,
    ControlSetpointCommand& baselineCmd,
    ControlSetpointCommand& overrideCmd,
    unsigned long& lastSensorMs,
    unsigned long& lastControlMs)
{
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

    const unsigned long now = millis();
    if (lastSensorMs == 0U || (now - lastSensorMs) >= SENSOR_READ_INTERVAL_MS)
    {
        lastSensorMs = now;
        sampleAndEnqueueTelemetry(telemetry);
    }

    float errorTemp = NAN;
    float errorHumid = NAN;
    float errorCO2 = NAN;
    const Trajectory::SetpointPod setpoints =
        getControlSetpointsAndErrors(telemetry, baselineCmd, overrideCmd, errorTemp, errorHumid, errorCO2);

    const unsigned long elapsedMs = now - lastControlMs;
    lastControlMs = now;
    const float dtSeconds = (elapsedMs == 0U)
        ? CONTROL_PERIOD_SECONDS
        : static_cast<float>(elapsedMs) / 1000.0f;
    const AdaptiveTuner::GainsPod gains = AdaptiveTuner::updateGains(
        tunerState, errorTemp, errorHumid, dtSeconds);
    const FuzzyController::DualHeaterOutputsPod thermalDemands =
        FuzzyController::executeDualHeaterRules(errorTemp, errorHumid);
    const float co2Demand = FuzzyController::executeCO2Rules(co2State, errorCO2);
    FuzzyController::ArbitratedOutputsPod outputs =
        FuzzyController::arbitrateOutputs(thermalDemands, co2Demand, gains);

    // Mandatory ordering: all fuzzy/gain work completes before this hard
    // interlock, then only TPC translates protected duties to GPIO levels.
    TPC_Task::hardwareProtectionOverride(outputs, readRtcTimeFailSafe());
    TPC_Task::applyTpcOutputs(
        outputs,
        H_AIR_TPC_CONFIG,
        H_WAT_TPC_CONFIG,
        MIST_TPC_CONFIG,
        EXHAUST_TPC_CONFIG,
        tpcState);

    updateWebInterfaceState(telemetry, setpoints, outputs);

    drainLegacyActuatorQueue();
}

void taskCore1Control(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE1_TASK] Starting TPC control pipeline on Core 1...");
    }

    // GPIO is initialized LOW before this task accepts any demand.
    sensors::init_sensors_placeholder();
    actuators::init_actuators_gpio();

#ifndef UNIT_TEST
    if (esp_task_wdt_add(nullptr) != ESP_OK)
    {
        Serial.println("[CORE1_TASK] WARNING: Failed to register Core 1 task with Task WDT.");
    }
#endif

    TelemetryData telemetry = {NAN, NAN, NAN};
    FuzzyController::CO2RuleState co2State = FuzzyController::makeInitialCO2State();
    AdaptiveTuner::IntegralState tunerState = AdaptiveTuner::makeInitialState();
    TPC_Task::TpcSchedulerState tpcState = TPC_Task::makeInitialSchedulerState();
    ControlSetpointCommand baselineCmd = {NAN, NAN, NAN, false, {0, 0, 0}};
    ControlSetpointCommand overrideCmd = {NAN, NAN, NAN, false, {0, 0, 0}};
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
            tpcState,
            baselineCmd,
            overrideCmd,
            lastSensorMs,
            lastControlMs);

#ifndef UNIT_TEST
        esp_task_wdt_reset();
#endif
        // Required yielding point: no delay(), no busy wait, and no heap work.
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
