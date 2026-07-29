#include "core/light_schedule.h"

namespace schedule {

bool isLampAllowedBySchedule(uint16_t crop_day, const PersistedCropProfile& profile) {
    if (crop_day == 0U ||
        crop_day > profile.total_crop_days ||
        profile.light_schedule_count == 0U ||
        profile.light_schedule_count > MAX_LIGHT_SCHEDULE_BLOCKS) {
        return false;
    }

    for (uint16_t i = 0; i < profile.light_schedule_count; ++i) {
        const LightScheduleBlock& block = profile.light_schedule[i];
        if (crop_day >= block.start_day && crop_day <= block.end_day) {
            return block.status == 1U;
        }
    }
    return false;
}

} // namespace schedule
