#include "time_confidence.h"

namespace time_conf {

static TimeConfidence g_confidence = TimeConfidence::Uncertain;

TimeConfidence getTimeConfidence() {
    return g_confidence;
}

void setTimeConfidence(TimeConfidence conf) {
    g_confidence = conf;
}

} // namespace time_conf
