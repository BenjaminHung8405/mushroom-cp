#include "dispi2c.h"
#include "config.h"
#include <Wire.h>

void formatDispData(const char* input, uint8_t* output, uint8_t mode) {
    char s1[7];

    // 1. Padding left hoặc cắt chuỗi thành đúng 7 ký tự
    size_t len = input ? strlen(input) : 0;
    if (len > 7) {
        len = 7; // Nếu dài hơn 7, cắt bỏ phần dư, chỉ lấy 7 ký tự đầu
    }
    
    if (mode == 0) {
        // Mode 0: Padding trái
        int pad = 7 - len;
        for (int i = 0; i < pad; ++i) {
            s1[i] = ' ';
        }
        for (int i = 0; i < len; ++i) {
            s1[pad + i] = input[i];
        }
    } else {
        // Mode 1: Đảo ngược chuỗi và padding phải
        for (int i = 0; i < len; ++i) {
            s1[i] = input[len - 1 - i]; // Đảo ngược
        }
        for (int i = len; i < 7; ++i) {
            s1[i] = ' '; // Padding phải
        }
    }

    // 2 & 3. Chuẩn hóa chuỗi s1 (thay ký tự không phải số thành khoảng trắng)
    // và chuyển thành chuỗi byte s2 (trong output)
    for (int i = 0; i < 7; ++i) {
        char c = s1[i];
        if (c >= '0' && c <= '9') {
            output[i] = c - '0'; // Chuyển ký số '0'-'9' thành byte 0x00-0x09
        } else {
            output[i] = 0xFF;    // Ký tự khác (bao gồm khoảng trắng) chuyển thành 0xFF
        }
    }
}

void send2Displ(uint32_t v1, uint32_t v2) {
    char input[5]; // 4 chữ số + null terminator
    uint8_t val1 = v1 % 100;
    uint8_t val2 = v2 % 100;
    
    // Format v1: nếu < 10 thì chèn khoảng trắng (0xFF sau này) ở hàng chục
    if (val1 < 10) {
        input[0] = ' ';
        input[1] = '0' + val1;
    } else {
        input[0] = '0' + (val1 / 10);
        input[1] = '0' + (val1 % 10);
    }
    
    // Format v2: nếu < 10 thì chèn khoảng trắng ở hàng chục
    if (val2 < 10) {
        input[2] = ' ';
        input[3] = '0' + val2;
    } else {
        input[2] = '0' + (val2 / 10);
        input[3] = '0' + (val2 % 10);
    }
    input[4] = '\0';
    
    uint8_t s2[7];
    // Gọi hàm logic để xử lý chuỗi padding / đảo ngược dựa trên cấu hình
    formatDispData(input, s2, config::hardware::I2C_DISPLAY_MODE);

    // 4. Ghi 7 byte ra thiết bị I2C display
    Wire.beginTransmission(config::hardware::I2C_DISPLAY_ADDR);
    Wire.write(s2, 7);
    Wire.endTransmission();
}

// Unit Test để xác minh tính đúng đắn của logic xử lý chuỗi (Nguyên tắc: Tạo test case khi có thể)
bool test_formatDispData() {
    uint8_t output[7];
    bool passed = true;

    // --- TEST MODE 0 (Padding trái) ---
    // Test case 1: Chuỗi "1234" (4 byte) -> Padding left 3 space -> kết quả 7 byte
    formatDispData("1234", output, 0);
    uint8_t expected_1[7] = {0xFF, 0xFF, 0xFF, 0x01, 0x02, 0x03, 0x04};
    for (int i = 0; i < 7; i++) if (output[i] != expected_1[i]) passed = false;

    // Test case 2: Chuỗi " 2 7" (4 byte, có space) -> Padding left 3 space
    formatDispData(" 2 7", output, 0);
    uint8_t expected_2[7] = {0xFF, 0xFF, 0xFF, 0xFF, 0x02, 0xFF, 0x07};
    for (int i = 0; i < 7; i++) if (output[i] != expected_2[i]) passed = false;

    // Test case 3: Chuỗi dài hơn 7 ký tự -> Bị cắt bớt
    formatDispData("12345678", output, 0);
    uint8_t expected_3[7] = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07};
    for (int i = 0; i < 7; i++) if (output[i] != expected_3[i]) passed = false;

    // --- TEST MODE 1 (Đảo ngược & padding phải) ---
    // Test case 4: Chuỗi "1234" -> Đảo ngược "4321" -> Padding phải "4321   "
    formatDispData("1234", output, 1);
    uint8_t expected_4[7] = {0x04, 0x03, 0x02, 0x01, 0xFF, 0xFF, 0xFF};
    for (int i = 0; i < 7; i++) if (output[i] != expected_4[i]) passed = false;

    // Test case 5: Ký tự không hợp lệ "aB3" -> Đảo ngược "3Ba" -> "3Ba    "
    formatDispData("aB3", output, 1);
    uint8_t expected_5[7] = {0x03, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    for (int i = 0; i < 7; i++) if (output[i] != expected_5[i]) passed = false;

    // Test case 6: Con trỏ null
    formatDispData(nullptr, output, 1);
    uint8_t expected_6[7] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    for (int i = 0; i < 7; i++) if (output[i] != expected_6[i]) passed = false;

    return passed;
}
