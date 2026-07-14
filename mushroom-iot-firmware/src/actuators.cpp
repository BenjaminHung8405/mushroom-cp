#include "actuators.h"
#include "config.h"
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
        pinMode(config::pins::PIN_RELAY_MIST, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_MIST, HIGH);
        Serial.printf("[ACTUATORS] Relay MIST (Pin %d) initialized to HIGH.\n", (int)config::pins::PIN_RELAY_MIST);

        // Pin 2: Fan Relay
        pinMode(config::pins::PIN_RELAY_FAN, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_FAN, HIGH);
        Serial.printf("[ACTUATORS] Relay FAN (Pin %d) initialized to HIGH.\n", (int)config::pins::PIN_RELAY_FAN);

        // Pin 3: Lamp relay
        pinMode(config::pins::PIN_RELAY_LAMP, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_LAMP, HIGH);
        Serial.printf("[ACTUATORS] Relay LAMP (Pin %d) initialized to HIGH.\n",
                      (int)config::pins::PIN_RELAY_LAMP);

        // Pin 4: Heater Water Relay
        pinMode(config::pins::PIN_RELAY_HWAT, OUTPUT);
        digitalWrite(config::pins::PIN_RELAY_HWAT, HIGH);
        Serial.printf("[ACTUATORS] Relay HWAT (Pin %d) initialized to HIGH.\n", (int)config::pins::PIN_RELAY_HWAT);

        Serial.println("[ACTUATORS] All relays initialized successfully in safe OFF state (4 relays, LAMP merged).");

        // BOOT / RESET WIFI button (active LOW). Keep INPUT only — never OUTPUT.
        init_wifi_config_button_gpio();

        // Cabinet buttons (active LOW). Keep INPUT only.
        init_cabinet_buttons_gpio();
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
