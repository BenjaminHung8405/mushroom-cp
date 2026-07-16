#pragma once

#include <cstdint>

namespace button_manager
{

enum ButtonState
{
    BUTTON_RELEASED = 0,
    BUTTON_PRESSED = 1
};

/**
 * @deprecated Cabinet button handling is performed by taskCabinetButtons().
 * These compatibility functions expose its Schmitt-triggered input state.
 */
void init_buttons();
ButtonState get_button_state(uint8_t pin);

} // namespace button_manager
