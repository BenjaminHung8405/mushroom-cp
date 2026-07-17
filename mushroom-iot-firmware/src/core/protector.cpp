#include "core/protector.h"
#include "config.h"
#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

namespace protector {

namespace {

bool isLockActive(uint32_t now, uint32_t lock_until_ms) {
    return static_cast<int32_t>(lock_until_ms - now) > 0;
}

void clearManualLatch(manual::ManualLatchEntry& latch) {
    latch.active = false;
    latch.forced_state = AppIntent::AUTO;
    latch.expires_ms = 0;
}

bool get_channel_state(const relay_control::RelayStatePod& rs, AppChannel ch) {
    if (ch == AppChannel::MIST) return rs.mist_active;
    if (ch == AppChannel::LAMP) return rs.lamp_active;
    if (ch == AppChannel::FAN) return rs.fan_active;
    if (ch == AppChannel::HWAT) return rs.hwat_active;
    return false;
}

void set_channel_state(relay_control::RelayStatePod& rs, AppChannel ch, bool val) {
    if (ch == AppChannel::MIST) rs.mist_active = val;
    if (ch == AppChannel::LAMP) rs.lamp_active = val;
    if (ch == AppChannel::FAN) rs.fan_active = val;
    if (ch == AppChannel::HWAT) rs.hwat_active = val;
}

} // namespace

SystemProtector::SystemProtector() {
    reset();
}

void SystemProtector::reset() {
    prev_fuzzy_enabled = true;
    has_previous_fuzzy_mode = false;
    for (auto& state : states) {
        state.is_on = false;
        state.on_start_ms = 0;
        state.lock_until_ms = 0;
    }
}

void SystemProtector::update(
    uint32_t now,
    bool fuzzy_enabled,
    float temp_air,
    float humidity_air,
    bool mist_blackout_active,
    manual::ManualLatchArray& manual_latches,
    relay_control::RelayStatePod& relay_states
) {
    // A startup in AOFF is not an AON -> AOFF transition. Capture the
    // initial mode first; actual runtime transitions are handled below.
    if (!has_previous_fuzzy_mode) {
        prev_fuzzy_enabled = fuzzy_enabled;
        has_previous_fuzzy_mode = true;
    }

    // Mode transitions are atomically applied by Core 1 before this method.
    // Do not clear relays or latches here: that would race policy ownership and
    // violates the Fuzzy ON -> OFF bumpless-transfer requirement.
    prev_fuzzy_enabled = fuzzy_enabled;

    // 2. Process each channel
    for (size_t i = 0; i < static_cast<size_t>(AppChannel::COUNT); ++i) {
        AppChannel ch = static_cast<AppChannel>(i);
        ChannelProtectorState& state = states[i];

        // Priority 1: The time-confidence/midday interlock is non-bypassable.
        // It is evaluated before all protector rules so a low-humidity rule
        // cannot re-enable Mist during the blackout window.
        if (ch == AppChannel::MIST && mist_blackout_active) {
            set_channel_state(relay_states, ch, false);
            clearManualLatch(manual_latches[i]);
            state.is_on = false;
            state.on_start_ms = 0;
            continue;
        }

        // Priority 2: Cooldown / Forced-OFF Lock
        if (isLockActive(now, state.lock_until_ms)) {
            set_channel_state(relay_states, ch, false);
            // A persistent Fuzzy-OFF FORCE_ON remains an operator intent while
            // the relay cools down, so it can be safely reconsidered later.
            if (fuzzy_enabled || manual_latches[i].forced_state != AppIntent::FORCE_ON) {
                clearManualLatch(manual_latches[i]);
            }
            state.is_on = false;
            state.on_start_ms = 0;
            continue; // Force override, bypass bio rule ON checks
        }

        // Priority 3: Absolute Bio Bounds Guarding
        if (ch == AppChannel::LAMP && std::isfinite(temp_air)) {
            if (temp_air >= config::hardware::ThTOP) {
                // Over-temp: Turn OFF heating lamp and Lock for 5 minutes (300,000ms)
                set_channel_state(relay_states, ch, false);
                clearManualLatch(manual_latches[i]);
                state.lock_until_ms = now + config::hardware::LAMP_OVER_TEMP_COOLDOWN_MS;
                state.is_on = false;
                state.on_start_ms = 0;
                continue;
            } else if (temp_air <= config::hardware::ThBOT) {
                // Under-temp: Force heating Lamp ON
                set_channel_state(relay_states, ch, true);
            }
        } else if (ch == AppChannel::MIST && std::isfinite(humidity_air)) {
            if (humidity_air >= config::hardware::HmTOP) {
                // Over-humidity: Turn OFF mist and Lock for 10 minutes (600,000ms)
                set_channel_state(relay_states, ch, false);
                clearManualLatch(manual_latches[i]);
                state.lock_until_ms = now + config::hardware::MIST_OVER_HUMIDITY_COOLDOWN_MS;
                state.is_on = false;
                state.on_start_ms = 0;
                continue;
            } else if (humidity_air <= config::hardware::HmBOT) {
                // Under-humidity: Force mist pump ON
                set_channel_state(relay_states, ch, true);
            }
        }

        // Priority 4: Normal checking and continuous limit (3-minute ON -> 30s OFF cooldown)
        bool final_active = get_channel_state(relay_states, ch);

        if (final_active) {
            if (!state.is_on) {
                state.is_on = true;
                state.on_start_ms = now;
            } else {
                if (now - state.on_start_ms >= config::hardware::MAX_ON_DURATION_MS) { // 3 minutes ON
                    // Force OFF and Lock for 30s (30,000ms)
                    set_channel_state(relay_states, ch, false);
                    // Persistent Fuzzy-OFF FORCE_ON survives the cooldown and is
                    // reevaluated after the lock expires. Timed Fuzzy-ON latches
                    // are released as before.
                    if (fuzzy_enabled || manual_latches[i].forced_state != AppIntent::FORCE_ON) {
                        clearManualLatch(manual_latches[i]);
                    }
                    state.lock_until_ms = now + config::hardware::COOLDOWN_DURATION_MS;
                    state.is_on = false;
                    state.on_start_ms = 0;
                }
            }
        } else {
            state.is_on = false;
            state.on_start_ms = 0;
        }
    }
}

} // namespace protector
