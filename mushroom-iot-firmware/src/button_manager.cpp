#include "button_manager.h"
#include "config.h"  // For config::hardware (PIN_BTN_MIST, PIN_BTN_LAMP, PIN_BTN_FAN)
#ifndef UNIT_TEST
#include <Arduino.h> // For pinMode, digitalRead, millis
#endif

// button_manager.cpp — Legacy encoder-style button debounce.
// NOTE: Production firmware sử dụng cabinet_buttons.cpp (shift-register debounce, 8-sample).
// File này chỉ compile để giữ backward-compat với unit tests dùng ButtonState API.
// Tất cả 3 chân đều theo cùng pattern: GPIO4 (MIST) là chuẩn, GPIO15 (LAMP) và GPIO16 (FAN) đồng bộ.

namespace button_manager
{

    // Debounce delay in milliseconds
    static constexpr unsigned long DEBOUNCE_DELAY_MS = 50;

    // Internal state for debouncing each button
    struct ButtonDebounceState
    {
        unsigned long last_debounce_time;
        ButtonState last_stable_state;
        ButtonState last_raw_state; // To detect change from last stable state
    };

    // Using static variables for a fixed small number of buttons.
    // Đồng bộ: LAMP (GPIO15) và FAN (GPIO16) theo cùng cấu hình như MIST (GPIO4).
    static ButtonDebounceState button_up_debounce_state   = {0, BUTTON_RELEASED, BUTTON_RELEASED}; // Alias: PIN_BTN_LAMP (GPIO15)
    static ButtonDebounceState button_down_debounce_state = {0, BUTTON_RELEASED, BUTTON_RELEASED}; // Alias: PIN_BTN_FAN  (GPIO16)

    // Helper to get debounce state for a given pin
    static ButtonDebounceState &get_debounce_state_for_pin(uint8_t pin)
    {
        if (pin == config::hardware::PIN_BTN_LAMP)   // GPIO15 — đồng bộ với cabinet_buttons
        {
            return button_up_debounce_state;
        }
        else if (pin == config::hardware::PIN_BTN_FAN)  // GPIO16 — đồng bộ với cabinet_buttons
        {
            return button_down_debounce_state;
        }
        // Fallback (bao gồm PIN_BTN_MIST = GPIO4 nếu được truyền vào)
        return button_up_debounce_state;
    }

    void init_buttons()
    {
        // Cùng pattern với PIN_BTN_MIST (GPIO4): INPUT_PULLUP, active-LOW.
        pinMode(config::hardware::PIN_BTN_LAMP, INPUT_PULLUP); // GPIO15
        pinMode(config::hardware::PIN_BTN_FAN,  INPUT_PULLUP); // GPIO16

        // Initialize states based on current physical state
        button_up_debounce_state.last_stable_state   = (ButtonState)digitalRead(config::hardware::PIN_BTN_LAMP);
        button_up_debounce_state.last_raw_state       = button_up_debounce_state.last_stable_state;
        button_up_debounce_state.last_debounce_time   = millis();

        button_down_debounce_state.last_stable_state  = (ButtonState)digitalRead(config::hardware::PIN_BTN_FAN);
        button_down_debounce_state.last_raw_state      = button_down_debounce_state.last_stable_state;
        button_down_debounce_state.last_debounce_time  = millis();

        Serial.printf("[BUTTON_MANAGER] Initialized: LAMP (GPIO%d), FAN (GPIO%d) as INPUT_PULLUP.\n",
                      (int)config::hardware::PIN_BTN_LAMP,
                      (int)config::hardware::PIN_BTN_FAN);
    }

    ButtonState get_button_state(uint8_t pin)
    {
        ButtonDebounceState &state = get_debounce_state_for_pin(pin);
        unsigned long current_millis = millis();
        ButtonState raw_state = (ButtonState)digitalRead(pin); // digitalRead returns HIGH (1) or LOW (0)

        if (raw_state != state.last_raw_state)
        {
            state.last_debounce_time = current_millis;
            state.last_raw_state = raw_state;
        }

        if ((current_millis - state.last_debounce_time) > DEBOUNCE_DELAY_MS)
        {
            state.last_stable_state = raw_state;
        }
        return state.last_stable_state;
    }

} // namespace button_manager