#pragma once

#include <stdint.h>
#include "models.h"

namespace local_control
{
    /**
     * @brief Advisory setpoints from backend MQTT. Edge remains the safety authority.
     */
    struct LocalSetpoints
    {
        float temperature_setpoint;   ///< Target air temp °C
        float humidity_setpoint;      ///< Target RH %
        float co2_setpoint;           ///< CO2 ppm threshold for fan assist
        float temp_optimal_min;       ///< Heater ON threshold floor
        bool thermal_shock_protection;
        uint16_t thermal_shock_start_min; ///< Minutes since midnight local
        uint16_t thermal_shock_end_min;
        uint32_t setpoint_ttl_ms;
        unsigned long received_at_ms;
        bool valid;
    };

    struct RelayOutputs
    {
        bool mist_active;
        bool fan_active;
        bool heater_active;
        bool midday_blackout_active;
    };

    void init();

    /**
     * @brief Apply advisory setpoints from a validated MQTT payload.
     * Does not latch raw relay commands as permanent authority.
     */
    void update_setpoints(const LocalSetpoints &setpoints);

    /**
     * @brief Mark backend link lost so TTL immediately expires.
     */
    void on_backend_link_lost();

    /**
     * @brief Core 1 safety compute: hysteresis + hard timers + defog hold.
     * @param telemetry Latest sensor sample (may contain NAN)
     * @param now_ms millis()
     * @param sensor_defogging true while SHT30 heater is ON or in cooldown
     */
    RelayOutputs compute(const TelemetryData &telemetry,
                         unsigned long now_ms,
                         bool sensor_defogging);

    const LocalSetpoints &get_active_setpoints();
    const RelayOutputs &get_last_outputs();
}
