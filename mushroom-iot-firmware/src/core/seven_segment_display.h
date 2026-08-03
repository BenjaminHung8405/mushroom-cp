#pragma once

#include <stdint.h>

namespace seven_segment_display
{
    constexpr uint8_t PAYLOAD_SIZE = 7U;
    constexpr uint8_t BLANK_DIGIT = 0xFFU;

    /**
     * Build the display-controller payload for the latest raw SHT30 values.
     *
     * humidity is val1 and temperature is val2. Each value occupies two
     * positions: a leading blank is used for single-digit values. Both values
     * must be finite; otherwise every position is blanked. Finite values are
     * truncated toward zero and clamped to the hardware's 00..99 range.
     */
    void buildPayload(float humidity, float temperature, uint8_t display_mode,
                      uint8_t output[PAYLOAD_SIZE]);

    /** Send an already formatted seven-byte payload to the I2C display. */
    bool writePayload(const uint8_t payload[PAYLOAD_SIZE]);

    /** Format and send the current raw humidity/temperature reading. */
    bool update(float humidity, float temperature);
} // namespace seven_segment_display
