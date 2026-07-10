#include "actuators.h"
#include "config.h"
#include <Arduino.h>

namespace actuators
{
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
}
