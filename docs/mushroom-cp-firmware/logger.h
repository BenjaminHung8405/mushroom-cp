#ifndef LOGGER_H
#define LOGGER_H

#include <Arduino.h>
#include "config.h"

// Poka-Yoke: Cấu hình định tuyến log qua cổng USB OTG (Native USB)
// Tự động nhận diện thiết lập USB Mode của IDE để chọn đúng cổng
#if defined(ARDUINO_USB_CDC_ON_BOOT) && (ARDUINO_USB_CDC_ON_BOOT == 0)
  #if defined(ARDUINO_USB_MODE) && (ARDUINO_USB_MODE == 0)
    #include <HWCDC.h>
    extern HWCDC USBSerial;
    #define LOG_PORT USBSerial
    #define NEED_HWCDC_INSTANTIATE 1
  #elif defined(ARDUINO_USB_MODE) && (ARDUINO_USB_MODE == 1)
    #include <USB.h>
    #define LOG_PORT USBSerial
    #define NEED_USB_BEGIN 1
  #else
    #define LOG_PORT Serial
  #endif
#else
  #define LOG_PORT Serial // Nếu đã bật CDC On Boot thì Serial mặc định là OTG
#endif

#define LOG_PRINT(x)    do { if(config::debug::ENABLE_LOGGING) { LOG_PORT.print(x); } } while(0)
#define LOG_PRINTLN(x)  do { if(config::debug::ENABLE_LOGGING) { LOG_PORT.println(x); } } while(0)
#define LOG_PRINTF(...) do { if(config::debug::ENABLE_LOGGING) { LOG_PORT.printf(__VA_ARGS__); } } while(0)

#ifdef NEED_USB_BEGIN
  #define LOG_BEGIN(baud) do { if(config::debug::ENABLE_LOGGING) { USB.begin(); LOG_PORT.begin(baud); } } while(0)
#else
  #define LOG_BEGIN(baud) do { if(config::debug::ENABLE_LOGGING) { LOG_PORT.begin(baud); } } while(0)
#endif

#endif // LOGGER_H
