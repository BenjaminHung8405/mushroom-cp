#include "button_manager.h"
#include "config.h"  // For config::pins
#include <Arduino.h> // For pinMode, digitalRead, millis

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
    static ButtonDebounceState button_up_debounce_state = {0, BUTTON_RELEASED, BUTTON_RELEASED};
    static ButtonDebounceState button_down_debounce_state = {0, BUTTON_RELEASED, BUTTON_RELEASED};

    // Helper to get debounce state for a given pin
    static ButtonDebounceState &get_debounce_state_for_pin(uint8_t pin)
    {
        if (pin == config::pins::PIN_BUTTON_UP)
        {
            return button_up_debounce_state;
        }
        else if (pin == config::pins::PIN_BUTTON_DOWN)
        {
            return button_down_debounce_state;
        }
        // This should ideally not be reached with known pins.
        // For robustness, a default or error handling could be added.
        return button_up_debounce_state; // Fallback
    }

    void init_buttons()
    {
        pinMode(config::pins::PIN_BUTTON_UP, INPUT_PULLUP);
        pinMode(config::pins::PIN_BUTTON_DOWN, INPUT_PULLUP);

        // Initialize states based on current physical state
        button_up_debounce_state.last_stable_state = (ButtonState)digitalRead(config::pins::PIN_BUTTON_UP);
        button_up_debounce_state.last_raw_state = button_up_debounce_state.last_stable_state;
        button_up_debounce_state.last_debounce_time = millis();

        button_down_debounce_state.last_stable_state = (ButtonState)digitalRead(config::pins::PIN_BUTTON_DOWN);
        button_down_debounce_state.last_raw_state = button_down_debounce_state.last_stable_state;
        button_down_debounce_state.last_debounce_time = millis();

        Serial.println("[BUTTON_MANAGER] Initialized buttons.");
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