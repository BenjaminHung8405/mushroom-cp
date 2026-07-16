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

/**
 * @brief Computes membership value for a triangular membership function (trimf).
 * 
 * @param x The input value.
 * @param a The left feet (value where membership starts to rise from 0 to 1).
 * @param b The peak (value where membership is 1.0).
 * @param c The right feet (value where membership returns to 0).
 * @return float The membership value in range [0.0, 1.0].
 */
float computeMembership(float x, float a, float b, float c);

/**
 * @brief Computes membership value for a trapezoidal membership function (trapmf).
 * 
 * @param x The input value.
 * @param a The left feet (value where membership starts to rise from 0 to 1).
 * @param b The left peak start (value where membership reaches 1.0).
 * @param c The right peak end (value where membership starts to fall from 1.0).
 * @param d The right feet (value where membership returns to 0).
 * @return float The membership value in range [0.0, 1.0].
 */
float computeMembership(float x, float a, float b, float c, float d);

} // namespace MathEngine
