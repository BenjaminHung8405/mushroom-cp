#include "core/sst.h"

int IRAM_ATTR SlowSchmittTrigger::processLogic(bool isReadingActive) {
  if (isReadingActive) {
    if (counter < maxCnt) {
      counter = counter + 1;
      if (counter >= onThreshold) {
        counter = maxCnt;   
        if (state == 0) {
          state = 1;
          return EVENT_ON;
        }
      }
    }
  } else {
    if (counter > 0) {
      counter = counter - 1;
      if (counter <= offThreshold) {
        counter = 0;        
        if (state == 1) {
          state = 0;
          return EVENT_OFF; 
        }
      }
    }
  }
  return EVENT_NONE; 
}

void IRAM_ATTR SlowSchmittTrigger::tickISR(bool currentInputState) {
  isrTickCount = isrTickCount + 1;
  if (isrTickCount >= sampleInterval) {
    isrTickCount = 0;
#if defined(ESP32) && !defined(UNIT_TEST)
    portENTER_CRITICAL_ISR(&mux);
#endif
    int evt = processLogic(currentInputState);
    if (evt != EVENT_NONE) {
      pendingEvent = evt; 
    }
#if defined(ESP32) && !defined(UNIT_TEST)
    portEXIT_CRITICAL_ISR(&mux);
#endif
  }
}

void IRAM_ATTR SchmittTriggerInput::tickISR() {
  bool currentInputState = (digitalRead(pin) == activeState);
  SlowSchmittTrigger::tickISR(currentInputState);
}
