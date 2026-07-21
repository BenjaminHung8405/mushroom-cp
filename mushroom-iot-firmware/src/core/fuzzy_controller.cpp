#include "core/fuzzy_controller.h"

#include <algorithm>
#include <cmath>

namespace FuzzyController {
namespace {

// Full-scale error magnitudes that map to unit demand.
// These keep the dual-heater stage hardware-independent and easy to unit-test.
constexpr float TEMP_COLD_FULL = 4.0f;   // °C
constexpr float TEMP_HOT_FULL = 4.0f;    // °C
constexpr float HUMID_DRY_FULL = 20.0f;  // %RH
constexpr float HUMID_WET_FULL = 20.0f;  // %RH

// CO2 hysteresis band around the setpoint (ppm of excess CO2).
// Engage when measured exceeds target by more than ON, hold until the excess
// falls back below OFF. The deadband between OFF and ON is what prevents
// continuous exhaust relay chatter.
constexpr float CO2_ON_THRESHOLD_PPM = 50.0f;
constexpr float CO2_OFF_THRESHOLD_PPM = 20.0f;

inline float clampUnit(float value) {
    if (value <= 0.0f) {
        return 0.0f;
    }
    if (value >= 1.0f) {
        return 1.0f;
    }
    return value;
}

inline bool isFinite(float value) {
    return !std::isnan(value) && !std::isinf(value);
}

inline float safeUnit(float value) {
    return isFinite(value) ? clampUnit(value) : 0.0f;
}

inline float safeScale(float value) {
    return isFinite(value) && value > 0.0f ? value : 0.0f;
}

// Bounds a gain into AdaptiveTuner's hardware-safe band. Invalid values fail
// safe to 0.0 so the corresponding actuator channel is forced OFF.
inline float safeGain(float value) {
    constexpr float GAIN_MIN = 0.5f;
    constexpr float GAIN_MAX = 2.5f;
    if (!isFinite(value)) {
        return 0.0f;
    }
    if (value < GAIN_MIN) {
        return GAIN_MIN;
    }
    if (value > GAIN_MAX) {
        return GAIN_MAX;
    }
    return value;
}

// Pure ramp membership: 0 at error <= 0, 1 at error >= fullScale.
// Implemented locally so the dual-heater rules do not depend on a degenerate
// trapmf(a=a, b=a, c=full, d=full) which collapses into a rectangle.
float risingDemand(float error, float fullScale) {
    if (!(fullScale > 0.0f) || !isFinite(error)) {
        return 0.0f;
    }
    return clampUnit(error / fullScale);
}

} // namespace

DualHeaterOutputsPod executeDualHeaterRules(float errorTemp, float errorHumid) {
    DualHeaterOutputsPod outputs = {0.0f, 0.0f, 0.0f, 0.0f};
    if (!isFinite(errorTemp) || !isFinite(errorHumid)) {
        return outputs;
    }

    // Continuous ramp memberships feed continuous normalized relay demands.
    const float cold = risingDemand(errorTemp, TEMP_COLD_FULL);
    const float hot = risingDemand(-errorTemp, TEMP_HOT_FULL);
    const float dry = risingDemand(errorHumid, HUMID_DRY_FULL);
    const float wet = risingDemand(-errorHumid, HUMID_WET_FULL);

    // The water heater is not installed, so the heat lamp supplies all thermal
    // demand whether the room is dry or wet.
    outputs.HLamp = cold;
    outputs.Mist = dry * (1.0f - cold);

    outputs.HWat = 0.0f;

    // When not cold, excess humidity is vented. Over-temperature also
    // independently requests exhaust. CO2 exhaust is merged later (B3).
    // Values remain continuous duties for later binary dispatch; no GPIO writes here.
    const float humidityExhaust = wet * (1.0f - cold);
    outputs.ExhTH = (hot > humidityExhaust) ? hot : humidityExhaust;

    outputs.HLamp = clampUnit(outputs.HLamp);
    outputs.HWat = clampUnit(outputs.HWat);
    outputs.Mist = clampUnit(outputs.Mist);
    outputs.ExhTH = clampUnit(outputs.ExhTH);
    return outputs;
}

CO2RuleState makeInitialCO2State() {
    return CO2RuleState{false};
}

float executeCO2Rules(CO2RuleState& state, float errorCO2) {
    // Sensor loss / corrupted sample: fail-safe OFF and clear the latch so a
    // later recovery starts from a known inactive state.
    if (!isFinite(errorCO2)) {
        state.exhaust_active = false;
        return 0.0f;
    }

    // errorCO2 = target - measured. Excess CO2 above the setpoint is therefore
    // the positive quantity (-errorCO2).
    const float excessCO2 = -errorCO2;

    if (!state.exhaust_active) {
        if (excessCO2 > CO2_ON_THRESHOLD_PPM) {
            state.exhaust_active = true;
        }
    } else {
        if (excessCO2 < CO2_OFF_THRESHOLD_PPM) {
            state.exhaust_active = false;
        }
    }

    if (!state.exhaust_active) {
        return 0.0f;
    }

    // The hysteresis stage deliberately requests full normalized demand. It
    // does not drive a relay or generate pulses: the downstream direct relay dispatcher
    // is the sole owner of SSR HIGH/LOW timing.
    return 1.0f;
}

ArbitratedOutputsPod arbitrateOutputs(
    const DualHeaterOutputsPod& thermalOutputs,
    float exhCO2,
    const AdaptiveTuner::GainsPod& gains,
    float lampGainScale,
    float mistGainScale) {
    // Apply dynamic scales with adaptive gains before the single final clamp.
    // Remote tuning may only influence HLamp and Mist.
    const float hLampDemand = clampUnit(
        safeUnit(thermalOutputs.HLamp) * safeGain(gains.gain_HLamp) *
        safeScale(lampGainScale));
    const float hWatDemand = clampUnit(
        safeUnit(thermalOutputs.HWat) * safeGain(gains.gain_HWat));
    const float mistDemand = clampUnit(
        safeUnit(thermalOutputs.Mist) * safeGain(gains.gain_Mist) *
        safeScale(mistGainScale));

    // Keep the CO2 and thermal/humidity rule bases independent until this
    // single arbitration point. std::max gives either demand full authority
    // to request the shared exhaust channel (CO2-high priority when larger).
    const float exhaustDemand = std::max(
        safeUnit(thermalOutputs.ExhTH),
        safeUnit(exhCO2));

    return ArbitratedOutputsPod{
        hLampDemand,
        hWatDemand,
        mistDemand,
        clampUnit(exhaustDemand),
    };
}

} // namespace FuzzyController
