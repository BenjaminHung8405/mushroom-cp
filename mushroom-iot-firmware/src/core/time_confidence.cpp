#include "core/time_confidence.h"
#include "core/crop_profile_storage.h"
#include "core/storage.h"
#include <iostream>
#include <cmath>
#include <cstddef>

namespace time_conf {

static TimeConfidence g_confidence = TimeConfidence::Uncertain;
static int64_t g_last_synced_epoch_s = 0;

TimeConfidence getTimeConfidence() {
    return g_confidence;
}

void setTimeConfidence(TimeConfidence conf) {
    g_confidence = conf;
}

void initializeTimeConfidence(bool hasValidHardwareRtc) {
    if (hasValidHardwareRtc) {
        g_confidence = TimeConfidence::Trusted;
    } else {
        g_confidence = TimeConfidence::Uncertain;
    }
}

void onTimeSyncSuccess(int64_t current_epoch_s) {
    g_confidence = TimeConfidence::Trusted;
    
    // Bounded NVS persist cadence to avoid flash wear
    if (std::abs(current_epoch_s - g_last_synced_epoch_s) >= 1800) { // Sync every 30 mins
        g_last_synced_epoch_s = current_epoch_s;
        PersistedTimeState state{};
        state.last_trusted_epoch_s = current_epoch_s;
        state.last_trusted_uptime_ms = millis();
        state.crc32 = storage::CropProfileStorage::calculateCRC32(
            reinterpret_cast<const uint8_t*>(&state),
            offsetof(PersistedTimeState, crc32)
        );
        storage::CropProfileStorage::getInstance().saveTimeState(state);
    }
}

void onConnectionLoss() {
    if (g_confidence == TimeConfidence::Trusted) {
        g_confidence = TimeConfidence::Holdover;
    }
}

} // namespace time_conf
