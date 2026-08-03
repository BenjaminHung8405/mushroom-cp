#include <Arduino.h>
#include "logger.h"
#include "config.h"
#include "timer.h"
#include "manualcontrol.h"
#include <Wire.h>
#include "dispi2c.h"

#ifdef NEED_HWCDC_INSTANTIATE
HWCDC USBSerial;
#endif

// Các biến phục vụ hiển thị màn hình
uint32_t tTest = 0;
unsigned long lastDisplayUpdate = 0;

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

  // Khởi tạo bus I2C và ghi test dữ liệu ra màn hình
  Wire.begin(config::pins::PIN_I2C_SDA, config::pins::PIN_I2C_SCL);
  delay(2000);
  LOG_PRINTLN("\nSend2Display test value...");
  send2Displ(12, 34);

  // Khởi tạo ngắt Timer phần cứng để quét nút bấm định kỳ
  initHardwareTimer();
}

void loop() {
  // Quản lý logic điều khiển bằng tay
  manualControl_loop();

  // Test ghi màn hình hiển thị mỗi 1s (non-blocking)
  unsigned long currentMillis = millis();
  if (currentMillis - lastDisplayUpdate >= 500) {
    lastDisplayUpdate = currentMillis;
    tTest+=1;

    uint32_t v1 = (tTest / 100) % 100;
    uint32_t v2 = tTest % 100;

    send2Displ(v1, v2);
    LOG_PRINTF("Display Updated: v1=%lu, v2=%lu\n", (unsigned long)v1, (unsigned long)v2);
  }
}
