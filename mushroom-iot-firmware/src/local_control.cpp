#include "local_control.h"
#include <math.h>
#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

namespace local_control
{
    // ---------------------------------------------------------------------------
    // Hard safety constants — independent of backend connectivity
    // ---------------------------------------------------------------------------
    constexpr float DEFAULT_TEMP_SP = 30.0f;
    constexpr float DEFAULT_HUMI_SP = 80.0f;
    constexpr float DEFAULT_CO2_SP = 1000.0f;
    constexpr float DEFAULT_TEMP_MIN = 28.0f;
    constexpr uint16_t DEFAULT_BLACKOUT_START = 11 * 60; // 11:00
    constexpr uint16_t DEFAULT_BLACKOUT_END = 13 * 60 + 30; // 13:30
    constexpr uint32_t DEFAULT_SETPOINT_TTL_MS = 120000UL;

    constexpr float HUMI_HYST = 2.0f;
    constexpr float TEMP_HYST = 0.5f;
    constexpr float TEMP_MIN_HYST = 0.5f;

    constexpr unsigned long MIST_MAX_ON_MS = 120000UL;
    constexpr unsigned long MIST_MIN_OFF_MS = 60000UL;
    constexpr unsigned long HEATER_MAX_ON_MS = 300000UL;
    constexpr unsigned long DEFOG_COOLDOWN_MS = 30000UL;

    static LocalSetpoints g_setpoints = {};
    static RelayOutputs g_outputs = {};
    static bool g_initialized = false;

    // Hysteresis latches + hard timers
    static bool g_mist_latched = false;
    static bool g_fan_latched = false;
    static bool g_heater_latched = false;
    static unsigned long g_mist_on_since = 0;
    static unsigned long g_mist_off_since = 0;
    static unsigned long g_heater_on_since = 0;
    static unsigned long g_defog_hold_until = 0;
    static bool g_was_defogging = false;

    // Last good sensor values (only updated when not defogging / finite)
    static float g_last_good_temp = NAN;
    static float g_last_good_humi = NAN;
    static float g_last_good_co2 = NAN;

    static LocalSetpoints make_defaults(unsigned long now_ms)
    {
        LocalSetpoints sp = {};
        sp.temperature_setpoint = DEFAULT_TEMP_SP;
        sp.humidity_setpoint = DEFAULT_HUMI_SP;
        sp.co2_setpoint = DEFAULT_CO2_SP;
        sp.temp_optimal_min = DEFAULT_TEMP_MIN;
        sp.thermal_shock_protection = true;
        sp.thermal_shock_start_min = DEFAULT_BLACKOUT_START;
        sp.thermal_shock_end_min = DEFAULT_BLACKOUT_END;
        sp.setpoint_ttl_ms = DEFAULT_SETPOINT_TTL_MS;
        sp.received_at_ms = 0; // never "fresh" until backend speaks
        sp.valid = false;
        (void)now_ms;
        return sp;
    }

    void init()
    {
        g_setpoints = make_defaults(0);
        g_outputs = {};
        g_mist_latched = false;
        g_fan_latched = false;
        g_heater_latched = false;
        g_mist_on_since = 0;
        g_mist_off_since = 0;
        g_heater_on_since = 0;
        g_defog_hold_until = 0;
        g_was_defogging = false;
        g_last_good_temp = NAN;
        g_last_good_humi = NAN;
        g_last_good_co2 = NAN;
        g_initialized = true;
        Serial.println("[LOCAL_CTRL] Initialized edge hysteresis safety controller.");
    }

    void update_setpoints(const LocalSetpoints &setpoints)
    {
        if (!g_initialized)
        {
            init();
        }
        g_setpoints = setpoints;
        g_setpoints.valid = true;
        if (g_setpoints.setpoint_ttl_ms == 0)
        {
            g_setpoints.setpoint_ttl_ms = DEFAULT_SETPOINT_TTL_MS;
        }
        Serial.printf(
            "[LOCAL_CTRL] Advisory setpoints updated: T=%.1f H=%.1f CO2=%.0f TTL=%lums\n",
            g_setpoints.temperature_setpoint,
            g_setpoints.humidity_setpoint,
            g_setpoints.co2_setpoint,
            static_cast<unsigned long>(g_setpoints.setpoint_ttl_ms));
    }

    void on_backend_link_lost()
    {
        // Force TTL expiry so next compute uses local defaults.
        g_setpoints.received_at_ms = 0;
        g_setpoints.valid = false;
        Serial.println("[LOCAL_CTRL] Backend link lost — falling back to local defaults.");
    }

    static bool setpoints_fresh(unsigned long now_ms)
    {
        if (!g_setpoints.valid || g_setpoints.received_at_ms == 0)
        {
            return false;
        }
        return (now_ms - g_setpoints.received_at_ms) <= g_setpoints.setpoint_ttl_ms;
    }

    static bool in_blackout(const LocalSetpoints &sp, unsigned long /*now_ms*/)
    {
        // Without NTP, wall-clock blackout is unreliable. Keep the flag available for
        // when RTC/NTP is present; for now only honor blackout if setpoints came from
        // backend with thermal_shock_protection and we treat it as advisory window only
        // when host provides wall time later. MVP: skip absolute time blackout if no RTC.
        // Safety still enforced via mist max-on duty.
        (void)sp;
        return false;
    }

