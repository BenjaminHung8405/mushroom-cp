#pragma once

/**
 * @file FuzzyController.h
 * @brief Fuzzy rule stages for temperature/humidity and CO2 exhaust control.
 *
 * This module only produces normalized, raw actuator demands. GPIO, timing,
 * adaptive gains, and hardware safety interlocks are deliberately kept in
 * later control stages.
 */

namespace FuzzyController {

/**
 * @brief Raw normalized demands from the temperature/humidity fuzzy rules.
 *
 * Every field is guaranteed to be within [0.0, 1.0]. The fields remain raw so
 * the output arbitration and TPC tasks can apply their own safety policies.
 */
struct DualHeaterOutputsPod {
    float HAir;
    float HWat;
    float Mist;
    float ExhTH;
} __attribute__((aligned(4)));

/**
 * @brief Explicit hysteresis memory for the CO2 exhaust rule stage.
 *
 * The state is caller-owned so Core 1 can keep it on the stack/static storage
 * without introducing hidden statics inside the pure control module.
 */
struct CO2RuleState {
    bool exhaust_active;  ///< Latch: true while the exhaust demand is held ON.
} __attribute__((aligned(4)));

/**
 * @brief Applies the temperature/humidity fuzzy rule base.
 *
 * Error convention: target - measured. A positive temperature error therefore
 * means cold, while a positive humidity error means dry. Non-finite input is
 * treated as unavailable sensor data and produces a zero-demand fail-safe.
 *
 * Rule invariants:
 * - Cold + dry gives priority to air heating and proportionally suppresses mist.
 * - Cold + wet gives priority to water heating; mist and thermal exhaust are off.
 * - Heating and mist share a normalized demand budget, preventing both from
 *   being driven at high power during the same cycle.
 *
 * @param errorTemp Temperature error in degrees Celsius (target - measured).
 * @param errorHumid Humidity error in %RH (target - measured).
 * @return Normalized raw demands for air heat, water heat, mist, and exhaust.
 */
DualHeaterOutputsPod executeDualHeaterRules(float errorTemp, float errorHumid);

/**
 * @brief Creates a cold-start CO2 hysteresis state (exhaust OFF).
 */
CO2RuleState makeInitialCO2State();

/**
 * @brief Applies the CO2 exhaust rule with deadband/hysteresis around the
 * setpoint to prevent continuous fan chatter.
 *
 * Error convention: target - measured. A negative error means the measured
 * CO2 is above the setpoint and exhaust is required. Non-finite input is
 * treated as sensor loss and forces a zero-demand fail-safe while clearing
 * the latch.
 *
 * Hysteresis policy:
 * - Engage exhaust when measured CO2 exceeds target by more than ON threshold.
 * - Keep exhaust latched until measured CO2 falls back inside the OFF band.
 * - Between the OFF and ON thresholds the previous latch is retained.
 *
 * @param state Mutable hysteresis latch owned by the caller.
 * @param errorCO2 CO2 error in ppm (target - measured).
 * @return Binary raw exhaust command: 1.0 for relay ON, 0.0 for relay OFF.
 */
float executeCO2Rules(CO2RuleState& state, float errorCO2);

} // namespace FuzzyController
