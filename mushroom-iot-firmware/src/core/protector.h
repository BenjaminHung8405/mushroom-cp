#pragma once
#include <stdint.h>
#include <array>
#include "core/models.h"
#include "core/manual_control.h"
#include "core/actuator_controller.h"

namespace protector {

struct ChannelProtectorState {
    bool is_on = false;
    uint32_t on_start_ms = 0;
    uint32_t lock_until_ms = 0; // Timestamp until which the channel is locked OFF
};

class SystemProtector {
private:
    std::array<ChannelProtectorState, static_cast<size_t>(AppChannel::COUNT)> states;
    bool prev_fuzzy_enabled = true;
    bool has_previous_fuzzy_mode = false;

public:
    SystemProtector();
    
    /**
     * @brief Updates and enforces the system protection rules on relay states.
     * Enforces the 3-minute continuous ON limit, 30s cooldown, absolute bio bounds, and manual override clears.
     */
    void update(
        uint32_t now,
        bool fuzzy_enabled,
        float temp_air,
        float humidity_air,
        manual::ManualLatchArray& manual_latches,
        relay_control::RelayStatePod& relay_states
    );

    void reset();
};

} // namespace protector
