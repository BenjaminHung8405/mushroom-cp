#pragma once

#include "core/models.h"
#include <Arduino.h>

namespace storage {

class CropProfileStorage {
public:
    static CropProfileStorage& getInstance();

    CropProfileStorage(const CropProfileStorage&) = delete;
    CropProfileStorage& operator=(const CropProfileStorage&) = delete;

    bool init();

    bool saveProfile(const PersistedCropProfile &profile);
    bool loadProfile(PersistedCropProfile &profile);
    bool clearProfile();

    bool saveTimeState(const PersistedTimeState &state);
    bool loadTimeState(PersistedTimeState &state);
    bool clearTimeState();

    bool saveManualOverride(AppChannel channel, const PersistedManualOverride &override);
    bool loadManualOverride(AppChannel channel, PersistedManualOverride &override);
    bool clearManualOverride(AppChannel channel);

    static uint32_t calculateCRC32(const uint8_t *data, size_t length);

private:
    CropProfileStorage() = default;
    ~CropProfileStorage() = default;
};

} // namespace storage
