#include "relay_control.h"

#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

#include "config.h"

namespace relay_control {
namespace {

constexpr uint16_t MIDDAY_BLACKOUT_START_MINUTE = 11U * 60U;
constexpr uint16_t MIDDAY_BLACKOUT_END_MINUTE = 13U * 60U + 30U;
constexpr float FUZZY_ON_THRESHOLD = 0.55f;
constexpr float FUZZY_OFF_THRESHOLD = 0.45f;

bool isValidRtcTime(const RtcTimePod& rtcTime) {
    return rtcTime.valid && rtcTime.hour < 24U && rtcTime.minute < 60U;
}

bool isMiddayBlackout(const RtcTimePod& rtcTime) {
    const uint16_t minuteOfDay =
        static_cast<uint16_t>(rtcTime.hour) * 60U + rtcTime.minute;
    return minuteOfDay >= MIDDAY_BLACKOUT_START_MINUTE &&
           minuteOfDay <= MIDDAY_BLACKOUT_END_MINUTE;
}

bool resolveBinaryDemand(float demand, bool currentlyActive) {
    if (!std::isfinite(demand) || demand <= 0.0f) {
        return false;
    }
    return currentlyActive ? demand > FUZZY_OFF_THRESHOLD
                           : demand >= FUZZY_ON_THRESHOLD;
}

void writeRelayIfChanged(uint8_t pin, bool& state, bool active) {
    if (state != active) {
        // Relay drivers are active LOW.
        digitalWrite(pin, active ? LOW : HIGH);
        state = active;
    }
}

} // namespace

void hardwareProtectionOverride(
    FuzzyController::ArbitratedOutputsPod& outputs,
    const RtcTimePod& rtcTime) {
    if (!isValidRtcTime(rtcTime) || isMiddayBlackout(rtcTime)) {
        outputs.HWat = 0.0f;
        outputs.Mist = 0.0f;
    }
}

void applyDirectOutputs(
    const FuzzyController::ArbitratedOutputsPod& outputs,
    RelayStatePod& state) {
    writeRelayIfChanged(
        config::pins::PIN_RELAY_LAMP,
        state.lamp_active,
        resolveBinaryDemand(outputs.HLamp, state.lamp_active));
    writeRelayIfChanged(
        config::pins::PIN_RELAY_HWAT,
        state.hwat_active,
        resolveBinaryDemand(outputs.HWat, state.hwat_active));
    writeRelayIfChanged(
        config::pins::PIN_RELAY_MIST,
        state.mist_active,
        resolveBinaryDemand(outputs.Mist, state.mist_active));
    writeRelayIfChanged(
        config::pins::PIN_RELAY_FAN,
        state.fan_active,
        resolveBinaryDemand(outputs.Exh, state.fan_active));
}

} // namespace relay_control
