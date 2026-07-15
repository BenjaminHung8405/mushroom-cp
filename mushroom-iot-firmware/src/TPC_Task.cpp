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
    digitalWrite(config.pin, high ? LOW : HIGH);
    state.output_high = high;
}

void initTpcChannelState(TpcChannelState& state, uint32_t now, uint32_t minOffMs) {
    state.initialized = true;
    state.output_high = false;
    state.window_started_ms = now;
    state.last_transition_ms = now - minOffMs;
    state.pulse_state = 0; // OFF
    state.pulse_on_ms = 0;
    state.pulse_off_ms = 0;
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
        digitalWrite(config.pin, HIGH);
        state.output_high = false;
        state.initialized = true;
        state.window_started_ms = now;
        state.last_transition_ms = now;
        state.pulse_state = 0;
        state.pulse_on_ms = 0;
        state.pulse_off_ms = 0;
        return;
    }

    if (!state.initialized) {
        initTpcChannelState(state, now, config.min_off_ms);
        digitalWrite(config.pin, HIGH);
    }

    // Wrap the window to reset the offset start reference
    const uint32_t elapsedInWindow = wrapTpcWindow(state, now, config.window_ms);

    const float safeDuty = clampUnit(dutyDemand);

    // If demand is close to 0, force OFF immediately.
    if (safeDuty <= 0.05f) {
        writeOutput(config, state, false);
        state.pulse_state = 0;
        state.last_transition_ms = now;
        return;
    }

    // Dynamic On/Off Pulse Controller State Machine
    if (state.pulse_state == 2) { // COOLDOWN
        // Transition back to OFF when COOLDOWN/OFF duration finishes
        if (elapsedAtLeast(now, state.last_transition_ms, state.pulse_off_ms)) {
            state.pulse_state = 0; // OFF (ready for next cycle)
        }
    }

    if (state.pulse_state == 0) { // OFF
        // Respect staggered startup offset
        if (elapsedInWindow >= config.offset_ms) {
            // Respect min_off_ms guard
            if (elapsedAtLeast(now, state.last_transition_ms, config.min_off_ms)) {
                // Calculate ON/OFF durations based on fuzzy duty
                uint32_t T_on = static_cast<uint32_t>(safeDuty * config.window_ms);
                uint32_t T_off = static_cast<uint32_t>((1.0f - safeDuty) * config.window_ms);

                // Enforce minimum limits
                if (T_on < config.min_on_ms) {
                    T_on = config.min_on_ms;
                }
                if (T_off < config.min_off_ms) {
                    T_off = config.min_off_ms;
                }

                // Enforce non-wrapping rule: cap ON duration at window boundary
                if (config.offset_ms + T_on > config.window_ms) {
                    T_on = config.window_ms - config.offset_ms;
                }

                writeOutput(config, state, true);
                state.pulse_state = 1; // ON
                state.last_transition_ms = now;
                state.pulse_on_ms = T_on;
                state.pulse_off_ms = T_off;
            }
        }
    }
    else if (state.pulse_state == 1) { // ON
        // Transition to cooldown when ON duration finishes
        if (elapsedAtLeast(now, state.last_transition_ms, state.pulse_on_ms)) {
            writeOutput(config, state, false);
            state.pulse_state = 2; // COOLDOWN
            state.last_transition_ms = now;
        }
    }
}

void applyTpcOutputs(
    const FuzzyController::ArbitratedOutputsPod& outputs,
    const TpcChannelConfig& lampConfig,
    const TpcChannelConfig& hWatConfig,
    const TpcChannelConfig& mistConfig,
    const TpcChannelConfig& exhConfig,
    TpcSchedulerState& state) {
    updateTpcChannel(lampConfig, state.Lamp, outputs.HLamp);
    updateTpcChannel(hWatConfig, state.HWat, outputs.HWat);
    updateTpcChannel(mistConfig, state.Mist, outputs.Mist);
    updateTpcChannel(exhConfig, state.Exh, outputs.Exh);
}

} // namespace TPC_Task
