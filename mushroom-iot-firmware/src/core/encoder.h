#pragma once

#include <Arduino.h>
#include "core/models.h"

namespace encoder {

enum class EditField : uint8_t {
    Temperature,
    Humidity
};

struct EncoderState {
    float temp_target;
    float humidity_target;
    bool override_active;
    bool editing;
    EditField field;
} __attribute__((aligned(4)));

void init();
void process(unsigned long now);
EncoderState getState();
void resetForTest();
#ifdef UNIT_TEST
void simulateClockEdgeForTest(bool dt_high, unsigned long now);
#endif

} // namespace encoder
