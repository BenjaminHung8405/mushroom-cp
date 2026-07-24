#include "core/crop_profile_storage.h"
#include <Preferences.h>
#include "config.h"
#include <iostream>
#include <cstddef>
#include <cstring>

namespace storage {

namespace {

constexpr uint32_t CROP_PROFILE_MAGIC = 0x43524F50;
constexpr const char* CROP_PROFILE_KEY = "crop_profile";

struct LegacyPersistedCropProfileV1 {
    uint32_t magic;
    uint16_t schema_version;
    uint16_t checkpoint_count;
    int64_t crop_start_epoch_s;
    uint16_t total_crop_days;
    CropCheckpoint checkpoints[MAX_CROP_CHECKPOINTS];
    uint32_t crc32;
} __attribute__((aligned(4)));

static_assert(alignof(LegacyPersistedCropProfileV1) == 4, "Legacy profile layout changed");
static_assert(offsetof(LegacyPersistedCropProfileV1, crc32) + sizeof(uint32_t) ==
              sizeof(LegacyPersistedCropProfileV1), "Legacy CRC must remain at blob end");
static_assert(offsetof(PersistedCropProfile, crc32) + sizeof(uint32_t) ==
              sizeof(PersistedCropProfile), "Profile CRC must remain at blob end");

bool isValidV2Profile(const PersistedCropProfile& profile) {
    if (profile.magic != CROP_PROFILE_MAGIC ||
        profile.storage_version != CROP_PROFILE_STORAGE_VERSION) {
        return false;
    }
    const uint32_t calculated = CropProfileStorage::calculateCRC32(
        reinterpret_cast<const uint8_t*>(&profile), offsetof(PersistedCropProfile, crc32));
    return calculated == profile.crc32;
}

bool isValidLegacyProfile(const LegacyPersistedCropProfileV1& profile) {
    if (profile.magic != CROP_PROFILE_MAGIC) return false;
    const uint32_t calculated = CropProfileStorage::calculateCRC32(
        reinterpret_cast<const uint8_t*>(&profile), offsetof(LegacyPersistedCropProfileV1, crc32));
    return calculated == profile.crc32;
}

void setDefaultLightSchedule(PersistedCropProfile& profile) {
    profile.light_schedule_count = profile.total_crop_days <= 8 ? 1 : 2;
    profile.light_schedule[0] = {
        1,
        static_cast<uint16_t>(profile.total_crop_days <= 8 ? profile.total_crop_days : 8),
        1,
        0,
    };
    if (profile.total_crop_days > 8) {
        profile.light_schedule[1] = {9, profile.total_crop_days, 0, 0};
    }
}

bool writeProfileV2(const PersistedCropProfile& profile) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) return false;
    const size_t written = prefs.putBytes(CROP_PROFILE_KEY, &profile, sizeof(profile));
    prefs.end();
    if (written != sizeof(profile)) return false;

    Preferences verifyPrefs;
    if (!verifyPrefs.begin(config::network::NVS_NAMESPACE, true)) return false;
    PersistedCropProfile verified{};
    const size_t read = verifyPrefs.getBytes(CROP_PROFILE_KEY, &verified, sizeof(verified));
    verifyPrefs.end();
    return read == sizeof(verified) && isValidV2Profile(verified);
}

} // namespace

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
    if (!isValidV2Profile(profile)) return false;
    return writeProfileV2(profile);
}

bool CropProfileStorage::loadProfile(PersistedCropProfile &profile) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) {
        return false;
    }
    const size_t storedLength = prefs.getBytesLength(CROP_PROFILE_KEY);
    if (storedLength == 0) {
        prefs.end();
        return false;
    }

    if (storedLength == sizeof(PersistedCropProfile)) {
        PersistedCropProfile loaded{};
        const size_t read = prefs.getBytes(CROP_PROFILE_KEY, &loaded, sizeof(loaded));
        prefs.end();
        if (read != sizeof(loaded) || !isValidV2Profile(loaded)) return false;
        profile = loaded;
        return true;
    }

    if (storedLength != sizeof(LegacyPersistedCropProfileV1)) {
        Serial.printf("[NVS] Unsupported crop profile blob length: %u\n", static_cast<unsigned>(storedLength));
        prefs.end();
        return false;
    }

    LegacyPersistedCropProfileV1 legacy{};
    const size_t read = prefs.getBytes(CROP_PROFILE_KEY, &legacy, sizeof(legacy));
    prefs.end();
    if (read != sizeof(legacy) || !isValidLegacyProfile(legacy)) {
        Serial.println("[NVS] Legacy crop profile failed integrity verification; refusing migration.");
        return false;
    }

    PersistedCropProfile migrated{};
    migrated.magic = legacy.magic;
    migrated.schema_version = legacy.schema_version;
    migrated.storage_version = CROP_PROFILE_STORAGE_VERSION;
    migrated.checkpoint_count = legacy.checkpoint_count;
    migrated.crop_start_epoch_s = legacy.crop_start_epoch_s;
    migrated.total_crop_days = legacy.total_crop_days;
    std::memcpy(migrated.checkpoints, legacy.checkpoints, sizeof(migrated.checkpoints));
    setDefaultLightSchedule(migrated);
    migrated.crc32 = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&migrated), offsetof(PersistedCropProfile, crc32));
    if (!writeProfileV2(migrated)) {
        Serial.println("[NVS] Failed to durably rewrite migrated crop profile.");
        return false;
    }
    Serial.printf("[NVS] Migrated crop profile V1 (%u bytes) to V2 (%u bytes).\n",
                  static_cast<unsigned>(sizeof(legacy)), static_cast<unsigned>(sizeof(migrated)));
    profile = migrated;
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
