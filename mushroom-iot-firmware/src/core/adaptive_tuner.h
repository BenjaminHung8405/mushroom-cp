#pragma once

/**
 * @file AdaptiveTuner.h
 * @brief Adaptive gain scheduling from temperature/humidity surface integral errors.
 *
 * Part of fuzzy-logic-core-1 (Sprint 1 - Core Business Logic).
 * Holds only explicit integral state (no hidden static globals) and is
 * hardware-independent so it can run on ESP32 Core 1 or host unit tests.
 */

namespace AdaptiveTuner {

/**
 * @brief Plain Old Data (POD) structure for actuator gain multipliers.
 * Each gain is expected to stay inside the safety band [0.5, 2.5].
 */
struct GainsPod {
    float gain_HLamp; ///< Heat-lamp cluster gain multiplier
    float gain_HWat;  ///< Water-heater gain multiplier
    float gain_Mist;  ///< Mist actuator gain multiplier
} __attribute__((aligned(4)));

/**
 * @brief Explicit integral state used by the adaptive law.
 * Anti-windup clamps are applied to these accumulators in-place.
 */
struct IntegralState {
    float integral_temp;   ///< Accumulated temperature surface error (°C·s)
    float integral_humid;  ///< Accumulated humidity surface error (%·s)
} __attribute__((aligned(4)));

/**
 * @brief Creates a zeroed integral state suitable for cold start.
 */
IntegralState makeInitialState();

/**
 * @brief Returns the nominal gains before any adaptation (all 1.0).
 */
GainsPod defaultGains();

/**
 * @brief Resets integral accumulators to zero (e.g. after manual override).
 */
void reset(IntegralState& state);

/**
 * @brief Updates gains from temperature/humidity surface integral errors.
 *
 * Surface integral law (anti-windup included):
 *   I_T = sat(I_T + errorTemp  * dt, ±I_MAX_T)
 *   I_H = sat(I_H + errorHumid * dt, ±I_MAX_H)
 *   gain_HLamp = clamp(1.0 + kT * I_T, 0.5, 2.5)
 *   gain_HWat = clamp(1.0 + kT * I_T + 0.25 * kH * I_H, 0.5, 2.5)
 *   gain_Mist = clamp(1.0 + kH * I_H, 0.5, 2.5)
 *
 * Invalid sensor samples (NaN/Inf) freeze the corresponding integral term
 * instead of integrating garbage, which is the primary windup guard when a
 * sensor drops offline. Invalid or non-positive dt also freezes both terms.
 *
 * @param state Mutable integral accumulators.
 * @param errorTemp Temperature surface error = target - measured (°C).
 * @param errorHumid Humidity surface error = target - measured (%RH).
 * @param dtSeconds Control period in seconds.
 * @return Latest GainsPod with each channel hard-clamped to [0.5, 2.5].
 */
GainsPod updateGains(IntegralState& state,
                     float errorTemp,
                     float errorHumid,
                     float dtSeconds);

} // namespace AdaptiveTuner
