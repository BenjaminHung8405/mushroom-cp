#include "AdaptiveTuner.h"
#include <cmath>

namespace AdaptiveTuner {

namespace {

constexpr float GAIN_MIN = 0.5f;
constexpr float GAIN_MAX = 2.5f;
constexpr float GAIN_BASE = 1.0f;

// Integral gains chosen so that I_MAX * KI ≈ 1.5, i.e. the adaptive offset
// reaches the hardware clamp band without needing an extra outer limiter.
constexpr float KI_TEMP = 0.10f;   // 1 / (°C·s)
constexpr float KI_HUMID = 0.05f;  // 1 / (%·s)

// Anti-windup ceilings for surface integrals.
constexpr float I_MAX_TEMP = 15.0f;   // °C·s
constexpr float I_MAX_HUMID = 30.0f;  // %·s

// Guard against a stalled scheduler suddenly dumping a huge dt.
constexpr float DT_MAX_SECONDS = 10.0f;

inline float clampf(float value, float lo, float hi) {
    if (value < lo) {
        return lo;
    }
    if (value > hi) {
        return hi;
    }
    return value;
}

inline bool isInvalid(float value) {
    return std::isnan(value) || std::isinf(value);
}

} // namespace

IntegralState makeInitialState() {
    return IntegralState{0.0f, 0.0f};
}

GainsPod defaultGains() {
    return GainsPod{GAIN_BASE, GAIN_BASE, GAIN_BASE};
}

void reset(IntegralState& state) {
    state.integral_temp = 0.0f;
    state.integral_humid = 0.0f;
}

GainsPod updateGains(IntegralState& state,
                     float errorTemp,
                     float errorHumid,
                     float dtSeconds) {
    // Repair corrupted state rather than propagating NaN into gains.
    if (isInvalid(state.integral_temp)) {
        state.integral_temp = 0.0f;
    }
    if (isInvalid(state.integral_humid)) {
        state.integral_humid = 0.0f;
    }

    const bool dt_ok = !isInvalid(dtSeconds) && (dtSeconds > 0.0f);
    if (dt_ok) {
        const float dt = (dtSeconds > DT_MAX_SECONDS) ? DT_MAX_SECONDS : dtSeconds;

        // Sensor-loss freeze: do not integrate invalid channels.
        if (!isInvalid(errorTemp)) {
            state.integral_temp = clampf(
                state.integral_temp + (errorTemp * dt),
                -I_MAX_TEMP,
                I_MAX_TEMP);
        }
        if (!isInvalid(errorHumid)) {
            state.integral_humid = clampf(
                state.integral_humid + (errorHumid * dt),
                -I_MAX_HUMID,
                I_MAX_HUMID);
        }
    }

    // Adaptive gain mapping from surface integrals.
    // - HLamp follows temperature deficit (cold => boost heat lamps).
    // - HWat follows temperature with mild humidity coupling (cold+wet favors water heat).
    // - Mist follows humidity deficit (dry => boost mist).
    GainsPod gains;
    gains.gain_HLamp = clampf(
        GAIN_BASE + (KI_TEMP * state.integral_temp),
        GAIN_MIN,
        GAIN_MAX);
    gains.gain_HWat = clampf(
        GAIN_BASE + (KI_TEMP * state.integral_temp) + (0.25f * KI_HUMID * state.integral_humid),
        GAIN_MIN,
        GAIN_MAX);
    gains.gain_Mist = clampf(
        GAIN_BASE + (KI_HUMID * state.integral_humid),
        GAIN_MIN,
        GAIN_MAX);
    return gains;
}

} // namespace AdaptiveTuner
