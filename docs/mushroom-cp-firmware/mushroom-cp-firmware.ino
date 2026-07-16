#include <Arduino.h>
#include "logger.h"
#include "config.h"
#include "timer.h"
#include "manualcontrol.h"

#ifdef NEED_HWCDC_INSTANTIATE
HWCDC USBSerial;
#endif

void IRAM_ATTR systemTickISR() {
  // Hàm xử lý ngắt Timer (chạy mỗi config::timer::PERIOD_US)
  // [CẢNH BÁO Poka-Yoke]: Chỉ giữ code thực thi nhanh, không dùng Serial.print hay delay trong ngắt!
  manualControl_tickISR();
}

void setup() {
  LOG_BEGIN(config::debug::SERIAL_BAUD);
  LOG_PRINTLN("\n--- MUSHROOM CP FIRMWARE STARTED ---");

  // Khởi tạo các chân GPIO cho Relay và Nút bấm điều khiển
  manualControl_init();

  // Khởi tạo ngắt Timer phần cứng để quét nút bấm định kỳ
  initHardwareTimer();
}

void loop() {
  // Quản lý logic điều khiển bằng tay
  manualControl_loop();
}
