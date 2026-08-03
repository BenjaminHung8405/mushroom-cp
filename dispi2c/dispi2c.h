#ifndef DISPI2C_H
#define DISPI2C_H

#include <Arduino.h>

// Hàm logic: xử lý chuỗi đầu vào (tối đa 7 ký tự) thành mảng 7 byte đầu ra
// (Tách rời logic khỏi hàm giao tiếp I2C để thuận tiện cho việc Unit Test theo nguyên tắc Poka-Yoke)
void formatDispData(const char* input, uint8_t* output, uint8_t mode);

// Hàm gửi dữ liệu ra màn hình I2C Display (địa chỉ 0x51)
// - Nhận tham số v1, v2. Mỗi tham số được lấy tối đa 2 chữ số cuối (0-99).
// - Nếu giá trị < 10, chữ số hàng chục sẽ được thay bằng khoảng trắng (0xFF).
// - Tự động đệm/padding dựa vào I2C_DISPLAY_MODE trong config.h.
void send2Displ(uint32_t v1, uint32_t v2);

// Hàm chạy Unit Test kiểm tra logic của formatDispData
bool test_formatDispData();

#endif // DISPI2C_H
