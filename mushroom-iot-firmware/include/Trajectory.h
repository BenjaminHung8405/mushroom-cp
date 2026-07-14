#pragma once

#include <stdint.h>
#include "models.h"

/**
 * @file Trajectory.h
 * @brief Interpolation of target setpoints along a 20-day growth curve.
 * 
 * Part of fuzzy-logic-core-1 (Sprint 1 - Core Business Logic).
 * Designed for ESP32 FPU, stateless, hardware-independent.
 */

namespace Trajectory {

/**
 * @brief Plain Old Data (POD) structure for target setpoints.
 */
struct SetpointPod {
    float temp_target;      ///< Target temperature in °C
    float humidity_target;  ///< Target humidity in %
    float co2_target;       ///< Target CO2 level in ppm
} __attribute__((aligned(4)));

/**
 * @brief Linearly interpolates target setpoints from a 20-day waypoint curve.
 * 
 * @param currentDay The current day age of the crop [0.0, 20.0]
 * @return SetpointPod The interpolated target setpoints.
 */
/**
 * @brief Linearly interpolates target setpoints from a custom crop profile.
 * 
 * @param cropDay The current integer day of the crop
 * @param profile The active crop profile
 * @param temp_target Output parameter for temperature target
 * @param humidity_target Output parameter for humidity target
 * @return true if interpolation succeeded and results are valid, false otherwise.
 */
bool interpolateSetpoint(
    uint16_t cropDay,
    const PersistedCropProfile &profile,
    float &temp_target,
    float &humidity_target);

SetpointPod interpolateSetpoints(float currentDay);

} // namespace Trajectory