    RelayOutputs compute(const TelemetryData &telemetry,
                         unsigned long now_ms,
                         bool sensor_defogging)
    {
        if (!g_initialized)
        {
            init();
        }

        // Defog hold: SHT30 heater biases temp UP and RH DOWN (finite, not NAN).
        // Hold last valid control outputs through heater + 30s cool-down.
        if (sensor_defogging)
        {
            g_was_defogging = true;
            g_defog_hold_until = now_ms + DEFOG_COOLDOWN_MS;
            Serial.println("[LOCAL_CTRL] Defog active — holding last relay outputs.");
            return g_outputs;
        }
        if (g_was_defogging || now_ms < g_defog_hold_until)
        {
            if (now_ms < g_defog_hold_until)
            {
                Serial.println("[LOCAL_CTRL] Defog cool-down — holding last relay outputs.");
                return g_outputs;
            }
            g_was_defogging = false;
        }

        // Update last-good only with finite samples outside defog.
        if (!isnan(telemetry.temp_air))
        {
            g_last_good_temp = telemetry.temp_air;
        }
        if (!isnan(telemetry.humidity_air))
        {
            g_last_good_humi = telemetry.humidity_air;
        }
        if (!isnan(telemetry.co2_level))
        {
            g_last_good_co2 = telemetry.co2_level;
        }

        LocalSetpoints active = setpoints_fresh(now_ms) ? g_setpoints : make_defaults(now_ms);
        if (!setpoints_fresh(now_ms) && g_setpoints.valid)
        {
            // Keep blackout prefs from last backend payload when possible.
            active.thermal_shock_protection = g_setpoints.thermal_shock_protection;
            active.thermal_shock_start_min = g_setpoints.thermal_shock_start_min;
            active.thermal_shock_end_min = g_setpoints.thermal_shock_end_min;
            active.temp_optimal_min = g_setpoints.temp_optimal_min > 0
                                          ? g_setpoints.temp_optimal_min
                                          : DEFAULT_TEMP_MIN;
        }

        const bool blackout = in_blackout(active, now_ms);
        RelayOutputs out = {};
        out.midday_blackout_active = blackout;

        // ---- Mist hysteresis + hard timers ----
        if (isnan(telemetry.humidity_air))
        {
            // Current SHT30 sample invalid → mist OFF immediately. Do not keep
            // spraying based on a stale last-good value when the sensor has failed.
            g_mist_latched = false;
            g_mist_off_since = (g_mist_off_since == 0) ? now_ms : g_mist_off_since;
        }
        else if (blackout)
        {
            g_mist_latched = false;
            g_mist_off_since = now_ms;
        }
        else
        {
            if (!g_mist_latched)
            {
                const bool min_off_ok =
                    (g_mist_off_since == 0) || (now_ms - g_mist_off_since >= MIST_MIN_OFF_MS);
                if (min_off_ok && g_last_good_humi < (active.humidity_setpoint - HUMI_HYST))
                {
                    g_mist_latched = true;
                    g_mist_on_since = now_ms;
                    g_mist_off_since = 0;
                }
            }
            else
            {
                if (g_last_good_humi > (active.humidity_setpoint + HUMI_HYST))
                {
                    g_mist_latched = false;
                    g_mist_off_since = now_ms;
                    g_mist_on_since = 0;
                }
                else if (g_mist_on_since > 0 && (now_ms - g_mist_on_since >= MIST_MAX_ON_MS))
                {
                    // Hard timer: never leave mist ON forever after lost OFF / stuck sensor.
                    Serial.println("[LOCAL_CTRL] MIST_MAX_ON reached — forcing mist OFF.");
                    g_mist_latched = false;
                    g_mist_off_since = now_ms;
                    g_mist_on_since = 0;
                }
            }
        }
        out.mist_active = g_mist_latched;

        // ---- Fan: cool or vent CO2; fail-safe ON when temp sensor invalid ----
        if (isnan(g_last_good_temp) && isnan(g_last_good_co2))
        {
            g_fan_latched = true; // prioritize safety ventilation
        }
        else
        {
            const bool hot = !isnan(g_last_good_temp) &&
                             g_last_good_temp > (active.temperature_setpoint + TEMP_HYST);
            const bool cool = !isnan(g_last_good_temp) &&
                              g_last_good_temp < (active.temperature_setpoint - TEMP_HYST);
            const bool high_co2 = !isnan(g_last_good_co2) &&
                                  g_last_good_co2 > active.co2_setpoint;
            const bool low_co2 = !isnan(g_last_good_co2) &&
                                 g_last_good_co2 < (active.co2_setpoint - 100.0f);

            if (hot || high_co2)
            {
                g_fan_latched = true;
            }
            else if (cool && low_co2)
            {
                g_fan_latched = false;
            }
            else if (isnan(g_last_good_temp))
            {
                g_fan_latched = true;
            }
        }
        out.fan_active = g_fan_latched;

        // ---- Heater: only when below min; OFF on invalid temp / blackout conflict ----
        if (isnan(g_last_good_temp) || blackout)
        {
            g_heater_latched = false;
            g_heater_on_since = 0;
        }
        else
        {
            if (!g_heater_latched)
            {
                if (g_last_good_temp < (active.temp_optimal_min - TEMP_MIN_HYST))
                {
                    g_heater_latched = true;
                    g_heater_on_since = now_ms;
                }
            }
            else
            {
                if (g_last_good_temp > (active.temp_optimal_min + TEMP_MIN_HYST))
                {
                    g_heater_latched = false;
                    g_heater_on_since = 0;
                }
                else if (g_heater_on_since > 0 &&
                         (now_ms - g_heater_on_since >= HEATER_MAX_ON_MS))
                {
                    Serial.println("[LOCAL_CTRL] HEATER_MAX_ON reached — forcing heater OFF.");
                    g_heater_latched = false;
                    g_heater_on_since = 0;
                }
            }
        }
        out.heater_active = g_heater_latched;

        g_outputs = out;
        return out;
    }

    const LocalSetpoints &get_active_setpoints()
    {
        return g_setpoints;
    }

    const RelayOutputs &get_last_outputs()
    {
        return g_outputs;
    }
}
