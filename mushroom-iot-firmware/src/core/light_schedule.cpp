#include "core/light_schedule.h"

namespace schedule {

bool isLampAllowedBySchedule(uint16_t crop_day, const PersistedCropProfile& profile) {
    for (uint16_t i = 0; i < profile.light_schedule_count; ++i) {
        const LightScheduleBlock& block = profile.light_schedule[i];
        if (crop_day >= block.start_day && crop_day <= block.end_day) {
            return block.status == 1U;
        }
    }
    return false;
}

} // namespace schedule
