#include "actuators.h"
#include "config.h"
#include <Arduino.h>

namespace actuators
{
    // Danh sách whitelist các chân rơ-le hợp lệ — ranh giới an toàn cứng
    static constexpr uint8_t VALID_RELAY_PINS[] = {
        config::pins::PIN_RELAY_MIST,
        config::pins::PIN_RELAY_FAN,
        config::pins::PIN_RELAY_HEATER_1,
        config::pins::PIN_RELAY_HEATER_2
    };
    static constexpr size_t VALID_RELAY_COUNT =
        sizeof(VALID_RELAY_PINS) / sizeof(VALID_RELAY_PINS[0]);

    /**
     * @brief Trả về tên thân thiện của rơ-le theo chân GPIO (dùng cho log).
     */
    static const char *relay_name(uint8_t pin)
    {
        switch (pin)
        {
        case config::pins::PIN_RELAY_MIST:     return "MIST";
        case config::pins::PIN_RELAY_FAN:      return "FAN";
        case config::pins::PIN_RELAY_HEATER_1: return "HEATER_1";
        case config::pins::PIN_RELAY_HEATER_2: return "HEATER_2";
        default:                               return "UNKNOWN";
        }
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
        Serial.println("[ACTUATORS] Initializing GPIO pins for 4 Relays with Fail-Safe protection...");

        // Pin 1: Mist Relay
        pinMode(config::pins::PIN_RELAY_MIST, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_MIST, LOW);
        Serial.printf("[ACTUATORS] Relay MIST (Pin %d) initialized to LOW.\n", (int)config::pins::PIN_RELAY_MIST);

        // Pin 2: Fan Relay
        pinMode(config::pins::PIN_RELAY_FAN, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_FAN, LOW);
        Serial.printf("[ACTUATORS] Relay FAN (Pin %d) initialized to LOW.\n", (int)config::pins::PIN_RELAY_FAN);

        // Pin 3: Heater 1 Relay
        pinMode(config::pins::PIN_RELAY_HEATER_1, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_HEATER_1, LOW);
        Serial.printf("[ACTUATORS] Relay HEATER 1 (Pin %d) initialized to LOW.\n", (int)config::pins::PIN_RELAY_HEATER_1);

        // Pin 4: Heater 2 Relay
        pinMode(config::pins::PIN_RELAY_HEATER_2, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_HEATER_2, LOW);
        Serial.printf("[ACTUATORS] Relay HEATER 2 (Pin %d) initialized to LOW.\n", (int)config::pins::PIN_RELAY_HEATER_2);

        Serial.println("[ACTUATORS] All relays initialized successfully in safe OFF state.");
    }

    bool set_relay_state(uint8_t relay_pin, bool state)
    {
        // Ranh giới an toàn: từ chối mọi chân GPIO không thuộc whitelist rơ-le
        if (!is_valid_relay_pin(relay_pin))
        {
            Serial.printf(
                "[ACTUATOR] REJECTED: Pin %d is not a valid relay pin. Allowed: [%d, %d, %d, %d].\n",
                (int)relay_pin,
                (int)config::pins::PIN_RELAY_MIST,
                (int)config::pins::PIN_RELAY_FAN,
                (int)config::pins::PIN_RELAY_HEATER_1,
                (int)config::pins::PIN_RELAY_HEATER_2
            );
            return false;
        }

        const uint8_t level = state ? HIGH : LOW;
        digitalWrite(relay_pin, level);

        Serial.printf(
            "[ACTUATOR] Pin %d (%s) set to %s.\n",
            (int)relay_pin,
            relay_name(relay_pin),
            state ? "HIGH" : "LOW"
        );

        return true;
    }
}
