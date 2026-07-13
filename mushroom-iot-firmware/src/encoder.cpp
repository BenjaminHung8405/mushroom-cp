#include "encoder.h"
#include "config.h"
#include "definitions.h"
#include "storage.h"
#include <cmath>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

namespace encoder {
namespace {

constexpr unsigned long EDGE_REJECT_MS = 2UL;
constexpr unsigned long SWITCH_DEBOUNCE_MS = 30UL;
constexpr unsigned long DOUBLE_CLICK_MS = 300UL;
constexpr unsigned long LONG_PRESS_MS = 3000UL;
constexpr unsigned long POLL_INTERVAL_MS = 20UL;
constexpr float MIN_TEMP = 20.0f;
constexpr float MAX_TEMP = 40.0f;
constexpr float MIN_HUMIDITY = 50.0f;
constexpr float MAX_HUMIDITY = 95.0f;
constexpr float TEMP_STEP = 0.5f;
constexpr float HUMIDITY_STEP = 1.0f;

portMUX_TYPE encoder_mux = portMUX_INITIALIZER_UNLOCKED;
int8_t pending_rotation = 0;
unsigned long last_edge_ms = 0;
EncoderState state = {24.0f, 90.0f, false, false, EditField::Temperature};
bool initialized = false;
bool raw_button_pressed = false;
bool stable_button_pressed = false;
bool long_press_handled = false;
bool pending_click = false;
unsigned long raw_changed_ms = 0;
unsigned long press_started_ms = 0;
unsigned long first_click_ms = 0;

float clamp(float value, float lower, float upper)
{
    return value < lower ? lower : (value > upper ? upper : value);
}

void queueOverride(bool active)
{
    if (xOverrideQueue == nullptr) {
        return;
    }
    const ControlSetpointCommand command = {
        state.temp_target, state.humidity_target, NAN, active, {0, 0, 0}};
    xQueueOverwrite(xOverrideQueue, &command);
}

void persistOverride()
{
    const storage::HardwareOverrideSnapshot snapshot = {
        state.temp_target, state.humidity_target, true};
    if (storage::StorageManager::get_instance().save_hardware_override(snapshot)) {
        state.override_active = true;
        queueOverride(true);
    }
}

void clearOverride()
{
    storage::StorageManager::get_instance().clear_hardware_override();
    state.override_active = false;
    state.editing = false;
    queueOverride(false);
}

void applyRotation(int8_t rotation)
{
    if (!state.editing || rotation == 0) {
        return;
    }
    if (state.field == EditField::Temperature) {
        state.temp_target = clamp(state.temp_target + rotation * TEMP_STEP, MIN_TEMP, MAX_TEMP);
    } else {
        state.humidity_target = clamp(state.humidity_target + rotation * HUMIDITY_STEP, MIN_HUMIDITY, MAX_HUMIDITY);
    }
}

void initializeEditBufferFromEffectiveTarget()
{
    const SharedSystemState effective = getSharedSystemState();
    if (std::isfinite(effective.temp_target)) {
        state.temp_target = clamp(effective.temp_target, MIN_TEMP, MAX_TEMP);
    }
    if (std::isfinite(effective.humidity_target)) {
        state.humidity_target = clamp(effective.humidity_target, MIN_HUMIDITY, MAX_HUMIDITY);
    }
}

void handleShortClick(unsigned long now)
{
    if (!pending_click) {
        pending_click = true;
        first_click_ms = now;
        return;
    }
    if (now - first_click_ms <= DOUBLE_CLICK_MS) {
        pending_click = false;
        if (!state.editing) {
            initializeEditBufferFromEffectiveTarget();
            state.editing = true;
            state.field = EditField::Temperature;
        }
        return;
    }
    first_click_ms = now;
}

void processButton(unsigned long now)
{
    const bool pressed = digitalRead(config::pins::PIN_ENCODER_SW) == LOW;
    if (pressed != raw_button_pressed) {
        raw_button_pressed = pressed;
        raw_changed_ms = now;
    }
    if (raw_button_pressed != stable_button_pressed && now - raw_changed_ms >= SWITCH_DEBOUNCE_MS) {
        stable_button_pressed = raw_button_pressed;
        if (stable_button_pressed) {
            press_started_ms = now;
            long_press_handled = false;
        } else if (!long_press_handled) {
            handleShortClick(now);
        }
    }
    if (stable_button_pressed && !long_press_handled && now - press_started_ms >= LONG_PRESS_MS) {
        long_press_handled = true;
        if (state.editing) {
            persistOverride();
            state.editing = false;
        } else if (state.override_active) {
            clearOverride();
        }
    }
    if (pending_click && now - first_click_ms > DOUBLE_CLICK_MS) {
        pending_click = false;
        if (state.editing) {
            state.field = state.field == EditField::Temperature ? EditField::Humidity : EditField::Temperature;
        }
    }
}

#ifndef UNIT_TEST
void IRAM_ATTR onClockEdge()
{
    const unsigned long now = millis();
    portENTER_CRITICAL_ISR(&encoder_mux);
    if (now - last_edge_ms < EDGE_REJECT_MS) {
        portEXIT_CRITICAL_ISR(&encoder_mux);
        return;
    }
    last_edge_ms = now;
    const int8_t direction = digitalRead(config::pins::PIN_ENCODER_DT) == LOW ? 1 : -1;
    if ((direction > 0 && pending_rotation < 20) || (direction < 0 && pending_rotation > -20)) {
        pending_rotation += direction;
    }
    portEXIT_CRITICAL_ISR(&encoder_mux);
}
#endif

} // namespace

void init()
{
    pinMode(config::pins::PIN_ENCODER_CLK, INPUT_PULLUP);
    pinMode(config::pins::PIN_ENCODER_DT, INPUT_PULLUP);
    pinMode(config::pins::PIN_ENCODER_SW, INPUT_PULLUP);
    raw_button_pressed = digitalRead(config::pins::PIN_ENCODER_SW) == LOW;
    stable_button_pressed = raw_button_pressed;
    initialized = true;
#ifndef UNIT_TEST
    attachInterrupt(digitalPinToInterrupt(config::pins::PIN_ENCODER_CLK), onClockEdge, FALLING);
#endif
}

void process(unsigned long now)
{
    if (!initialized) {
        init();
    }
    int8_t rotation = 0;
    portENTER_CRITICAL(&encoder_mux);
    rotation = pending_rotation;
    pending_rotation = 0;
    portEXIT_CRITICAL(&encoder_mux);
    applyRotation(rotation);
    processButton(now);
}

EncoderState getState()
{
    return state;
}

#ifdef UNIT_TEST
void simulateClockEdgeForTest(bool dt_high, unsigned long now)
{
    portENTER_CRITICAL(&encoder_mux);
    if (now - last_edge_ms < EDGE_REJECT_MS) {
        portEXIT_CRITICAL(&encoder_mux);
        return;
    }
    last_edge_ms = now;
    const int8_t direction = dt_high ? -1 : 1;
    if ((direction > 0 && pending_rotation < 20) || (direction < 0 && pending_rotation > -20)) {
        pending_rotation += direction;
    }
    portEXIT_CRITICAL(&encoder_mux);
}
#endif

void resetForTest()
{
    pending_rotation = 0;
    last_edge_ms = 0;
    state = {24.0f, 90.0f, false, false, EditField::Temperature};
    initialized = false;
    raw_button_pressed = false;
    stable_button_pressed = false;
    long_press_handled = false;
    pending_click = false;
    raw_changed_ms = 0;
    press_started_ms = 0;
    first_click_ms = 0;
}

} // namespace encoder

void taskEncoderInput(void* /*pvParameters*/)
{
    encoder::init();
#ifndef UNIT_TEST
    while (true)
#else
    for (int iteration = 0; iteration < 1; ++iteration)
#endif
    {
        encoder::process(millis());
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
