#pragma once

#include <stdint.h>

/**
 * @brief Plain Old Data (POD) structure for sensor telemetry.
 * Optimized for 32-bit MCU memory alignment.
 * Size: 16 bytes (aligned on 4-byte boundaries).
 */
struct TelemetryData {
    float temp_air;        ///< Air temperature in °C (from SHT30)
    float temp_substrate;  ///< Substrate temperature in °C (from DS18B20)
    float humidity_air;    ///< Air humidity in % (from SHT30)
    float co2_level;       ///< CO2 level in ppm (from SCD30)
} __attribute__((aligned(4)));

/**
 * @brief Plain Old Data (POD) structure for actuator control commands.
 * Optimized for 32-bit MCU memory alignment to avoid padding issues in FreeRTOS Queue.
 * Size: 4 bytes (aligned on 4-byte boundaries).
 */
struct ActuatorCommand {
    uint8_t relay_id;      ///< GPIO pin or relay identifier
    bool state;            ///< Target state: true (ON/HIGH) or false (OFF/LOW)
    uint8_t padding[2];    ///< Explicit padding to align to 32-bit boundary (4 bytes total)
} __attribute__((aligned(4)));

/**
 * @brief Edge safety controller outputs (boolean relays, no PWM).
 */
struct RelayOutputsPod {
    bool mist_active;
    bool fan_active;
    bool heater_active;
    bool midday_blackout_active;
} __attribute__((aligned(4)));
