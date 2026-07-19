#include "core/actuator_controller.h"
#include "config.h"
#include "core/time_confidence.h"
#include "core/offline_storage.h"
#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

namespace actuators
{
    // Danh sách whitelist các chân rơ-le hợp lệ — ranh giới an toàn cứng
    static constexpr uint8_t VALID_RELAY_PINS[] = {
        config::pins::PIN_RELAY_MIST,
        config::pins::PIN_RELAY_FAN,
        config::pins::PIN_RELAY_HWAT,
        config::pins::PIN_RELAY_LAMP
    };
    static constexpr size_t VALID_RELAY_COUNT =
        sizeof(VALID_RELAY_PINS) / sizeof(VALID_RELAY_PINS[0]);

    /**
     * @brief Trả về tên thân thiện của rơ-le theo chân GPIO (dùng cho log).
     */
    static const char *relay_name(uint8_t pin)
    {
        if (pin == config::pins::PIN_RELAY_MIST)     return "MIST";
        if (pin == config::pins::PIN_RELAY_FAN)      return "FAN";
        if (pin == config::pins::PIN_RELAY_HWAT)     return "HWAT";
        if (pin == config::pins::PIN_RELAY_LAMP)     return "LAMP";
        return "UNKNOWN";
    }

    /**
     * @brief Kiểm tra chân GPIO có nằm trong whitelist rơ-le hay không.
     */
    static bool is_valid_relay_pin(uint8_t pin)
    {
        for (size_t i = 0; i < VALID_RELAY_COUNT; ++i)
        {
            if (VALID_RELAY_PINS[i] == pin)
            {
                return true;
            }
        }
        return false;
    }

    void init_actuators_gpio()
    {
        Serial.println("[ACTUATORS] Initializing GPIO pins for 5 Relays with Fail-Safe protection...");

        // Pin 1: Mist Relay
        digitalWrite(config::pins::PIN_RELAY_MIST, HIGH);
        pinMode(config::pins::PIN_RELAY_MIST, OUTPUT);
        Serial.printf("[ACTUATORS] Relay MIST (Pin %d) initialized to HIGH (OFF).\n", (int)config::pins::PIN_RELAY_MIST);

        // Pin 2: Fan Relay
        digitalWrite(config::pins::PIN_RELAY_FAN, HIGH);
        pinMode(config::pins::PIN_RELAY_FAN, OUTPUT);
        Serial.printf("[ACTUATORS] Relay FAN (Pin %d) initialized to HIGH (OFF).\n", (int)config::pins::PIN_RELAY_FAN);

        // Pin 3: Lamp relay
        digitalWrite(config::pins::PIN_RELAY_LAMP, HIGH);
        pinMode(config::pins::PIN_RELAY_LAMP, OUTPUT);
        Serial.printf("[ACTUATORS] Relay LAMP (Pin %d) initialized to HIGH (OFF).\n",
                      (int)config::pins::PIN_RELAY_LAMP);

        // Pin 4: Heater Water Relay
        digitalWrite(config::pins::PIN_RELAY_HWAT, HIGH);
        pinMode(config::pins::PIN_RELAY_HWAT, OUTPUT);
        Serial.printf("[ACTUATORS] Relay HWAT (Pin %d) initialized to HIGH (OFF).\n", (int)config::pins::PIN_RELAY_HWAT);

        Serial.println("[ACTUATORS] All relays initialized successfully in safe OFF state (4 relays, LAMP merged).");

        // BOOT / RESET WIFI button (active LOW). Keep INPUT only — never OUTPUT.
        init_wifi_config_button_gpio();

        // Cabinet buttons (active LOW). Keep INPUT only.
        init_cabinet_buttons_gpio();

        // Dedicated active-LOW power-fail signal. The ISR only wakes the
        // pre-created flush task; it never executes flash/filesystem code.
        pinMode(config::pins::PIN_POWER_LOSS, INPUT_PULLUP);
        attachInterrupt(digitalPinToInterrupt(config::pins::PIN_POWER_LOSS), []() IRAM_ATTR {
            offline_storage::OfflineStorage::getInstance().notifyPowerLossFromISR();
        }, FALLING);
    }

    void init_wifi_config_button_gpio()
    {
        pinMode(config::pins::PIN_WIFI_CONFIG_BUTTON, INPUT_PULLUP);
        Serial.printf(
            "[ACTUATORS] WiFi config button (GPIO%d) configured as INPUT_PULLUP (active LOW).\n",
            static_cast<int>(config::pins::PIN_WIFI_CONFIG_BUTTON)
        );
    }

