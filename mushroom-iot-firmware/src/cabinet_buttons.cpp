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
    uint8_t history;       // 8-bit history for shift-register integration
    bool current_state;    // Debounced state (active-LOW: true = released, false = pressed)
    AppChannel channel;    // Corresponding control channel
};

static ButtonState buttons[] = {
    { config::hardware::PIN_BTN_MIST, 0xFF, true, AppChannel::MIST },
    { config::hardware::PIN_BTN_FAN,  0xFF, true, AppChannel::FAN  },
    { config::hardware::PIN_BTN_LAMP, 0xFF, true, AppChannel::LAMP }
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

            if (g_manual_request_queue != nullptr) {
                ManualRequest req;
                req.channel = btn.channel;
                req.intent = AppIntent::FORCE_ON;
                req.request_ms = millis();
                xQueueSend(g_manual_request_queue, &req, 0);
            }

            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[BUTTON] Debounced PRESS on Channel %d\n", static_cast<int>(btn.channel));
        }
        else if (btn.history == 0xFF && btn.current_state == false) {
            // 8 consecutive HIGH samples -> stable RELEASE
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
