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
#endif

// ---------------------------------------------------------------------------
// FreeRTOS Queue and Event Group handles (defined here, declared in definitions.h)
// ---------------------------------------------------------------------------
QueueHandle_t xActuatorQueue  = nullptr;
QueueHandle_t xTelemetryQueue = nullptr;
EventGroupHandle_t xWifiEventGroup = nullptr;

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
void task_hardware_button(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[BUTTON_TASK] Starting on Core 1...");
    }

    // Pre-read to confirm initial state (avoid false trigger at startup).
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
            // Rising edge — button just pressed. Start timer.
            press_start_ms = millis();
            softap_triggered = false;
            factory_triggered = false;
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[BUTTON_TASK] BOOT button pressed. Hold 5s for SoftAP, 10s for Factory Reset.");
            }
        }
        else if (prev_pressed && !now_pressed)
        {
            // Falling edge — button released. Cancel pending actions.
            press_start_ms = 0;
            if (!softap_triggered && !factory_triggered) {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[BUTTON_TASK] BOOT button released — cancelled.");
            }
            softap_triggered = false;
            factory_triggered = false;
        }
        else if (prev_pressed && now_pressed && press_start_ms != 0)
        {
            // Button is being held — check durations.
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

        prev_pressed = now_pressed;

        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_INTERVAL_MS));
    }
}


// Physical SSR assignments. The TPC layer is the exclusive owner of their
// HIGH/LOW phase; no other Core 1 path writes these output pins after init.
constexpr TPC_Task::TpcChannelConfig H_AIR_TPC_CONFIG = {
    config::pins::PIN_RELAY_HEATER_1, 60000U, 2000U, 2000U};
constexpr TPC_Task::TpcChannelConfig H_WAT_TPC_CONFIG = {
    config::pins::PIN_RELAY_HEATER_2, 60000U, 2000U, 2000U};
constexpr TPC_Task::TpcChannelConfig MIST_TPC_CONFIG = {
    config::pins::PIN_RELAY_MIST, 60000U, 2000U, 2000U};
constexpr TPC_Task::TpcChannelConfig EXHAUST_TPC_CONFIG = {
    config::pins::PIN_RELAY_FAN, 60000U, 2000U, 2000U};

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
    return TPC_Task::RtcTimePod{false, 0U, 0U};
}

// ---------------------------------------------------------------------------
// Helper: sample sensors and enqueue telemetry without changing GPIO state.
// ---------------------------------------------------------------------------
static void sample_and_enqueue_telemetry(TelemetryData& data)
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
static void drain_legacy_actuator_queue()
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
// FreeRTOS task entry point — pinned to Core 1
// ---------------------------------------------------------------------------
void task_core1_control(void* /*pvParameters*/)
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
    unsigned long lastSensorMs = 0U;
    unsigned long lastControlMs = millis();

#ifndef UNIT_TEST
    while (true)
#else
    // Host unit-test path executes exactly one complete pipeline iteration.
    for (int iteration = 0; iteration < 1; ++iteration)
#endif
    {
        const unsigned long now = millis();
        if (lastSensorMs == 0U || (now - lastSensorMs) >= SENSOR_READ_INTERVAL_MS)
        {
            lastSensorMs = now;
            sample_and_enqueue_telemetry(telemetry);
        }

        // The growth-day source is not yet provisioned. Day 0 is an explicit,
        // deterministic safe default rather than inventing time-derived state.
        const Trajectory::SetpointPod setpoints =
            Trajectory::interpolateSetpoints(SAFE_DEFAULT_CROP_DAY);
        const float errorTemp = isFinite(telemetry.temp_air)
            ? setpoints.temp_target - telemetry.temp_air : NAN;
        const float errorHumid = isFinite(telemetry.humidity_air)
            ? setpoints.humidity_target - telemetry.humidity_air : NAN;
        const float errorCO2 = isFinite(telemetry.co2_level)
            ? setpoints.co2_target - telemetry.co2_level : NAN;

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

        drain_legacy_actuator_queue();

#ifndef UNIT_TEST
        esp_task_wdt_reset();
#endif
        // Required yielding point: no delay(), no busy wait, and no heap work.
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
