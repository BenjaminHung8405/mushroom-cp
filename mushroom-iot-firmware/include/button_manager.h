#pragma once

#include <cstdint>    // For uint8_t, uint32_t
#include <functional> // For std::function

namespace button_manager
{

    enum ButtonState
    {
        BUTTON_RELEASED = 0,
        BUTTON_PRESSED = 1
    };

    // Initialize button GPIOs
    void init_buttons();

    // Read the debounced state of a button
    ButtonState get_button_state(uint8_t pin);

} // namespace button_manager