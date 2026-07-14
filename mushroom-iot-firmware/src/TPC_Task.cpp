#include "TPC_Task.h"

#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

namespace TPC_Task {
namespace {

constexpr uint16_t MIDDAY_BLACKOUT_START_MINUTE = 11U * 60U;
constexpr uint16_t MIDDAY_BLACKOUT_END_MINUTE = 13U * 60U + 30U;

float clampUnit(float value) {
    if (!std::isfinite(value) || value <= 0.0f) {
        return 0.0f;
    }
    return (value >= 1.0f) ? 1.0f : value;
}

bool isValidRtcTime(const RtcTimePod& rtcTime) {
    return rtcTime.valid && rtcTime.hour < 24U && rtcTime.minute < 60U;
}

bool isMiddayBlackout(const RtcTimePod& rtcTime) {
    const uint16_t minuteOfDay =
        static_cast<uint16_t>(rtcTime.hour) * 60U + rtcTime.minute;
    return minuteOfDay >= MIDDAY_BLACKOUT_START_MINUTE &&
           minuteOfDay <= MIDDAY_BLACKOUT_END_MINUTE;
}

bool elapsedAtLeast(uint32_t now, uint32_t since, uint32_t interval) {
    return static_cast<uint32_t>(now - since) >= interval;
}

bool requestedOutputHigh(float dutyDemand, uint32_t elapsedInWindow, uint32_t windowMs, uint32_t offsetMs) {
    const float duty = clampUnit(dutyDemand);
    if (duty <= 0.0f) {
        return false;
    }

    const uint32_t onDurationMs = static_cast<uint32_t>(duty * windowMs);
    const uint32_t onEndMs = (offsetMs + onDurationMs > windowMs) ? windowMs : (offsetMs + onDurationMs);
    return elapsedInWindow >= offsetMs && elapsedInWindow < onEndMs;
}

void writeOutput(const TpcChannelConfig& config, TpcChannelState& state, bool high) {
    digitalWrite(config.pin, high ? HIGH : LOW);
    state.output_high = high;
}

void initTpcChannelState(TpcChannelState& state, uint32_t now, uint32_t minOffMs) {
    state.initialized = true;
    state.output_high = false;
    state.window_started_ms = now;
    state.last_transition_ms = now - minOffMs;
}

uint32_t wrapTpcWindow(TpcChannelState& state, uint32_t now, uint32_t windowMs) {
    uint32_t elapsedInWindow = static_cast<uint32_t>(now - state.window_started_ms);
    if (elapsedInWindow >= windowMs) {
        const uint32_t completedWindows = elapsedInWindow / windowMs;
        state.window_started_ms += completedWindows * windowMs;
        elapsedInWindow = static_cast<uint32_t>(now - state.window_started_ms);
    }
    return elapsedInWindow;
}

} // namespace

TpcSchedulerState makeInitialSchedulerState() {
    return TpcSchedulerState{};
}

void hardwareProtectionOverride(
    FuzzyController::ArbitratedOutputsPod& outputs,
    const RtcTimePod& rtcTime) {
    if (!isValidRtcTime(rtcTime) || isMiddayBlackout(rtcTime)) {
        outputs.HWat = 0.0f;
        outputs.Mist = 0.0f;
    }
}

void updateTpcChannel(
    const TpcChannelConfig& config,
    TpcChannelState& state,
    float dutyDemand) {
    const uint32_t now = millis();

    // A zero window cannot define a safe time-proportional schedule.
    if (config.window_ms == 0U) {
        digitalWrite(config.pin, LOW);
        state.output_high = false;
        state.initialized = true;
        state.window_started_ms = now;
        state.last_transition_ms = now;
        return;
    }

    if (!state.initialized) {
        // Start from an OFF phase but make the first valid ON request eligible
        // immediately. This prevents boot-time demand from being delayed while
        // retaining minimum-off enforcement for subsequent transitions.
        initTpcChannelState(state, now, config.min_off_ms);
        digitalWrite(config.pin, LOW);
    }

    const uint32_t elapsedInWindow = wrapTpcWindow(state, now, config.window_ms);

    const float safeDuty = clampUnit(dutyDemand);
    const bool requestedHigh = requestedOutputHigh(
        safeDuty, elapsedInWindow, config.window_ms, config.offset_ms);
    if (requestedHigh == state.output_high) {
        return;
    }

    // An explicit zero demand is the safe SSR state. Do not retain a previous
    // ON phase for minimum-on timing: this lets protection interlocks force a
    // channel LOW immediately before the next GPIO decision.
    if (safeDuty <= 0.0f) {
        writeOutput(config, state, false);
        state.last_transition_ms = now;
        return;
    }

    const uint32_t requiredElapsed = requestedHigh
        ? config.min_off_ms
        : config.min_on_ms;
    if (!elapsedAtLeast(now, state.last_transition_ms, requiredElapsed)) {
        return;
    }

    writeOutput(config, state, requestedHigh);
    state.last_transition_ms = now;
}

void applyLampStaging(
    float lampDemand,
    TpcChannelState& stage1,
    TpcChannelState& stage2,
    const TpcChannelConfig& config1,
    const TpcChannelConfig& config2) {
    const float safeDemand = clampUnit(lampDemand);
    float duty1 = 0.0f;
    float duty2 = 0.0f;
    if (safeDemand <= 0.5f) {
        duty1 = safeDemand * 2.0f;
        duty2 = 0.0f;
    } else {
        duty1 = 1.0f;
        duty2 = (safeDemand - 0.5f) * 2.0f;
    }
    updateTpcChannel(config1, stage1, duty1);
    updateTpcChannel(config2, stage2, duty2);
}

void applyTpcOutputs(
    const FuzzyController::ArbitratedOutputsPod& outputs,
    const TpcChannelConfig& lamp1Config,
    const TpcChannelConfig& lamp2Config,
    const TpcChannelConfig& hWatConfig,
    const TpcChannelConfig& mistConfig,
    const TpcChannelConfig& exhConfig,
    TpcSchedulerState& state) {
    applyLampStaging(outputs.HLamp, state.Lamp1, state.Lamp2, lamp1Config, lamp2Config);
    updateTpcChannel(hWatConfig, state.HWat, outputs.HWat);
    updateTpcChannel(mistConfig, state.Mist, outputs.Mist);
    updateTpcChannel(exhConfig, state.Exh, outputs.Exh);
}

} // namespace TPC_Task
