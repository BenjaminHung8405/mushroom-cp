#pragma once

#include <stdint.h>
#include <array>
#include "models.h"
#include "Trajectory.h"
#include "TPC_Task.h"
#include "FuzzyController.h"

enum class AppChannel : uint8_t {
    MIST = 0,
    LAMP = 1,
    FAN  = 2,
    COUNT
};

enum class AppIntent : uint8_t {
    AUTO = 0,     // Trả quyền về Fuzzy/TPC
    FORCE_ON = 1,  // Ép bật có kiểm soát (Fuzzy-Bounds Guarding)
    FORCE_OFF = 2, // Ép tắt
};

struct ManualRequest {
    AppChannel channel;
    AppIntent  intent;      // AUTO / FORCE_ON / FORCE_OFF
    uint32_t   request_ms;  // millis() lúc phát request
} __attribute__((aligned(4)));

struct ActuatorOverridePayload {
    AppChannel channel;
    AppIntent  intent;      // AUTO / FORCE_ON / FORCE_OFF
    uint32_t   request_ms;  // epoch ms từ client (cho audit trail)
} __attribute__((aligned(4)));

enum class ManualDecision : uint8_t {
    Accepted     = 0,
    RejectedNAN  = 1,
    RejectedTemp = 2,
    RejectedHumi = 3,
    RejectedBlackout = 4,
    RejectedRateLimit = 5,
    RejectedLocked = 6,    // crop-day lock (heater_air > day 8) hoặc blackout cứng
};

struct ManualAck {
    AppChannel     channel;
    AppIntent      requested_intent;
    ManualDecision decision;
    uint32_t       ack_ms;
} __attribute__((aligned(4)));

namespace manual {

struct ManualLatchEntry {
    bool active;
    AppIntent forced_state; // FORCE_ON or FORCE_OFF
    uint32_t expires_ms;
} __attribute__((aligned(4)));

using ManualLatchArray = std::array<ManualLatchEntry, static_cast<size_t>(AppChannel::COUNT)>;

/**
 * @brief Evaluates a manual request against safety bounds.
 */
ManualDecision evaluateSafetyGate(
    const ManualRequest &request,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const TPC_Task::RtcTimePod &rtcTime,
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
    const TPC_Task::RtcTimePod &rtcTime,
    uint16_t cropDay);

/**
 * @brief Triggers auto-clear on sensor violation during FORCE_ON.
 */
void autoClearOnSensorViolation(
    ManualLatchArray &latch,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const TPC_Task::RtcTimePod &rtcTime);

} // namespace manual
