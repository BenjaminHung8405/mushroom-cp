#include "definitions.h"
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

namespace cabinet_buttons {

struct ButtonState {
    uint8_t pin;
    uint8_t history;           // 8-bit history for shift-register integration
    bool current_state;        // Debounced state (active-LOW: true = released, false = pressed)
    AppChannel channel;        // Corresponding control channel
    AppIntent next_intent;     // Toggle state: alternates FORCE_ON ↔ AUTO on each press
};

static ButtonState buttons[] = {
    { config::hardware::PIN_BTN_MIST, 0xFF, true, AppChannel::MIST, AppIntent::FORCE_ON },
    { config::hardware::PIN_BTN_FAN,  0xFF, true, AppChannel::FAN,  AppIntent::FORCE_ON },
    { config::hardware::PIN_BTN_LAMP, 0xFF, true, AppChannel::LAMP, AppIntent::FORCE_ON }
};

void process_cabinet_buttons()
{
    for (auto &btn : buttons) {
        // Read active-LOW physical state (true = HIGH/released, false = LOW/pressed)
        bool raw_sample = (digitalRead(btn.pin) == HIGH);

        // Shift history register
        btn.history = (btn.history << 1) | (raw_sample ? 1 : 0);

        // Check debounced state transition
        if (btn.history == 0x00 && btn.current_state == true) {
            // 8 consecutive LOW samples -> stable PRESS
            btn.current_state = false;

            // Capture current intent before flipping, then toggle for next press
            AppIntent intent_to_send = btn.next_intent;
            btn.next_intent = (intent_to_send == AppIntent::FORCE_ON)
                              ? AppIntent::AUTO
                              : AppIntent::FORCE_ON;

            if (g_manual_request_queue != nullptr) {
                ManualRequest req;
                req.channel = btn.channel;
                req.intent = intent_to_send;
                req.request_ms = millis();
                xQueueSend(g_manual_request_queue, &req, 0);
            }

            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[BUTTON] Debounced PRESS on Channel %d → intent=%d (next=%d)\n",
                          static_cast<int>(btn.channel),
                          static_cast<int>(intent_to_send),
                          static_cast<int>(btn.next_intent));
        }
        else if (btn.history == 0xFF && btn.current_state == false) {
            // 8 consecutive HIGH samples -> stable RELEASE (no request sent; toggle is latch-based)
            btn.current_state = true;

            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[BUTTON] Debounced RELEASE on Channel %d\n", static_cast<int>(btn.channel));
        }
    }
}

void reset_for_test()
{
    for (auto &btn : buttons) {
        btn.history = 0xFF;
        btn.current_state = true;
        btn.next_intent = AppIntent::FORCE_ON;  // Reset toggle state
    }
}

void notify_latch_released(AppChannel channel)
{
    for (auto &btn : buttons) {
        if (btn.channel == channel) {
            // Latch was auto-released externally (TTL/safety). Reset toggle so the
            // next physical press sends FORCE_ON, not a stale AUTO.
            btn.next_intent = AppIntent::FORCE_ON;
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[BUTTON] Latch released on Channel %d → next_intent reset to FORCE_ON\n",
                          static_cast<int>(channel));
            return;
        }
    }
}

} // namespace cabinet_buttons

#ifndef UNIT_TEST
void taskCabinetButtons(void* pvParameters)
{
    (void)pvParameters;

    // Hard configure GPIO with internal Pull-up
    for (auto &btn : cabinet_buttons::buttons) {
        pinMode(btn.pin, INPUT_PULLUP);
    }

    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xFrequency = pdMS_TO_TICKS(10); // 10ms sampling interval

    while (true) {
        cabinet_buttons::process_cabinet_buttons();
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
    }
}
#endif
