#include "definitions.h"
#include "sensors.h"
#include "actuators.h"
#include "config.h"
#include "models.h"
#include "serial_mutex.h"

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#else
#include "Arduino.h"
#endif

// ---------------------------------------------------------------------------
// FreeRTOS Queue handles (defined here, declared in definitions.h)
// ---------------------------------------------------------------------------
QueueHandle_t xActuatorQueue  = nullptr;
QueueHandle_t xTelemetryQueue = nullptr;

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

// Relay pin table used for the periodic demo toggle (mock exercise only).
// Exposed via extern for unit-test visibility.
extern const uint8_t DEMO_RELAY_PINS[];
extern const size_t  DEMO_RELAY_COUNT;

const uint8_t DEMO_RELAY_PINS[] = {
    config::pins::PIN_RELAY_MIST,
    config::pins::PIN_RELAY_FAN,
    config::pins::PIN_RELAY_HEATER_1,
    config::pins::PIN_RELAY_HEATER_2
};
const size_t DEMO_RELAY_COUNT =
    sizeof(DEMO_RELAY_PINS) / sizeof(DEMO_RELAY_PINS[0]);

// ---------------------------------------------------------------------------
// Helper: drain all pending ActuatorCommand items from the queue
// ---------------------------------------------------------------------------
static void process_actuator_commands()
{
    if (xActuatorQueue == nullptr)
    {
        return;
    }

    ActuatorCommand cmd;
    // Drain every pending command without blocking
    while (xQueueReceive(xActuatorQueue, &cmd, ACTUATOR_QUEUE_WAIT_TICKS) == pdTRUE)
    {
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf(
                "[CORE1_TASK] ActuatorCommand received: pin=%u state=%s\n",
                static_cast<unsigned>(cmd.relay_id),
                cmd.state ? "ON" : "OFF"
            );
        }
        bool applied = actuators::set_relay_state(cmd.relay_id, cmd.state);
        if (!applied)
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf(
                "[CORE1_TASK] WARNING: ActuatorCommand with invalid pin=%u was rejected.\n",
                static_cast<unsigned>(cmd.relay_id)
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: read all sensors and optionally push TelemetryData into the queue
// ---------------------------------------------------------------------------
static void sample_and_enqueue_telemetry()
{
    // Stack-allocated POD — no malloc/new inside the loop
    TelemetryData data = {};

    bool ok = sensors::read_all_telemetry(data);

    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf(
            "[CORE1_TASK] Telemetry: temp_air=%.2f°C  temp_sub=%.2f°C  humidity=%.2f%%  co2=%.1fppm  ok=%d\n",
            data.temp_air,
            data.temp_substrate,
            data.humidity_air,
            data.co2_level,
            static_cast<int>(ok)
        );
    }

    if (xTelemetryQueue != nullptr)
    {
        // Non-blocking send; drop the sample if the queue is full rather than
        // stalling the real-time control loop.
        BaseType_t sent = xQueueSend(xTelemetryQueue, &data, 0);
        if (sent != pdTRUE)
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[CORE1_TASK] WARNING: Telemetry queue full — sample dropped.");
        }
    }
}

// ---------------------------------------------------------------------------
// FreeRTOS task entry point — pinned to Core 1
// ---------------------------------------------------------------------------
void task_core1_control(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE1_TASK] Starting task_core1_control on Core 1...");
    }

    // 1. Initialise HAL layers (safe to call once; idempotent for mock)
    sensors::init_sensors_placeholder();
    actuators::init_actuators_gpio();

    // Demo toggle state (stack-local, no heap)
    size_t demo_relay_idx = 0;
    bool   demo_state     = false;
    unsigned long last_sensor_ms = 0;

    #ifndef UNIT_TEST
    while (1)
    #else
    // Host unit-test path: execute a single iteration then return
    for (int _iter = 0; _iter < 1; ++_iter)
    #endif
    {
        // --- Priority path: drain actuator commands from Core 0 -------------
        // Commands must be applied immediately for real-time responsiveness.
        process_actuator_commands();

        // --- Periodic path: sample sensors every SENSOR_READ_INTERVAL_MS ----
        unsigned long now = millis();
        if ((now - last_sensor_ms) >= SENSOR_READ_INTERVAL_MS || last_sensor_ms == 0)
        {
            last_sensor_ms = now;
            sample_and_enqueue_telemetry();

            // Sprint-2 mock exercise: cycle one relay ON/OFF so Serial output
            // proves the actuator path is live without needing a real Core-0
            // command.  This block will be replaced by fuzzy-logic control later.
            demo_state = !demo_state;
            uint8_t pin = DEMO_RELAY_PINS[demo_relay_idx];
            actuators::set_relay_state(pin, demo_state);
            demo_relay_idx = (demo_relay_idx + 1) % DEMO_RELAY_COUNT;
        }

        // --- Stack High Water Mark (every ~5 s, same cadence as Core 0) ----
        #ifndef UNIT_TEST
        static unsigned long last_stack_log = 0;
        if (now - last_stack_log >= 5000UL)
        {
            last_stack_log = now;
            ScopedSerialLock guard(SerialLock::get_instance());
            UBaseType_t hwm = uxTaskGetStackHighWaterMark(nullptr);
            Serial.printf("[CORE1_TASK] Stack High Water Mark: %u words\n",
                          static_cast<unsigned>(hwm));
        }
        #endif

        // Feed the Watchdog and yield to other Core-1 tasks
        #ifndef UNIT_TEST
        vTaskDelay(pdMS_TO_TICKS(50)); // 50 ms — higher cadence than Core 0
        #endif
    }
}
