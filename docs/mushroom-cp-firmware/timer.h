#ifndef TIMER_H
#define TIMER_H

#include <Arduino.h>

// Hàm khởi tạo Timer phần cứng (Timer 1)
void initHardwareTimer();

// Hàm callback ngắt do chương trình chính (main) định nghĩa. 
// [Poka-Yoke]: Phải định nghĩa với IRAM_ATTR ở file .ino để đảm bảo hàm chạy trên RAM nội, tránh crash khi gọi trong ngắt.
extern void systemTickISR();

#endif // TIMER_H
