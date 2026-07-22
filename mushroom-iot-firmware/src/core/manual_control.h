#pragma once

#include <stdint.h>
#include <array>
#include "core/models.h"
#include "core/trajectory.h"
#include "core/actuator_controller.h"
#include "core/fuzzy_controller.h"

namespace manual {

struct ManualLatchEntry {
    bool active;
    AppIntent forced_state; // FORCE_ON or FORCE_OFF
    uint32_t expires_ms;
    // A bounded exception for a physical cabinet-button functional test. It
    // bypasses only soft bio limits and never hard interlocks or cooldowns.
    bool cabinet_test_active = false;
    uint8_t padding[3] = {0, 0, 0};
    uint32_t cabinet_test_expires_ms = 0;
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
    ManualLatchArray &latch,
    bool fuzzy_enabled,
    bool cabinet_test = false);

/** True while a bounded cabinet-button soft-limit test may energize a relay. */
bool isCabinetTestActive(const ManualLatchEntry &latch, uint32_t now);

/** True only for an upper soft limit eligible for a cabinet-button test. */
bool requiresCabinetTestBypass(
    const ManualRequest &request,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints);

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
/** Clears all active manual latches during a global AI -> MANUAL transition. */
void resetAllManualLatchesOnAOffTransition(ManualLatchArray &latch);

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
