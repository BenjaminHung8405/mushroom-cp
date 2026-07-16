#include "core/crop_profile_validator.h"
#include <cmath>

namespace storage {

bool CropProfileValidator::validate(const PersistedCropProfile &profile) {
    if (profile.magic != 0x43524F50) {
        return false;
    }

    if (profile.checkpoint_count == 0 || profile.checkpoint_count > MAX_CROP_CHECKPOINTS) {
        return false;
    }

    if (profile.total_crop_days == 0) {
        return false;
    }

    if (profile.crop_start_epoch_s < 0) {
        return false;
    }

    uint16_t last_day = 0;
    for (uint16_t i = 0; i < profile.checkpoint_count; i++) {
        const auto &cp = profile.checkpoints[i];

        // Check range of day
        if (cp.crop_day < 1 || cp.crop_day > profile.total_crop_days) {
            return false;
        }

        // Must be strictly increasing order
        if (cp.crop_day <= last_day) {
            return false;
        }
        last_day = cp.crop_day;

        // Check temp and humidity target limits
        if (!std::isfinite(cp.temp_target_c) || cp.temp_target_c < 10.0f || cp.temp_target_c > 45.0f) {
            return false;
        }

        if (!std::isfinite(cp.humidity_target_rh) || cp.humidity_target_rh < 30.0f || cp.humidity_target_rh > 95.0f) {
            return false;
        }
    }

    return true;
}

} // namespace storage
