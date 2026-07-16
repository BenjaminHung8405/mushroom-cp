#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

namespace config {
  namespace pins {
    // 1. Output - Các chân điều khiển Relay (Actuators)
    constexpr uint8_t PIN_RELAY_MIST = 10; // Điều khiển hệ thống phun sương.
    constexpr uint8_t PIN_RELAY_FAN = 11;  // Điều khiển quạt thông gió.
    constexpr uint8_t PIN_RELAY_HWAT = 12; // Điều khiển hệ thống sưởi nước.
    constexpr uint8_t PIN_RELAY_LAMP = 13; // Điều khiển đèn nhiệt.

    // 3. Input - Giao diện người dùng (Rotary Encoder & Nút nhấn đặc biệt)
    constexpr uint8_t PIN_WIFI_CONFIG_BUTTON = 0; // Nút cài đặt WiFi (BOOT button)
    
    // Rotary Encoder (Mô-đun KY-040)
    constexpr uint8_t PIN_ENCODER_CLK = 5; // Chân xung Clock
    constexpr uint8_t PIN_ENCODER_DT = 6;  // Chân tín hiệu Data
    constexpr uint8_t PIN_ENCODER_SW = 7;  // Nút nhấn (Switch) của núm xoay

    // 4. Các chân tín hiệu I2C
    constexpr uint8_t PIN_I2C_SDA = 8; // Chân dữ liệu (SDA)
    constexpr uint8_t PIN_I2C_SCL = 9; // Chân xung nhịp (SCL)
  }

  namespace timer {
    constexpr uint32_t PERIOD_US = 1000; // Chu kỳ ngắt Timer 1 (1ms = 1000 micro giây)
  }

  namespace timing {
    // 1. Cấu hình Fast Schmitt Trigger (Nút bấm)
    constexpr int BTN_MAX_CNT = 200;
    constexpr int BTN_ON_THRESH = 20;  // Yêu cầu giữ nút ít nhất 20ms để ON
    constexpr int BTN_OFF_THRESH = 270;   // Yêu cầu nhả nút ít nhất 30ms để OFF (MAX_CNT - OFF)

    // 2. Cấu hình Slow Schmitt Trigger (Bộ lọc thiết bị - Thời gian trễ ON/OFF tối thiểu)
    constexpr int FILTER_PUMP_START = 100; // Bơm phun sương
    constexpr int FILTER_LAMP_START = 100; // Đèn nhiệt
    constexpr int FILTER_FAN_START = 100;  // Quạt
    constexpr int FILTER_PUMP_DELAY = 500; // Bơm phun sương: 3s
    constexpr int FILTER_LAMP_DELAY = 200; // Đèn nhiệt: 1s
    constexpr int FILTER_FAN_DELAY = 200;  // Quạt: 2s
  }

  namespace hardware {
    // 2. Input - Các chân nút bấm tủ điện (Cabinet Buttons)
    constexpr uint8_t PIN_BTN_MIST = 4;  // Nút Sương (chống nhiễu kỹ lưỡng)
    constexpr uint8_t PIN_BTN_LAMP = 15; // Nút Đèn (đi kèm với cơ chế debounce 8-sample shift-register)
    constexpr uint8_t PIN_BTN_FAN = 16;  // Nút Quạt (đi kèm với cơ chế debounce 8-sample shift-register)
  }

  namespace debug {
    constexpr bool ENABLE_LOGGING = true;
    constexpr unsigned long SERIAL_BAUD = 115200;
  }
}

#endif // CONFIG_H
