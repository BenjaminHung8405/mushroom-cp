#pragma once

#include "AdaptiveTuner.h"

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
 * @brief Raw TPC duty demands from the temperature/humidity fuzzy rules.
 *
 * Every field is a continuous duty demand in [0.0, 1.0] for the later TPC
 * scheduler (0.0 = always OFF, 1.0 = always ON within the TPC window). This
 * stage must not threshold or map demands to relay boolean HIGH/LOW.
 */
struct DualHeaterOutputsPod {
    float HLamp;
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
 * @brief Post-arbitration actuator demands ready for the protection/GPIO stage.
 *
 * Every field is hard-clamped to [0.0, 1.0]. Current hardware maps these
 * demands to ON/OFF relays later (duty > 0.5 => ON); there is no PWM here.
 */
struct ArbitratedOutputsPod {
    float HLamp;
    float HWat;
    float Mist;
    float Exh;
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
 * TPC semantics:
 * - Each returned channel is a continuous duty demand in [0.0, 1.0].
 * - This function never thresholds to boolean relay commands and never touches
 *   GPIO; TPC is the only stage that converts duty into HIGH/LOW phases.
 *
 * @param errorTemp Temperature error in degrees Celsius (target - measured).
 * @param errorHumid Humidity error in %RH (target - measured).
 * @return Continuous TPC duty demands for lamp heat, water heat, mist, and exhaust.
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
 * @return Normalized raw TPC demand: 1.0 while the latch requests exhaust, 0.0 otherwise.
 */
float executeCO2Rules(CO2RuleState& state, float errorCO2);

/**
 * @brief Applies adaptive gains and resolves the two exhaust requests.
 *
 * HLamp, HWat, and Mist are multiplied by their respective adaptive gains.
 * Thermal/humidity and CO2 exhaust demands are decoupled and merged with
 * std::max so either subsystem can independently request the shared exhaust
 * channel. Results after gain multiplication are hard-clamped to [0.0, 1.0].
 *
 * Non-finite raw demands or gains fail safe to OFF for their channel. Gains
 * are additionally bounded to the AdaptiveTuner safety band [0.5, 2.5]
 * before multiplication.
 *
 * @param thermalOutputs Raw normalized temperature/humidity outputs.
 * @param exhCO2 Raw normalized CO2 exhaust demand.
 * @param gains Adaptive gains for HLamp, HWat, and Mist.
 * @return Normalized post-arbitration demands for the protection/GPIO stage.
 */
ArbitratedOutputsPod arbitrateOutputs(
    const DualHeaterOutputsPod& thermalOutputs,
    float exhCO2,
    const AdaptiveTuner::GainsPod& gains);

} // namespace FuzzyController
