#pragma once

/**
 * @file MathEngine.h
 * @brief Pure mathematical logic for fuzzy control and area calculations.
 * 
 * Part of fuzzy-logic-core-1 (Sprint 1 - Core Business Logic).
 * Designed for ESP32 FPU, stateless, hardware-independent.
 */

namespace MathEngine {

/**
 * @brief Calculates the fuzzy area and centroid-based watering time (TB)
 * using the original Pascal equations for integral functions Fz1..Fz3 and Fu1..Fu3.
 * 
 * @param w1 Membership value of "Thấp" (Low) [0.0, 1.0]
 * @param w2 Membership value of "Vừa" (Medium) [0.0, 1.0]
 * @param w3 Membership value of "Gần bằng" (Close/Almost) [0.0, 1.0]
 * @param Kz Output parameter to receive the computed Kz value (moment)
 * @param K Output parameter to receive the computed K value (area)
 * @return float Computed watering time (TB) in seconds. Fallback to 0.0f if invalid or K == 0.
 */
float calculateFuzzyArea(float w1, float w2, float w3, float& Kz, float& K);

/**
 * @brief Overloaded version of calculateFuzzyArea that only returns the watering time (TB).
 * Useful when the caller does not need intermediate Kz and K diagnostics.
 * 
 * @param w1 Membership value of "Thấp" (Low) [0.0, 1.0]
 * @param w2 Membership value of "Vừa" (Medium) [0.0, 1.0]
 * @param w3 Membership value of "Gần bằng" (Close/Almost) [0.0, 1.0]
 * @return float Computed watering time (TB) in seconds. Fallback to 0.0f if invalid or K == 0.
 */
float calculateFuzzyArea(float w1, float w2, float w3);

} // namespace MathEngine
