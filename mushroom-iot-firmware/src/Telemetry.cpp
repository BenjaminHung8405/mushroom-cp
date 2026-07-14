#include "Telemetry.h"
#include <ArduinoJson.h>

namespace Telemetry {

TelemetryState makeInitialState()
{
    TelemetryState state;
    state.lastPubState.temp_air = NAN;
    state.lastPubState.humidity_air = NAN;
    state.lastPubState.co2_level = NAN;
    state.lastPubState.actuators = RelayOutputsPod{false, false, false, false, false, false, {0, 0}};
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

PublishType evaluateDeltaThresholds(const TelemetryData& current, const TelemetryState& state, unsigned long nowMs)
{
    constexpr unsigned long KEEPALIVE_INTERVAL_MS = 10000UL; // 10 seconds; must stay below the UI stale threshold.

    const bool is_first = (state.lastPubTimeMs == 0UL);
    const bool keepalive_expired = is_first || (nowMs - state.lastPubTimeMs >= KEEPALIVE_INTERVAL_MS);

    if (state.forceFullPublish || keepalive_expired)
    {
        return PublishType::FULL;
    }

    const bool temp_changed = isDeltaExceeded(current.temp_air, state.lastPubState.temp_air, 0.2f);
    const bool humid_changed = isDeltaExceeded(current.humidity_air, state.lastPubState.humidity_air, 1.0f);
    const bool co2_changed = isDeltaExceeded(current.co2_level, state.lastPubState.co2_level, 10.0f);
    const RelayOutputsPod& now = current.actuators;
    const RelayOutputsPod& previous = state.lastPubState.actuators;
    const bool actuators_changed =
        now.mist_active != previous.mist_active ||
        now.fan_active != previous.fan_active ||
        now.lamp_stage_active != previous.lamp_stage_active ||
        now.lamp_stage2_active != previous.lamp_stage2_active ||
        now.heater_water_active != previous.heater_water_active ||
        now.midday_blackout_active != previous.midday_blackout_active;

    if (temp_changed || humid_changed || co2_changed || actuators_changed)
    {
        return PublishType::DELTA;
    }

    return PublishType::NONE;
}

void commitSuccessfulPublish(TelemetryState& state,
                             const TelemetryData& published,
                             unsigned long publishedAtMs)
{
    state.lastPubState = published;
    state.lastPubTimeMs = publishedAtMs;
    state.forceFullPublish = false;
}

namespace {

void addActuatorPayload(const RelayOutputsPod& actuators, JsonObject& root)
{
    JsonObject actuatorRoot = root.createNestedObject("actuators");
    actuatorRoot["mist_active"] = actuators.mist_active;
    actuatorRoot["fan_active"] = actuators.fan_active;
    actuatorRoot["lamp_stage_active"] = actuators.lamp_stage_active;
    actuatorRoot["lamp_stage2_active"] = actuators.lamp_stage2_active;
    actuatorRoot["heater_water_active"] = actuators.heater_water_active;
    actuatorRoot["midday_blackout_active"] = actuators.midday_blackout_active;
}

bool actuatorStateChanged(const RelayOutputsPod& current, const RelayOutputsPod& previous)
{
    return current.mist_active != previous.mist_active ||
           current.fan_active != previous.fan_active ||
           current.lamp_stage_active != previous.lamp_stage_active ||
           current.lamp_stage2_active != previous.lamp_stage2_active ||
           current.heater_water_active != previous.heater_water_active ||
           current.midday_blackout_active != previous.midday_blackout_active;
}

void buildFullPayload(const TelemetryData& current, JsonObject& root)
{
    if (std::isnan(current.temp_air)) {
        root["temp_air"] = nullptr;
    } else {
        root["temp_air"] = current.temp_air;
    }

    if (std::isnan(current.humidity_air)) {
        root["humidity_air"] = nullptr;
    } else {
        root["humidity_air"] = current.humidity_air;
    }

    if (std::isnan(current.co2_level)) {
        root["co2_level"] = nullptr;
    } else {
        root["co2_level"] = current.co2_level;
    }

    addActuatorPayload(current.actuators, root);
}

void buildChangedDeltaPayload(const TelemetryData& current, const TelemetryData& lastPubState, JsonObject& root)
{
    if (isDeltaExceeded(current.temp_air, lastPubState.temp_air, 0.2f))
    {
        if (std::isnan(current.temp_air)) {
            root["temp_air"] = nullptr;
        } else {
            root["temp_air"] = current.temp_air;
        }
    }

    if (isDeltaExceeded(current.humidity_air, lastPubState.humidity_air, 1.0f))
    {
        if (std::isnan(current.humidity_air)) {
            root["humidity_air"] = nullptr;
        } else {
            root["humidity_air"] = current.humidity_air;
        }
    }

    if (isDeltaExceeded(current.co2_level, lastPubState.co2_level, 10.0f))
    {
        if (std::isnan(current.co2_level)) {
            root["co2_level"] = nullptr;
        } else {
            root["co2_level"] = current.co2_level;
        }
    }

    if (actuatorStateChanged(current.actuators, lastPubState.actuators))
    {
        addActuatorPayload(current.actuators, root);
    }
}

} // namespace

String buildDeltaPayload(const TelemetryData& current, const TelemetryData& lastPubState, PublishType pubType)
{
    if (pubType == PublishType::NONE)
    {
        return "";
    }

    StaticJsonDocument<512> doc;
    JsonObject root = doc.to<JsonObject>();

    if (pubType == PublishType::FULL)
    {
        buildFullPayload(current, root);
    }
    else if (pubType == PublishType::DELTA)
    {
        buildChangedDeltaPayload(current, lastPubState, root);
    }

    String output;
    serializeJson(doc, output);
    return output;
}

} // namespace Telemetry

