#pragma once
#include <stdint.h>
#include "core/models.h"

namespace time_conf {

constexpr uint32_t HOLDOVER_MAX_MS = 48UL * 60UL * 60UL * 1000UL;

TimeConfidence getTimeConfidence();
void setTimeConfidence(TimeConfidence conf);

void initializeTimeConfidence(bool hasValidHardwareRtc);
void onTimeSyncSuccess(int64_t current_epoch_s);
void onConnectionLoss();

/** Advances Holdover to Uncertain after the maximum permitted NTP age. */
void refresh();
/** True only while the clock is trusted or still within its 48-hour holdover. */
bool isTimeUsable();

} // namespace time_conf
