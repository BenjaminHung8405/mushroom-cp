#include "core/crop_profile_storage.h"
#include <Preferences.h>
#include "config.h"
#include <iostream>
#include <cstddef>

namespace storage {

CropProfileStorage& CropProfileStorage::getInstance() {
    static CropProfileStorage instance;
    return instance;
}

bool CropProfileStorage::init() {
    Preferences prefs;
    if (prefs.begin(config::network::NVS_NAMESPACE, false)) {
        prefs.end();
        return true;
    }
    return false;
}

uint32_t CropProfileStorage::calculateCRC32(const uint8_t *data, size_t length) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    return ~crc;
}

bool CropProfileStorage::saveProfile(const PersistedCropProfile &profile) {
    // Check if same profile is already saved to limit flash wear
    PersistedCropProfile current;
    if (loadProfile(current)) {
        if (current.crc32 == profile.crc32 && current.magic == profile.magic) {
            return true; // Already saved
        }
    }

    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    size_t written = prefs.putBytes("crop_profile", &profile, sizeof(profile));
    prefs.end();
    return (written == sizeof(profile));
}

bool CropProfileStorage::loadProfile(PersistedCropProfile &profile) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) {
        return false;
    }

    size_t read = prefs.getBytes("crop_profile", &profile, sizeof(profile));
    prefs.end();

    if (read != sizeof(profile)) {
        return false;
    }

    // Verify magic
    if (profile.magic != 0x43524F50) { // 'C','R','O','P'
        return false;
    }

    // Verify CRC
    uint32_t calculated = calculateCRC32(reinterpret_cast<const uint8_t*>(&profile), sizeof(profile) - sizeof(uint32_t));
    if (calculated != profile.crc32) {
        return false;
    }

    return true;
}

bool CropProfileStorage::clearProfile() {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }
    bool res = prefs.remove("crop_profile");
    prefs.end();
    return res;
}

bool CropProfileStorage::saveProfileConfigRevision(uint32_t revision) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) return false;
    const size_t written = prefs.putUInt("prof_rev", revision);
    prefs.end();
    return written == sizeof(uint32_t);
}

bool CropProfileStorage::loadProfileConfigRevision(uint32_t &revision) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) return false;
    if (!prefs.isKey("prof_rev")) { prefs.end(); return false; }
    revision = prefs.getUInt("prof_rev", 0);
    prefs.end();
    return true;
}

bool CropProfileStorage::saveTimeState(const PersistedTimeState &state) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    size_t written = prefs.putBytes("time_state", &state, sizeof(state));
    prefs.end();
    return (written == sizeof(state));
}

bool CropProfileStorage::loadTimeState(PersistedTimeState &state) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) {
        return false;
    }

    size_t read = prefs.getBytes("time_state", &state, sizeof(state));
    prefs.end();

    if (read != sizeof(state)) {
        return false;
    }

    // Verify CRC
    uint32_t calculated = calculateCRC32(reinterpret_cast<const uint8_t*>(&state), offsetof(PersistedTimeState, crc32));
    if (calculated != state.crc32) {
        return false;
    }

    return true;
}

bool CropProfileStorage::clearTimeState() {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }
    bool res = prefs.remove("time_state");
    prefs.end();
    return res;
}

bool CropProfileStorage::saveManualOverride(AppChannel channel, const PersistedManualOverride &override) {
    String key = "movr_" + String(static_cast<uint8_t>(channel));
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    size_t written = prefs.putBytes(key.c_str(), &override, sizeof(override));
    prefs.end();
    return (written == sizeof(override));
}

bool CropProfileStorage::loadManualOverride(AppChannel channel, PersistedManualOverride &override) {
    String key = "movr_" + String(static_cast<uint8_t>(channel));
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) {
        return false;
    }

    size_t read = prefs.getBytes(key.c_str(), &override, sizeof(override));
    prefs.end();
    return (read == sizeof(override));
}

bool CropProfileStorage::clearManualOverride(AppChannel channel) {
    String key = "movr_" + String(static_cast<uint8_t>(channel));
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }
    bool res = prefs.remove(key.c_str());
    prefs.end();
    return res;
}

} // namespace storage
