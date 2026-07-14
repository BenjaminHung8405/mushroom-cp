#pragma once

#include <stdint.h>

/**
 * @brief Plain Old Data (POD) structure for sensor telemetry.
 * Optimized for 32-bit MCU memory alignment.
 *
 * Active sensors:
 *   - SHT30  → temp_air, humidity_air  (real I2C reads)
 *
 * Not integrated / removed:
 *   - DS18B20 (substrate temp) — not used; SHT30 covers thermal needs.
 *   - SCD30   (CO2)            — hardware not present; co2_level stays NAN.
 */
/**
 * @brief Edge-authoritative physical SSR output snapshot.
 *
 * Values are copied from the TPC scheduler's final output states, never
 * inferred from sensor readings or read back from GPIO.
 */
struct RelayOutputsPod {
    bool mist_active;
    bool fan_active;
    bool lamp_stage_active;       ///< Bóng đèn nhiệt tầng 1 (LAMP_1) đang bật
    bool lamp_stage2_active;      ///< Bóng đèn nhiệt tầng 2 (LAMP_2) đang bật
    bool heater_water_active;
    bool midday_blackout_active;
    uint8_t padding[2];
} __attribute__((aligned(4)));

struct TelemetryData {
    float temp_air;        ///< Air temperature in °C (from SHT30)
    float humidity_air;    ///< Air humidity in % (from SHT30)
    float co2_level;       ///< CO2 level in ppm — NAN until SCD30 is integrated
    RelayOutputsPod actuators; ///< Final edge SSR states for this control sample
} __attribute__((aligned(4)));

/**
 * @brief Plain Old Data (POD) structure for setpoint control commands.
 * Transmitted from Core 0/NVS/Encoder to Core 1 control loop via FreeRTOS queue.
 */
struct ControlSetpointCommand {
    float temp_target;
    float humidity_target;
    float co2_target;
    bool active;
    uint8_t padding[3];    ///< Explicit padding to align to 32-bit boundary (16 bytes total)
} __attribute__((aligned(4)));

/**
 * @brief Plain Old Data (POD) structure for actuator manual override commands.
 * Transmitted from Core 0 to Core 1 control loop via FreeRTOS queue.
 */
struct ActuatorOverrideCommand {
    int8_t mist_override;       // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    int8_t fan_override;        // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    int8_t heater_air_override; // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    bool active;
} __attribute__((aligned(4)));

