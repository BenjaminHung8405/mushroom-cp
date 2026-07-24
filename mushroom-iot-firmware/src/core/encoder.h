#pragma once

#include <Arduino.h>
#include "core/models.h"

namespace encoder {

enum class EditField : uint8_t {
    Temperature,
    Humidity
};

enum class PersistenceState : uint8_t {
    Idle,
    Editing,
    PendingSave,
    PendingClear,
    Active,
    PersistenceError,
};

struct EncoderState {
    float temp_target;
    float humidity_target;
    bool override_active;
    bool editing;
    EditField field;
    bool persistence_pending;
    uint32_t persistent_sequence;
    PersistenceState persistence_state;
} __attribute__((aligned(4)));

void init();
void process(unsigned long now);
EncoderState getState();
void resetForTest();
#ifdef UNIT_TEST
void simulateClockEdgeForTest(bool dt_high, unsigned long now);
#endif

} // namespace encoder
