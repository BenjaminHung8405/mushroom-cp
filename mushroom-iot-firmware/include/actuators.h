#pragma once

#include <stdint.h>

namespace actuators
{
    /**
     * @brief Khởi tạo các chân GPIO cho 4 Rơ-le (cấu hình chân làm OUTPUT và đặt trạng thái ban đầu là LOW).
     * @details Fail-Safe Phần cứng: Gọi digitalWrite(pin, LOW) ngay sau khi cấu hình pinMode(pin, OUTPUT)
     * để tránh rơ-le tự kích nổ hoặc nháy trạng thái khi khởi động (Glitch).
     */
    void init_actuators_gpio();
}
