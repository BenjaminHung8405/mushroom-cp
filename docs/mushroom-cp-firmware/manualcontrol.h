#ifndef MANUALCONTROL_H
#define MANUALCONTROL_H

#include <Arduino.h>

// Khởi tạo các chân GPIO cho Relay và Nút bấm
void manualControl_init();

// Hàm xử lý định kỳ gọi từ ngắt Timer
void manualControl_tickISR();

// Hàm xử lý vòng lặp chính
void manualControl_loop();

#endif // MANUALCONTROL_H
