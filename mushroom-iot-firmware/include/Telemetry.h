#pragma once

/**
 * @file Telemetry.h
 * @brief Delta thresholding and heartbeat keepalive logic for telemetry transmission.
 *
 * Part of fuzzy-logic-core-1 (Sprint 2 - Data Protocol).
 * Prevents redundant MQTT traffic by checking sensor deviations against safety limits.
 */

#include "models.h"
#include <Arduino.h>
#include <stdint.h>
#include <cmath>

namespace Telemetry {

/**
 * @brief Enum representing the action to take for telemetry publication.
 */
enum class PublishType : uint8_t {
    NONE = 0,   ///< No publish needed
    DELTA = 1,  ///< Only publish changed values
    FULL = 2    ///< Publish all values (keepalive or forced)
};

/**
 * @brief Persistent state of the telemetry manager, stored on Core 0.
 * Standard-layout POD structure optimized for memory alignment.
 */
struct TelemetryState {
    TelemetryData lastPubState;   ///< Cache of last successfully published values
    unsigned long lastPubTimeMs;  ///< Timestamp of last publish (millis())
    bool forceFullPublish;        ///< Set true to force a full publish on the next evaluation
} __attribute__((aligned(4)));

/**
 * @brief Creates a clean, initial TelemetryState with NAN cache and zeroed times.
 */
TelemetryState makeInitialState();

/**
 * @brief Helper function to check if a single sensor value has deviated past a delta threshold.
 *
 * Handles NAN values safely: if the NAN status of either value differs, a state change
 * is triggered. If both are NAN, no change is detected.
 *
 * @param val1 Current reading.
 * @param val2 Reference reading.
 * @param threshold Max allowed deviation.
 * @return true if deviation is exceeded or NAN status changed.
 */
bool isDeltaExceeded(float val1, float val2, float threshold);

/**
 * @brief Evaluates whether a new telemetry sample warrants transmission.
 *
 * Triggers a FULL publish if:
 *   - It is the very first publish.
 *   - The forceFullPublish flag is set.
 *   - The 10-second heartbeat keepalive has elapsed since the last publish.
 *
 * Triggers a DELTA publish if:
 *   - Temperature has drifted by > 0.2°C.
 *   - Humidity has drifted by > 1.0%.
 *   - CO2 level has drifted by > 10 ppm.
 *
 * This function is side-effect free: it only evaluates whether a publish is
 * needed. Call commitSuccessfulPublish() only after JSON construction
 * and MQTT publication have all succeeded.
 *
 * @param current Latest telemetry sample read from Core 1 queue.
 * @param state Persistent state from the last successful publication.
 * @param nowMs Current time in milliseconds (millis()).
 * @return PublishType indicating FULL, DELTA, or NONE.
 */
PublishType evaluateDeltaThresholds(const TelemetryData& current, const TelemetryState& state, unsigned long nowMs);

/**
 * @brief Commits a telemetry sample after its MQTT publication succeeds.
 *
 * Updates the last-published cache/time and clears a pending full-publish
 * request. Failed serialization or MQTT publication must not call
 * this function so the exact same work is retried on the next scan.
 */
void commitSuccessfulPublish(TelemetryState& state,
                             const TelemetryData& published,
                             unsigned long publishedAtMs);

/**
 * @brief Builds a JSON payload containing only the modified telemetry fields (or all fields for FULL).
 *
 * Uses a StaticJsonDocument<512> on the stack for heap protection.
 *
 * @param current Latest telemetry sample.
 * @param lastPubState Reference telemetry state from the last successful publish.
 * @param pubType NONE, DELTA, or FULL.
 * @return String containing the compact JSON payload, or an empty string if NONE.
 */
String buildDeltaPayload(const TelemetryData& current, const TelemetryData& lastPubState, PublishType pubType);

} // namespace Telemetry

