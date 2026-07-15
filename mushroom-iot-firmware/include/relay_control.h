#pragma once

#include <stdint.h>

#include "FuzzyController.h"

namespace relay_control {

struct RtcTimePod {
    bool valid;
    uint8_t hour;
    uint8_t minute;
} __attribute__((aligned(4)));

/** Final ON/OFF state of the active-LOW physical relays. */
struct RelayStatePod {
    bool lamp_active;
    bool hwat_active;
    bool mist_active;
    bool fan_active;
} __attribute__((aligned(4)));

/**
 * Forces water heating and mist OFF when RTC time is invalid or in the
 * non-bypassable 11:00–13:30 biosafety blackout.
 */
void hardwareProtectionOverride(
    FuzzyController::ArbitratedOutputsPod &outputs,
    const RtcTimePod &rtcTime);

/**
 * Converts fuzzy/manual demands to stable binary relay states.
 *
 * No PWM, pulse, or time-proportional control is used. A small hysteresis
 * band prevents a fuzzy demand near 0.5 from repeatedly switching a relay.
 * GPIO is written only when the resolved ON/OFF state changes.
 */
void applyDirectOutputs(
    const FuzzyController::ArbitratedOutputsPod &outputs,
    RelayStatePod &state);

} // namespace relay_control
