#include "timer.h"
#include "config.h"

hw_timer_t * timer1 = NULL;

void IRAM_ATTR onTimer1() {
  // Gọi sang logic ngắt của hệ thống đã được định nghĩa ở file ino
  systemTickISR();
}

void initHardwareTimer() {
  // Poka-Yoke: Tương thích chéo với cả ESP32 Arduino Core 2.x và 3.x
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  timer1 = timerBegin(1000000); // Khởi tạo Timer tần số 1MHz (1 tick = 1us)
  timerAttachInterrupt(timer1, &onTimer1);
  timerAlarm(timer1, config::timer::PERIOD_US, true, 0); // Kích hoạt auto-reload
#else
  timer1 = timerBegin(1, 80, true); // Timer 1, bộ chia 80 (1 tick = 1us), đếm lên
  timerAttachInterrupt(timer1, &onTimer1, true); // Gắn hàm ngắt
  timerAlarmWrite(timer1, config::timer::PERIOD_US, true); // Đặt chu kỳ
  timerAlarmEnable(timer1); // Khởi động Timer
#endif
}
