#pragma once

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
SetpointPod interpolateSetpoints(float currentDay);

} // namespace Trajectory
