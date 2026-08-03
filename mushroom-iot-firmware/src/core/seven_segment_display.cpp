#include "core/seven_segment_display.h"

#include "config.h"

#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#include <Wire.h>

#include "core/serial_mutex.h"
#endif

namespace seven_segment_display
{
namespace
{
    uint8_t truncateAndClamp(float value)
    {
        // Clamp before conversion so any finite outlier cannot overflow int.
        if (value <= 0.0f) return 0U;
        if (value >= 99.0f) return 99U;
        return static_cast<uint8_t>(value); // truncates toward zero
    }

    void appendTwoDigits(uint8_t value, uint8_t output[4], uint8_t offset)
    {
        if (value < 10U) {
            output[offset] = BLANK_DIGIT;
            output[offset + 1U] = value;
            return;
        }

        output[offset] = static_cast<uint8_t>(value / 10U);
        output[offset + 1U] = static_cast<uint8_t>(value % 10U);
    }
} // namespace

void buildPayload(float humidity, float temperature, uint8_t display_mode,
                  uint8_t output[PAYLOAD_SIZE])
{
    for (uint8_t i = 0U; i < PAYLOAD_SIZE; ++i) {
        output[i] = BLANK_DIGIT;
    }

    // The display is intentionally driven from raw telemetry, never control
    // holdover: stale sensor data must not remain visible after a failed read.
    if (!std::isfinite(humidity) || !std::isfinite(temperature)) {
        return;
    }

    uint8_t digits[4] = {BLANK_DIGIT, BLANK_DIGIT, BLANK_DIGIT, BLANK_DIGIT};
    appendTwoDigits(truncateAndClamp(humidity), digits, 0U);    // val1: humidity
    appendTwoDigits(truncateAndClamp(temperature), digits, 2U); // val2: temperature

    if (display_mode == 0U) {
        // Controller mode 0 expects the four logical digits right-aligned.
        for (uint8_t i = 0U; i < 4U; ++i) {
            output[i + 3U] = digits[i];
        }
        return;
    }

    // Controller mode 1 is the installed display's physical byte order.
    for (uint8_t i = 0U; i < 4U; ++i) {
        output[i] = digits[3U - i];
    }
}

bool writePayload(const uint8_t payload[PAYLOAD_SIZE])
{
#ifndef UNIT_TEST
    Wire.beginTransmission(config::hardware::I2C_DISPLAY_ADDR);
    Wire.write(payload, PAYLOAD_SIZE);
    return Wire.endTransmission() == 0;
#else
    (void)payload;
    return true;
#endif
}

bool update(float humidity, float temperature)
{
    uint8_t payload[PAYLOAD_SIZE];
    buildPayload(humidity, temperature, config::hardware::I2C_DISPLAY_MODE, payload);

    const bool sent = writePayload(payload);
#ifndef UNIT_TEST
    static unsigned long last_error_log_ms = 0U;
    const unsigned long now = millis();
    if (!sent && (last_error_log_ms == 0U || now - last_error_log_ms >= 60000UL)) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[DISPLAY] WARN: I2C write to 0x%02X failed.\n",
                      config::hardware::I2C_DISPLAY_ADDR);
        last_error_log_ms = now;
    }
#endif
    return sent;
}
} // namespace seven_segment_display
