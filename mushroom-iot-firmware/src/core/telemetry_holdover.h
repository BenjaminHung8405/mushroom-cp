#pragma once

#include <stdint.h>
#include <cmath>

// ---------------------------------------------------------------------------
// Last-known-good telemetry holdover for the CONTROL pipeline ONLY
// (fuzzy engine + inertia compensation).
//
// A transient I2C dropout blanks a sensor reading to NaN. Without holdover the
// fuzzy engine loses its error input for a full sensor cycle and its relay
// demand chatters even though the sensor is actually healthy. We keep a
// bounded-age last-good sample and reuse it while it is fresh; once it goes
// stale we fall back to NaN.
//
// SAFETY MUST NOT use this helper. Per README §1.3 the SystemProtector
// interlock and the manual safety gate are fail-closed by design and consume
// the RAW telemetry: a genuine sensor failure must trip an emergency cutoff
// immediately, never delayed by up to 15 s of stale last-good data.
//
// Publish/web paths must also keep the RAW telemetry so dashboards/InfluxDB
// report the dropout truthfully — this helper is not for them.
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
