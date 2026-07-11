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

    /**
     * @brief Cấu hình chân nút RESET WIFI (BOOT/GPIO0) làm INPUT_PULLUP.
     * @details Chỉ cấu hình INPUT — tuyệt đối không để OUTPUT để tránh chập mạch khi nhấn nút.
     * Có thể gọi an toàn nhiều lần; pinMode là idempotent.
     */
    void init_wifi_config_button_gpio();

    /**
     * @brief Đặt trạng thái ON/OFF cho một rơ-le theo chân GPIO.
     * @param relay_pin Chân GPIO của rơ-le (phải nằm trong danh sách 4 rơ-le đã khai báo).
     * @param state true = ON (HIGH), false = OFF (LOW).
     * @return true nếu chân hợp lệ và đã ghi trạng thái thành công, false nếu chân ngoài ranh giới an toàn.
     * @details Kiểm tra ranh giới an toàn trước khi gọi digitalWrite. Log rõ ràng ra Serial để trace bug.
     */
    bool set_relay_state(uint8_t relay_pin, bool state);
}
