#pragma once

#include <stdint.h>

namespace seven_segment_display
{
    constexpr uint8_t PAYLOAD_SIZE = 7U;
    constexpr uint8_t BLANK_DIGIT = 0xFFU;
    constexpr uint32_t DISPLAY_HOLDOVER_MAX_AGE_MS = 15000UL;

    enum class DisplayDataState : uint8_t {
        FRESH,
        HOLDOVER,
        BLANKED,
    };

    /** Last complete humidity/temperature pair suitable for display. */
    struct LastGoodDisplaySample {
        float humidity = 0.0f;
        float temperature = 0.0f;
        uint32_t timestamp_ms = 0U;
        bool valid = false;
    };

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

    /**
     * Resolve a display payload from raw SHT30 data with bounded pair holdover.
     *
     * Only a complete finite humidity/temperature pair refreshes last_good.
     * Invalid input reuses that pair while it is no older than max_age_ms;
     * otherwise it produces the normal all-blank payload. This helper is pure
     * apart from last_good and is exposed so host tests can control time.
     */
    DisplayDataState buildPayloadWithHoldover(
        float humidity, float temperature, uint32_t now_ms,
        LastGoodDisplaySample& last_good, uint8_t display_mode,
        uint8_t output[PAYLOAD_SIZE],
        uint32_t max_age_ms = DISPLAY_HOLDOVER_MAX_AGE_MS);

    /** Send an already formatted seven-byte payload to the I2C display. */
    bool writePayload(const uint8_t payload[PAYLOAD_SIZE]);

    /**
     * Format and send raw humidity/temperature using an internal 15-second
     * display-only holdover. It does not alter raw telemetry or safety data.
     */
    bool update(float humidity, float temperature);
} // namespace seven_segment_display
