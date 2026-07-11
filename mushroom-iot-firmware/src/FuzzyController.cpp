#include "FuzzyController.h"

#include <cmath>

namespace FuzzyController {
namespace {

// Full-scale error magnitudes that map to unit demand.
// These keep the dual-heater stage hardware-independent and easy to unit-test.
constexpr float TEMP_COLD_FULL = 4.0f;   // °C
constexpr float TEMP_HOT_FULL = 4.0f;    // °C
constexpr float HUMID_DRY_FULL = 20.0f;  // %RH
constexpr float HUMID_WET_FULL = 20.0f;  // %RH

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

    const float cold = risingDemand(errorTemp, TEMP_COLD_FULL);
    const float hot = risingDemand(-errorTemp, TEMP_HOT_FULL);
    const float dry = risingDemand(errorHumid, HUMID_DRY_FULL);
    const float wet = risingDemand(-errorHumid, HUMID_WET_FULL);

    // Cold & dry: air heat has priority; mist only receives residual budget.
    outputs.HAir = cold * (1.0f - wet);
    outputs.Mist = dry * (1.0f - cold);

    // Cold & wet: water heat only; no mist and no thermal exhaust.
    outputs.HWat = cold * wet;

    // When not cold, excess humidity is vented. Over-temperature also
    // independently requests exhaust. CO2 exhaust is merged later (B3).
    const float humidityExhaust = wet * (1.0f - cold);
    outputs.ExhTH = (hot > humidityExhaust) ? hot : humidityExhaust;

    outputs.HAir = clampUnit(outputs.HAir);
    outputs.HWat = clampUnit(outputs.HWat);
    outputs.Mist = clampUnit(outputs.Mist);
    outputs.ExhTH = clampUnit(outputs.ExhTH);
    return outputs;
}

} // namespace FuzzyController
