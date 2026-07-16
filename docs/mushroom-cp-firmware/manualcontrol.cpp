#include "manualcontrol.h"
#include "sst.h"
#include "logger.h"
#include "config.h"

// 1. Tầng phần cứng: Chống nhiễu nút bấm cơ khí (Fast Schmitt Trigger)
SchmittTriggerInput btnMist(config::hardware::PIN_BTN_MIST, LOW, config::timing::BTN_MAX_CNT, config::timing::BTN_ON_THRESH, config::timing::BTN_OFF_THRESH, 1);
SchmittTriggerInput btnLamp(config::hardware::PIN_BTN_LAMP, LOW, config::timing::BTN_MAX_CNT, config::timing::BTN_ON_THRESH, config::timing::BTN_OFF_THRESH, 1);
SchmittTriggerInput btnFan(config::hardware::PIN_BTN_FAN, LOW, config::timing::BTN_MAX_CNT, config::timing::BTN_ON_THRESH, config::timing::BTN_OFF_THRESH, 1);

// 2. Tầng phần mềm: Bộ lọc trạng thái thiết bị (Slow Schmitt Trigger)
SlowSchmittTrigger filterMist(config::timing::FILTER_PUMP_DELAY, config::timing::FILTER_PUMP_START, 0, 1);
SlowSchmittTrigger filterLamp(config::timing::FILTER_LAMP_DELAY, config::timing::FILTER_LAMP_START, 0, 1);
SlowSchmittTrigger filterFan(config::timing::FILTER_FAN_DELAY, config::timing::FILTER_FAN_START, 0, 1);

void manualControl_init() {
  // 1. Khởi tạo Output (Relay) - Mức cao là OFF, mức thấp là ON (Active LOW)
  // [Poka-Yoke]: Trên nền tảng ESP32, việc gọi digitalWrite trước pinMode có thể không có tác dụng do thanh ghi GPIO bị reset.
  // Bắt buộc phải gọi digitalWrite(HIGH) ngay lập tức sau pinMode để đảm bảo SSR (Solid State Relay) không bị đóng điện ngoài ý muốn.
  pinMode(config::pins::PIN_RELAY_MIST, OUTPUT);
  digitalWrite(config::pins::PIN_RELAY_MIST, HIGH);
  
  pinMode(config::pins::PIN_RELAY_FAN, OUTPUT);
  digitalWrite(config::pins::PIN_RELAY_FAN, HIGH);
  
  pinMode(config::pins::PIN_RELAY_LAMP, OUTPUT);
  digitalWrite(config::pins::PIN_RELAY_LAMP, HIGH);
  
  pinMode(config::pins::PIN_RELAY_HWAT, OUTPUT);
  digitalWrite(config::pins::PIN_RELAY_HWAT, HIGH);

  // 2. Khởi tạo Input (Nút bấm - Schmitt Trigger)
  // Hàm begin() sẽ tự động gọi pinMode(pin, INPUT_PULLUP) do ta cấu hình activeState là LOW
  btnMist.begin();
  btnLamp.begin();
  btnFan.begin();
}

void IRAM_ATTR manualControl_tickISR() {
  // Cập nhật trạng thái nút bấm (Hardware layer)
  btnMist.tickISR();
  btnLamp.tickISR();
  btnFan.tickISR();

  // Nạp kết quả của tầng Fast vào tầng Slow
//  filterMist.tickISR(btnMist.getState());
//  filterLamp.tickISR(btnLamp.getState());
//  filterFan.tickISR(btnFan.getState());
}

void manualControl_loop() {
  // 1. Điều khiển Toggle trực tiếp từ sự kiện nút bấm thô (Fast Trigger)
  int rawMist = btnMist.getEvent();
  if (rawMist == EVENT_ON) {
    bool currentState = digitalRead(config::pins::PIN_RELAY_MIST);
    digitalWrite(config::pins::PIN_RELAY_MIST, !currentState);
    LOG_PRINTF("[BTN] MIST: PRESSED -> TOGGLE (New State: %s)\n", !currentState ? "OFF" : "ON");
  } else if (rawMist == EVENT_OFF) {
    LOG_PRINTLN("[BTN] MIST: RELEASED");
  }

  int rawLamp = btnLamp.getEvent();
  if (rawLamp == EVENT_ON) {
    bool currentState = digitalRead(config::pins::PIN_RELAY_LAMP);
    digitalWrite(config::pins::PIN_RELAY_LAMP, !currentState);
    LOG_PRINTF("[BTN] LAMP: PRESSED -> TOGGLE (New State: %s)\n", !currentState ? "OFF" : "ON");
  } else if (rawLamp == EVENT_OFF) {
    LOG_PRINTLN("[BTN] LAMP: RELEASED");
  }

  int rawFan = btnFan.getEvent();
  if (rawFan == EVENT_ON) {
    bool currentState = digitalRead(config::pins::PIN_RELAY_FAN);
    digitalWrite(config::pins::PIN_RELAY_FAN, !currentState);
    LOG_PRINTF("[BTN] FAN: PRESSED -> TOGGLE (New State: %s)\n", !currentState ? "OFF" : "ON");
  } else if (rawFan == EVENT_OFF) {
    LOG_PRINTLN("[BTN] FAN: RELEASED");
  }

  // 2. Lấy sự kiện từ bộ lọc chậm (Slow Schmitt Trigger) 
  // [Đã tạm vô hiệu hóa theo yêu cầu]
  /*
  int evtMist = filterMist.getEvent();
  if (evtMist == EVENT_ON) LOG_PRINTLN("[RELAY] MIST: ON");
  else if (evtMist == EVENT_OFF) LOG_PRINTLN("[RELAY] MIST: OFF");

  int evtLamp = filterLamp.getEvent();
  if (evtLamp == EVENT_ON) LOG_PRINTLN("[RELAY] LAMP: ON");
  else if (evtLamp == EVENT_OFF) LOG_PRINTLN("[RELAY] LAMP: OFF");

  int evtFan = filterFan.getEvent();
  if (evtFan == EVENT_ON) LOG_PRINTLN("[RELAY] FAN: ON");
  else if (evtFan == EVENT_OFF) LOG_PRINTLN("[RELAY] FAN: OFF");
  */
}
