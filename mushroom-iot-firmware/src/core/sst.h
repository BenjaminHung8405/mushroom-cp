#ifndef SST_H
#define SST_H

#include <Arduino.h>

// Định nghĩa các sự kiện trả về
#define EVENT_NONE  0
#define EVENT_ON    1
#define EVENT_OFF   -1

class SlowSchmittTrigger {
  protected:
    int maxCnt;             
    int onThreshold;        
    int offThreshold;       
    
    // Các biến dùng chung giữa ISR và main loop BẮT BUỘC phải có 'volatile'
    volatile int counter;            
    volatile uint8_t state;          
    volatile int pendingEvent; // Lưu trữ sự kiện sinh ra từ ngắt
    
    unsigned long sampleInterval; // Chu kỳ lấy mẫu (ms)
    
    // Biến cho chế độ millis()
    unsigned long lastSampleTime;

    // Biến cho chế độ Ngắt Timer (bộ chia tần số)
    volatile unsigned int isrTickCount;

#if defined(ESP32) && !defined(UNIT_TEST)
    portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
#endif

    // Lõi logic tách riêng để dùng chung cho cả 2 chế độ
    int processLogic(bool isReadingActive);

  public:
    SlowSchmittTrigger(int _maxCnt, int _onThresh, int _offThresh, unsigned long _intervalMs) {
      maxCnt = _maxCnt;
      onThreshold = _onThresh;
      offThreshold = _offThresh;
      sampleInterval = _intervalMs;
      
      counter = 0;
      state = 0;
      pendingEvent = EVENT_NONE;
      lastSampleTime = 0;
      isrTickCount = 0;
    }

    void reset() {
      counter = 0;
      state = 0;
      pendingEvent = EVENT_NONE;
      lastSampleTime = 0;
      isrTickCount = 0;
    }

    // =======================================================
    // CHẾ ĐỘ 1: DÙNG TRONG LOOP (NON-BLOCKING BẰNG MILLIS)
    // =======================================================
    int update(bool currentInputState) {
      if (millis() - lastSampleTime < sampleInterval) return EVENT_NONE; 
      lastSampleTime = millis();
#if defined(ESP32) && !defined(UNIT_TEST)
      portENTER_CRITICAL(&mux);
#else
      noInterrupts();
#endif
      int evt = processLogic(currentInputState);
#if defined(ESP32) && !defined(UNIT_TEST)
      portEXIT_CRITICAL(&mux);
#else
      interrupts();
#endif
      return evt;
    }

    // =======================================================
    // CHẾ ĐỘ 2: DÙNG TRONG NGẮT TIMER (ĐỘ CHÍNH XÁC CAO)
    // =======================================================
    
    // Hàm này phải được đặt bên trong hàm Ngắt Timer
    void tickISR(bool currentInputState);

    // Hàm này gọi trong loop() để lấy sự kiện sinh ra từ ngắt
    int getEvent() {
#if defined(ESP32) && !defined(UNIT_TEST)
      portENTER_CRITICAL(&mux);
#else
      noInterrupts(); 
#endif
      int evt = pendingEvent;
      pendingEvent = EVENT_NONE; 
#if defined(ESP32) && !defined(UNIT_TEST)
      portEXIT_CRITICAL(&mux);
#else
      interrupts();
#endif
      return evt;
    }

    // Lấy trạng thái hiện tại
    bool getState() {
      return (state == 1);
    }
};

class SchmittTriggerInput : public SlowSchmittTrigger {
  private:
    uint8_t pin;
    bool activeState;       

  public:
    SchmittTriggerInput(uint8_t _pin, bool _activeState, int _maxCnt, int _onThresh, int _offThresh, unsigned long _intervalMs)
      : SlowSchmittTrigger(_maxCnt, _onThresh, _offThresh, _intervalMs) {
      pin = _pin;
      activeState = _activeState;
    }

    void begin() {
      if (activeState == LOW) pinMode(pin, INPUT_PULLUP);
      else pinMode(pin, INPUT);
    }

    int update() {
      return SlowSchmittTrigger::update(digitalRead(pin) == activeState);
    }

    void tickISR();
};

#endif
