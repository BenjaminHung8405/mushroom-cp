#include "core/button_manager.h"
#include "config.h"
#include "core/sst.h"

namespace button_manager
{
namespace
{
SchmittTriggerInput mistButton(
    config::hardware::PIN_BTN_MIST, LOW, 10, 1, 8,
    config::hardware::BUTTON_POLL_INTERVAL_MS);
SchmittTriggerInput lampButton(
    config::hardware::PIN_BTN_LAMP, LOW, 10, 1, 8,
    config::hardware::BUTTON_POLL_INTERVAL_MS);
SchmittTriggerInput fanButton(
    config::hardware::PIN_BTN_FAN, LOW, 10, 1, 8,
    config::hardware::BUTTON_POLL_INTERVAL_MS);

SchmittTriggerInput *inputFor(uint8_t pin)
{
    if (pin == config::hardware::PIN_BTN_MIST)
    {
        return &mistButton;
    }
    if (pin == config::hardware::PIN_BTN_LAMP)
    {
        return &lampButton;
    }
    if (pin == config::hardware::PIN_BTN_FAN)
    {
        return &fanButton;
    }
    return nullptr;
}
} // namespace

void init_buttons()
{
    mistButton.begin();
    lampButton.begin();
    fanButton.begin();
}

ButtonState get_button_state(uint8_t pin)
{
    SchmittTriggerInput *input = inputFor(pin);
    if (input == nullptr)
    {
        return BUTTON_RELEASED;
    }

    input->update();
    return input->getState() ? BUTTON_PRESSED : BUTTON_RELEASED;
}

} // namespace button_manager
