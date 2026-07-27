#pragma once

#include <stdint.h>
#include <cmath>

// ---------------------------------------------------------------------------
// Last-known-good telemetry holdover for the control/safety pipeline ONLY.
//
// A transient I2C dropout blanks a sensor reading to NaN. Without holdover the
// manual safety gate fail-closes (e.g. MIST -> RejectedNAN) for up to a full
// sensor cycle, wrongly refusing a valid actuator command even though the
// sensor is actually healthy. We keep a bounded-age last-good sample and reuse
// it while it is fresh; once it goes stale we fall back to NaN so the gate
// still fails closed on genuinely missing data.
//
// Publish/web paths must keep the RAW telemetry so dashboards/InfluxDB report
// the dropout truthfully — this helper is not for them.
//
// Header-only + free functions so the host unit-test build can exercise it
// without extra translation units.
// ---------------------------------------------------------------------------
namespace telemetry_holdover {

/** One channel's last finite reading and when it was observed (millis()). */
struct LastGoodSample {
    float value = NAN;
    uint32_t ts_ms = 0U;
    bool valid = false;  // distinguishes "never seen a good value" from ts==0 at boot
};

/** Record a fresh reading as last-good only when it is finite. */
inline void updateLastGood(LastGoodSample& sample, float raw, uint32_t now)
{
    if (std::isfinite(raw)) {
        sample.value = raw;
        sample.ts_ms = now;
        sample.valid = true;
    }
}

/**
 * Holdover-backed value for control/safety:
 *   - raw finite            -> raw
 *   - raw NaN, fresh last-good (age <= maxAgeMs) -> last-good value
 *   - otherwise             -> NaN (fail-closed)
 *
 * Age uses unsigned subtraction so it stays correct across the millis() wrap
 * (~49.7 days). `valid` guards the "no good sample yet" case at boot.
 */
inline float holdoverValue(float raw, const LastGoodSample& sample,
                           uint32_t now, uint32_t maxAgeMs)
{
    if (std::isfinite(raw)) {
        return raw;
    }
    if (sample.valid && (uint32_t)(now - sample.ts_ms) <= maxAgeMs) {
        return sample.value;
    }
    return NAN;
}

} // namespace telemetry_holdover
