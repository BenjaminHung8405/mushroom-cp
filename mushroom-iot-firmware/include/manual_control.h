#pragma once

#include <stdint.h>
#include <array>
#include "models.h"
#include "Trajectory.h"
#include "relay_control.h"
#include "FuzzyController.h"

namespace manual {

struct ManualLatchEntry {
    bool active;
    AppIntent forced_state; // FORCE_ON or FORCE_OFF
    uint32_t expires_ms;
} __attribute__((aligned(4)));

using ManualLatchArray = std::array<ManualLatchEntry, static_cast<std::size_t>(AppChannel::COUNT)>;

/**
 * @brief Evaluates a manual request against safety bounds.
 */
ManualDecision evaluateSafetyGate(
    const ManualRequest &request,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime,
    uint16_t cropDay);

/**
 * @brief Updates the latch state when a request is accepted.
 */
void updateLatchOnAccepted(
    const ManualRequest &req,
    uint32_t now,
    ManualLatchArray &latch);

/**
 * @brief Expire manual latches past their TTL.
 */
void updateLatchDecay(
    ManualLatchArray &latch,
    uint32_t now);

/**
 * @brief Applies manual latch settings to fuzzy arbitrated outputs.
 * Handles TTL expiration and fuzzy-bounds guarding limit release, returning
 * any release events or ack modifications as needed.
 */
void applyManualLatchToOutputs(
    FuzzyController::ArbitratedOutputsPod &outputs,
    ManualLatchArray &latch,
    uint32_t now,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime,
    uint16_t cropDay);

/**
 * @brief Triggers auto-clear on sensor violation during FORCE_ON.
 */
void autoClearOnSensorViolation(
    ManualLatchArray &latch,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime);

} // namespace manual
