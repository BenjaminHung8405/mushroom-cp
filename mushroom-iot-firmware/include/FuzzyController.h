#pragma once

/**
 * @file FuzzyController.h
 * @brief Stateless fuzzy rules for the temperature/humidity control domain.
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

} // namespace FuzzyController
