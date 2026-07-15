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

namespace cabinet_buttons
{

    static constexpr uint16_t CL = 50;
    static constexpr uint16_t CH = 200;

    struct ButtonState
    {
        uint8_t pin;
        uint16_t k;            // Debounce counter
        bool current_state;    // Debounced state (active-LOW: true = released, false = pressed)
        AppChannel channel;    // Corresponding control channel
        AppIntent next_intent; // Toggle state: alternates FORCE_ON ↔ AUTO on each press
    };

    static ButtonState buttons[] = {
        {config::hardware::PIN_BTN_MIST, 0, true, AppChannel::MIST, AppIntent::FORCE_ON},
        {config::hardware::PIN_BTN_FAN, 0, true, AppChannel::FAN, AppIntent::FORCE_ON},
        {config::hardware::PIN_BTN_LAMP, 0, true, AppChannel::LAMP, AppIntent::FORCE_ON}};

    void process_cabinet_buttons()
    {
        for (auto &btn : buttons)
        {
            // Read active-LOW physical state (LOW = pressed, HIGH = released)
            bool pin_is_low = (digitalRead(btn.pin) == LOW);

            if (pin_is_low)
            {
                if (btn.k <= CL)
                {
                    btn.k++;
                }
                else
                {
                    btn.k = CH;
                }
            }
            else
            {
                if (btn.k >= CL)
                {
                    btn.k--;
                }
                else
                {
                    btn.k = 0;
                }
            }

            bool was_pressed = !btn.current_state; // current_state: true = released, false = pressed
            bool now_pressed = (btn.k >= CL);

            if (now_pressed != was_pressed)
            {
                if (now_pressed)
                {
                    // Transition to PRESSED
                    btn.current_state = false;

                    // Capture current dynamic intent (invert current logic state)
                    SharedSystemState system_state = getSharedSystemState();
                    bool is_active = false;
                    if (btn.channel == AppChannel::MIST)
                    {
                        is_active = system_state.actuators.mist_active;
                    }
                    else if (btn.channel == AppChannel::FAN)
                    {
                        is_active = system_state.actuators.fan_active;
                    }
                    else if (btn.channel == AppChannel::LAMP)
                    {
                        is_active = system_state.actuators.lamp_stage_active;
                    }

                    AppIntent intent_to_send = is_active ? AppIntent::FORCE_OFF : AppIntent::FORCE_ON;
                    btn.next_intent = (intent_to_send == AppIntent::FORCE_ON) ? AppIntent::FORCE_OFF : AppIntent::FORCE_ON;

                    if (g_manual_request_queue != nullptr)
                    {
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
                else
                {
                    // Transition to RELEASED
                    btn.current_state = true;

                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.printf("[BUTTON] Debounced RELEASE on Channel %d\n", static_cast<int>(btn.channel));
                }
            }
        }
    }

    void reset_for_test()
    {
        for (auto &btn : buttons)
        {
            btn.k = 0;
            btn.current_state = true;
            btn.next_intent = AppIntent::FORCE_ON; // Reset toggle state
        }
    }

    void notify_latch_released(AppChannel channel)
    {
        for (auto &btn : buttons)
        {
            if (btn.channel == channel)
            {
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
void taskCabinetButtons(void *pvParameters)
{
    (void)pvParameters;

    // Hard configure GPIO with internal Pull-up
    for (auto &btn : cabinet_buttons::buttons)
    {
        pinMode(btn.pin, INPUT_PULLUP);
    }

    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xFrequency = pdMS_TO_TICKS(1) > 0 ? pdMS_TO_TICKS(1) : 1; // 1ms sampling interval (at least 1 tick)

    while (true)
    {
        cabinet_buttons::process_cabinet_buttons();
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
    }
}
#endif