    void init_cabinet_buttons_gpio()
    {
        pinMode(config::hardware::PIN_BTN_MIST, INPUT_PULLUP);
        pinMode(config::hardware::PIN_BTN_LAMP, INPUT_PULLUP);
        pinMode(config::hardware::PIN_BTN_FAN, INPUT_PULLUP);
        Serial.printf(
            "[ACTUATORS] Cabinet buttons initialized: MIST (GPIO%d), LAMP (GPIO%d), FAN (GPIO%d) as INPUT_PULLUP.\n",
            static_cast<int>(config::hardware::PIN_BTN_MIST),
            static_cast<int>(config::hardware::PIN_BTN_LAMP),
            static_cast<int>(config::hardware::PIN_BTN_FAN)
        );
    }

    bool set_relay_state(uint8_t relay_pin, bool state)
    {
        // Ranh giới an toàn: từ chối mọi chân GPIO không thuộc whitelist rơ-le
        if (!is_valid_relay_pin(relay_pin))
        {
            Serial.printf(
                "[ACTUATOR] REJECTED: Pin %d is not a valid relay pin. Allowed: [MIST=%d, FAN=%d, HWAT=%d, LAMP=%d].\n",
                (int)relay_pin,
                (int)config::pins::PIN_RELAY_MIST,
                (int)config::pins::PIN_RELAY_FAN,
                (int)config::pins::PIN_RELAY_HWAT,
                (int)config::pins::PIN_RELAY_LAMP
            );
            return false;
        }

        const uint8_t level = state ? LOW : HIGH;
        digitalWrite(relay_pin, level);

        Serial.printf(
            "[ACTUATOR] Pin %d (%s) set to %s.\n",
            (int)relay_pin,
            relay_name(relay_pin),
            level == HIGH ? "HIGH" : "LOW"
        );

        return true;
    }
}

#include "core/actuator_controller.h"

#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

#include "config.h"
#include "core/time_confidence.h"
#include "core/offline_storage.h"

namespace relay_control {
namespace {

constexpr uint16_t MIDDAY_BLACKOUT_START_MINUTE = 11U * 60U;
constexpr uint16_t MIDDAY_BLACKOUT_END_MINUTE = 13U * 60U + 30U;
// Temperature demand reaches 1.0 at a 4°C deficit. This 0.25/0.15
// hysteresis starts heating at about 1.0°C below target and stops near 0.6°C.
constexpr float FUZZY_ON_THRESHOLD = 0.25f;
constexpr float FUZZY_OFF_THRESHOLD = 0.15f;

bool isValidRtcTime(const RtcTimePod& rtcTime) {
    return rtcTime.valid && rtcTime.hour < 24U && rtcTime.minute < 60U;
}

bool isMiddayBlackout(const RtcTimePod& rtcTime) {
    const uint16_t minuteOfDay =
        static_cast<uint16_t>(rtcTime.hour) * 60U + rtcTime.minute;
    return minuteOfDay >= MIDDAY_BLACKOUT_START_MINUTE &&
           minuteOfDay <= MIDDAY_BLACKOUT_END_MINUTE;
}

bool resolveBinaryDemand(float demand, bool currentlyActive) {
    if (!std::isfinite(demand) || demand <= 0.0f) {
        return false;
    }
    return currentlyActive ? demand > FUZZY_OFF_THRESHOLD
                           : demand >= FUZZY_ON_THRESHOLD;
}

void writeRelayIfChanged(uint8_t pin, bool& state, bool active) {
    if (state != active) {
        // Relay drivers are active LOW.
        digitalWrite(pin, active ? LOW : HIGH);
        state = active;
    }
}

} // namespace

bool isSafetyBlackoutActive(const RtcTimePod& rtcTime) {
    return !time_conf::isTimeUsable() || !isValidRtcTime(rtcTime) || isMiddayBlackout(rtcTime);
}

void hardwareProtectionOverride(
    FuzzyController::ArbitratedOutputsPod& outputs,
    const RtcTimePod& rtcTime) {
    if (isSafetyBlackoutActive(rtcTime)) {
        outputs.Mist = 0.0f;
    }
}

void applyDirectOutputs(
    const FuzzyController::ArbitratedOutputsPod& outputs,
    RelayStatePod& state) {
    state.lamp_active = resolveBinaryDemand(outputs.HLamp, state.lamp_active);
    // Water heater is not installed. Heat demand is routed to HLamp instead,
    // and relay_3 remains de-energized regardless of an old/manual command.
    state.hwat_active = false;
    state.mist_active = resolveBinaryDemand(outputs.Mist, state.mist_active);
    state.fan_active = resolveBinaryDemand(outputs.Exh, state.fan_active);
}

void writeRelays(const RelayStatePod& state) {
    digitalWrite(config::pins::PIN_RELAY_LAMP, state.lamp_active ? LOW : HIGH);
    digitalWrite(config::pins::PIN_RELAY_HWAT, HIGH);
    digitalWrite(config::pins::PIN_RELAY_MIST, state.mist_active ? LOW : HIGH);
    digitalWrite(config::pins::PIN_RELAY_FAN, state.fan_active ? LOW : HIGH);
}

} // namespace relay_control
