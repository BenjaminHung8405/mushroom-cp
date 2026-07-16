#include "core/system_manager.h"
#include "config.h"
#include "core/models.h"
#include "core/serial_mutex.h"
#include "core/sst.h"

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
    // Define the Schmitt Trigger input instances with 20ms poll interval
    // MAX_CNT = 10 (200ms), ON_THRESH = 1 (20ms), OFF_THRESH = 8 (160ms)
    static SchmittTriggerInput sst_mist(config::hardware::PIN_BTN_MIST, LOW, 10, 1, 8, config::hardware::BUTTON_POLL_INTERVAL_MS);
    static SchmittTriggerInput sst_fan(config::hardware::PIN_BTN_FAN, LOW, 10, 1, 8, config::hardware::BUTTON_POLL_INTERVAL_MS);
    static SchmittTriggerInput sst_lamp(config::hardware::PIN_BTN_LAMP, LOW, 10, 1, 8, config::hardware::BUTTON_POLL_INTERVAL_MS);

    struct ButtonWrapper
    {
        SchmittTriggerInput& sst;
        AppChannel channel;
        AppIntent next_intent;
    };

    static ButtonWrapper buttons[] = {
        {sst_mist, AppChannel::MIST, AppIntent::FORCE_ON},
        {sst_fan, AppChannel::FAN, AppIntent::FORCE_ON},
        {sst_lamp, AppChannel::LAMP, AppIntent::FORCE_ON}
    };

    void process_cabinet_buttons()
    {
        for (auto &btn : buttons)
        {
            // Update and get Schmitt trigger event
            int event = btn.sst.update();

            if (event == EVENT_ON)
            {
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
            else if (event == EVENT_OFF)
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[BUTTON] Debounced RELEASE on Channel %d\n", static_cast<int>(btn.channel));
            }
        }
    }

    void reset_for_test()
    {
        for (auto &btn : buttons)
        {
            btn.sst.reset();
            btn.next_intent = AppIntent::FORCE_ON; // Reset toggle state
        }
    }

    void notify_latch_released(AppChannel channel)
    {
        for (auto &btn : buttons)
        {
            if (btn.channel == channel)
            {
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

    // Initialize the physical pins via SchmittTrigger begin()
    cabinet_buttons::sst_mist.begin();
    cabinet_buttons::sst_fan.begin();
    cabinet_buttons::sst_lamp.begin();

    TickType_t xLastWakeTime = xTaskGetTickCount();
    // 20ms sampling interval driven by config constant
    const TickType_t xFrequency = pdMS_TO_TICKS(config::hardware::BUTTON_POLL_INTERVAL_MS) > 0
        ? pdMS_TO_TICKS(config::hardware::BUTTON_POLL_INTERVAL_MS)
        : 1;

    while (true)
    {
        cabinet_buttons::process_cabinet_buttons();
        vTaskDelayUntil(&xLastWakeTime, xFrequency);
    }
}
#endif
