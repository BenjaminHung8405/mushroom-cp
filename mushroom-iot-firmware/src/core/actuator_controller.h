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
     * @brief Khởi tạo các chân GPIO cho 3 nút bấm tủ điện (MIST, LAMP, FAN) dưới dạng INPUT_PULLUP.
     */
    void init_cabinet_buttons_gpio();

    /**
     * @brief Đặt trạng thái ON/OFF cho một rơ-le theo chân GPIO.
     * @param relay_pin Chân GPIO của rơ-le (phải nằm trong danh sách 4 rơ-le đã khai báo).
     * @param state true = ON (HIGH), false = OFF (LOW).
     * @return true nếu chân hợp lệ và đã ghi trạng thái thành công, false nếu chân ngoài ranh giới an toàn.
     * @details Kiểm tra ranh giới an toàn trước khi gọi digitalWrite. Log rõ ràng ra Serial để trace bug.
     */
    bool set_relay_state(uint8_t relay_pin, bool state);
}

#include <stdint.h>

#include "core/fuzzy_controller.h"
#include "core/models.h"

namespace relay_control {

struct RtcTimePod {
    bool valid;
    uint8_t hour;
    uint8_t minute;
} __attribute__((aligned(4)));

/** Final ON/OFF state of the active-LOW physical relays. */
struct RelayStatePod {
    bool lamp_active;
    bool hwat_active;
    bool mist_active;
    bool fan_active;
} __attribute__((aligned(4)));

/** True when the edge must enforce the non-bypassable Mist safety interlock. */
bool isSafetyBlackoutActive(const RtcTimePod &rtcTime);

/** Forces Mist OFF when the safety interlock is active. */
void hardwareProtectionOverride(
    FuzzyController::ArbitratedOutputsPod &outputs,
    const RtcTimePod &rtcTime);

/**
 * Resolves a normalized demand to a binary state using hysteresis.
 *
 * Invalid demand/threshold input, or an invalid hysteresis band, fails safe
 * to OFF. This helper has no GPIO or other side effects.
 */
bool resolveBinaryDemand(
    float demand,
    bool currentState,
    float onThreshold,
    float offThreshold);

/**
 * Converts fuzzy/manual demands to stable binary relay states.
 *
 * No PWM, pulse, or time-proportional control is used. A small hysteresis
 * band prevents a fuzzy demand near 0.5 from repeatedly switching a relay.
 * GPIO is written only when the resolved ON/OFF state changes.
 */
void applyDirectOutputs(
    const FuzzyController::ArbitratedOutputsPod &outputs,
    const DynamicTuningParams &activeTuning,
    RelayStatePod &state);

/**
 * Writes the binary relay states to physical GPIO pins.
 */
void writeRelays(const RelayStatePod &state);

} // namespace relay_control
