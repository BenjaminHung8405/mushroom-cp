#pragma once

#include <stdint.h>

namespace config {
namespace pins {

// Actuators (Relays)
constexpr uint8_t PIN_RELAY_MIST = 10;     // Sương (Fogger/Mist)
constexpr uint8_t PIN_RELAY_FAN = 11;      // Quạt (Fan)
constexpr uint8_t PIN_RELAY_HEATER_1 = 12; // Sưởi 1 (Heater 1)
constexpr uint8_t PIN_RELAY_HEATER_2 = 13; // Sưởi 2 (Heater 2)

// I2C Bus (e.g. SHT30, SCD30)
constexpr uint8_t PIN_I2C_SDA = 8;
constexpr uint8_t PIN_I2C_SCL = 9;

// OneWire Bus (e.g. DS18B20)
constexpr uint8_t PIN_ONE_WIRE = 14;

} // namespace pins
} // namespace config
