#pragma once

#include "core/models.h"

namespace schedule {

/** Returns false when a valid profile does not cover the requested crop day. */
bool isLampAllowedBySchedule(uint16_t crop_day, const PersistedCropProfile& profile);

} // namespace schedule
