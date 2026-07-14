#pragma once
#include "models.h"

namespace time_conf {

TimeConfidence getTimeConfidence();
void setTimeConfidence(TimeConfidence conf);

// Pure / Read-only / Transition helper functions
void initializeTimeConfidence(bool hasValidHardwareRtc);
void onTimeSyncSuccess(int64_t current_epoch_s);
void onConnectionLoss();

} // namespace time_conf
