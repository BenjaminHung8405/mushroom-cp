#include "Telemetry.h"

namespace Telemetry {

TelemetryState makeInitialState()
{
    TelemetryState state;
    state.lastPubState.temp_air = NAN;
    state.lastPubState.humidity_air = NAN;
    state.lastPubState.co2_level = NAN;
    state.lastPubTimeMs = 0UL;
    state.forceFullPublish = false;
    return state;
}

bool isDeltaExceeded(float val1, float val2, float threshold)
{
    const bool nan1 = std::isnan(val1);
    const bool nan2 = std::isnan(val2);

    if (nan1 != nan2)
    {
        return true; // State of sensor presence/reading changed
    }
    if (nan1)
    {
        return false; // Both are NAN, no change
    }

    return std::fabs(val1 - val2) > threshold;
}

PublishType evaluateDeltaThresholds(const TelemetryData& current, TelemetryState& state, unsigned long nowMs)
{
    constexpr unsigned long KEEPALIVE_INTERVAL_MS = 300000UL; // 5 minutes

    const bool is_first = (state.lastPubTimeMs == 0UL);
    const bool keepalive_expired = is_first || (nowMs - state.lastPubTimeMs >= KEEPALIVE_INTERVAL_MS);

    if (state.forceFullPublish || keepalive_expired)
    {
        state.lastPubState = current;
        state.lastPubTimeMs = nowMs;
        state.forceFullPublish = false;
        return PublishType::FULL;
    }

    const bool temp_changed = isDeltaExceeded(current.temp_air, state.lastPubState.temp_air, 0.2f);
    const bool humid_changed = isDeltaExceeded(current.humidity_air, state.lastPubState.humidity_air, 1.0f);
    const bool co2_changed = isDeltaExceeded(current.co2_level, state.lastPubState.co2_level, 10.0f);

    if (temp_changed || humid_changed || co2_changed)
    {
        state.lastPubState = current;
        state.lastPubTimeMs = nowMs;
        return PublishType::DELTA;
    }

    return PublishType::NONE;
}

} // namespace Telemetry
