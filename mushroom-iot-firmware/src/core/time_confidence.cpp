#include "core/time_confidence.h"
#include "core/crop_profile_storage.h"
#include <cmath>
#include <cstddef>

namespace time_conf {
namespace {
TimeConfidence g_confidence = TimeConfidence::Uncertain;
int64_t g_last_synced_epoch_s = 0;
int64_t g_last_persisted_epoch_s = 0;
uint32_t g_last_synced_uptime_ms = 0;

bool holdoverExpired(uint32_t now) {
    return g_last_synced_epoch_s <= 0 ||
        static_cast<uint32_t>(now - g_last_synced_uptime_ms) >= HOLDOVER_MAX_MS;
}
} // namespace

TimeConfidence getTimeConfidence() {
    refresh();
    return g_confidence;
}

void setTimeConfidence(TimeConfidence conf) {
    g_confidence = conf;
    // Test/RTC integration hook: callers that explicitly grant trust establish
    // a fresh monotonic reference so refresh() cannot immediately revoke it.
    if (conf == TimeConfidence::Trusted) {
        if (g_last_synced_epoch_s <= 0) g_last_synced_epoch_s = 1;
        g_last_synced_uptime_ms = millis();
    }
}

void initializeTimeConfidence(bool hasValidHardwareRtc) {
    // There is no external RTC in this deployment. A persisted epoch alone cannot
    // prove elapsed wall time across a reboot, so it never promotes the clock.
    g_confidence = hasValidHardwareRtc ? TimeConfidence::Trusted : TimeConfidence::Uncertain;
    g_last_synced_epoch_s = hasValidHardwareRtc ? 1 : 0;
    g_last_persisted_epoch_s = 0;
    g_last_synced_uptime_ms = hasValidHardwareRtc ? millis() : 0;
}

void onTimeSyncSuccess(int64_t current_epoch_s) {
    if (current_epoch_s <= 0) return;
    const uint32_t now = millis();
    g_confidence = TimeConfidence::Trusted;
    g_last_synced_epoch_s = current_epoch_s;
    g_last_synced_uptime_ms = now;

    // Persist at most once per 30 minutes to avoid NVS wear; the in-memory
    // monotonic timestamp still records every confirmed SNTP synchronization.
    if (std::llabs(current_epoch_s - g_last_persisted_epoch_s) >= 1800) {
        PersistedTimeState state{};
        state.last_trusted_epoch_s = current_epoch_s;
        state.last_trusted_uptime_ms = now;
        state.crc32 = storage::CropProfileStorage::calculateCRC32(
            reinterpret_cast<const uint8_t*>(&state), offsetof(PersistedTimeState, crc32));
        if (storage::CropProfileStorage::getInstance().saveTimeState(state)) {
            g_last_persisted_epoch_s = current_epoch_s;
        }
    }
}

void onConnectionLoss() {
    refresh();
    if (g_confidence == TimeConfidence::Trusted) g_confidence = TimeConfidence::Holdover;
}

void refresh() {
    if ((g_confidence == TimeConfidence::Trusted || g_confidence == TimeConfidence::Holdover) &&
        holdoverExpired(millis())) {
        g_confidence = TimeConfidence::Uncertain;
    }
}

bool isTimeUsable() {
    refresh();
    return g_confidence == TimeConfidence::Trusted || g_confidence == TimeConfidence::Holdover;
}

} // namespace time_conf
