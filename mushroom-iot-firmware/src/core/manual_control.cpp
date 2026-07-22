#include "core/manual_control.h"
#include "config.h"
#include <cmath>

namespace manual {

namespace {
constexpr float MIST_WARNING_LIMIT_RH = 92.0f;
// LAMP_WARNING_DELTA_C: ngưỡng warning mềm (+3°C so với setpoint).
constexpr float LAMP_WARNING_DELTA_C = 3.0f;
// LAMP_HARD_CUTOFF_C: ngưỡng an toàn cứng tuyệt đối — không bypassđược.
// Khi nhiệt độ >= mức này, đèn phải tắt ngay, bất kể setpoint hay manual latch.
// Giá trị 45°C = giới hạn sinh học nấm rơm (tết tiêu hoàn toàn > 45°C).
constexpr float LAMP_HARD_CUTOFF_C = 45.0f;

void clearCabinetTest(ManualLatchEntry& latch) {
    latch.cabinet_test_active = false;
    latch.cabinet_test_expires_ms = 0;
}

} // namespace

bool requiresCabinetTestBypass(
    const ManualRequest &request,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints)
{
    if (request.intent != AppIntent::FORCE_ON) return false;
    if (request.channel == AppChannel::MIST) {
        return std::isfinite(telemetry.humidity_air) && telemetry.humidity_air >= MIST_WARNING_LIMIT_RH;
    }
    if (request.channel == AppChannel::LAMP) {
        return std::isfinite(telemetry.temp_air) && telemetry.temp_air < LAMP_HARD_CUTOFF_C &&
               telemetry.temp_air >= setpoints.temp_target + LAMP_WARNING_DELTA_C;
    }
    return false;
}

bool isCabinetTestActive(const ManualLatchEntry &latch, uint32_t now)
{
    return latch.active && latch.cabinet_test_active &&
           static_cast<int32_t>(now - latch.cabinet_test_expires_ms) < 0;
}

ManualDecision evaluateSafetyGate(
    const ManualRequest &request,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime,
    uint16_t cropDay)
{
    if (request.intent == AppIntent::AUTO || request.intent == AppIntent::FORCE_OFF) {
        return ManualDecision::Accepted;
    }

    if (request.channel == AppChannel::MIST) {
        if (!std::isfinite(telemetry.humidity_air)) {
            return ManualDecision::RejectedNAN;
        }
        if (telemetry.humidity_air >= MIST_WARNING_LIMIT_RH &&
            request.source != ManualRequestSource::CabinetButton) {
            return ManualDecision::RejectedHumi;
        }
        if (relay_control::isSafetyBlackoutActive(rtcTime)) {
            return ManualDecision::RejectedBlackout;
        }
        return ManualDecision::Accepted;
    }
    else if (request.channel == AppChannel::LAMP) {
        if (!std::isfinite(telemetry.temp_air)) {
            return ManualDecision::RejectedNAN;
        }
        // Hard safety cutoff tuyệt đối: không cho bật đèn khi nhiệt độ >= 45°C.
        // Kiểm tra này ưu tiên trước mọi điều kiện khác.
        if (telemetry.temp_air >= LAMP_HARD_CUTOFF_C) {
            Serial.printf("[DIAG] LAMP rejected HARD: temp=%.2fC >= 45.0C\n", telemetry.temp_air);
            return ManualDecision::RejectedTemp;
        }
        // Temporarily commented out:
        // if (cropDay > 8) {
        //     return ManualDecision::RejectedLocked;
        // }
        const float lamp_warn_limit = setpoints.temp_target + LAMP_WARNING_DELTA_C;
        if (telemetry.temp_air >= lamp_warn_limit &&
            request.source != ManualRequestSource::CabinetButton) {
            Serial.printf("[DIAG] LAMP rejected WARNING: temp=%.2fC >= target(%.2fC) + 3.0 = %.2fC\n",
                          telemetry.temp_air, setpoints.temp_target, lamp_warn_limit);
            return ManualDecision::RejectedTemp;
        }
        return ManualDecision::Accepted;
    }
    else if (request.channel == AppChannel::FAN) {
        return ManualDecision::Accepted;
    }
    else if (request.channel == AppChannel::HWAT) {
        return ManualDecision::Accepted;
    }

    return ManualDecision::Accepted;
}

void updateLatchOnAccepted(
    const ManualRequest &req,
    uint32_t now,
    ManualLatchArray &latch,
    bool fuzzy_enabled,
    bool cabinet_test)
{
    size_t idx = static_cast<size_t>(req.channel);
    if (idx >= latch.size()) {
        return;
    }
    if (req.intent == AppIntent::AUTO) {
        latch[idx].active = false;
        latch[idx].forced_state = AppIntent::AUTO;
        latch[idx].expires_ms = 0;
        clearCabinetTest(latch[idx]);
    } else {
        latch[idx].active = true;
        latch[idx].forced_state = req.intent;
        if (cabinet_test) {
            latch[idx].cabinet_test_active = true;
            latch[idx].cabinet_test_expires_ms = now + config::hardware::CABINET_BUTTON_TEST_ON_MS;
            latch[idx].expires_ms = latch[idx].cabinet_test_expires_ms;
            return;
        }
        clearCabinetTest(latch[idx]);
        // Fuzzy ON uses a bounded 30-second intervention. Fuzzy OFF keeps the
        // manual intent until another command replaces it; the Protector still
        // owns all bio-bound, cooldown, and maximum-runtime decisions.
        latch[idx].expires_ms = fuzzy_enabled
            ? now + config::hardware::MANUAL_LATCH_TTL_MS
            : 0U;
    }
}

void updateLatchDecay(
    ManualLatchArray &latch,
    uint32_t now)
{
    for (size_t i = 0; i < latch.size(); ++i) {
        // expires_ms == 0 denotes a persistent Fuzzy-OFF manual command.
        if (latch[i].active && latch[i].expires_ms != 0U) {
            if (static_cast<int32_t>(now - latch[i].expires_ms) >= 0) {
                latch[i].active = false;
                latch[i].forced_state = AppIntent::AUTO;
                latch[i].expires_ms = 0;
                clearCabinetTest(latch[i]);
            }
        }
    }
}

void autoClearOnSensorViolation(
    ManualLatchArray &latch,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime)
{
    const size_t mistIdx = static_cast<size_t>(AppChannel::MIST);
    // A safety blackout invalidates every Mist latch, including FORCE_OFF.
    // This lets Core 1 emit the normal release acknowledgement and erase the
    // persisted override before SystemProtector reaches the physical relay.
    const bool mistBlackout = relay_control::isSafetyBlackoutActive(rtcTime);
    if (latch[mistIdx].active &&
        (mistBlackout ||
         (latch[mistIdx].forced_state == AppIntent::FORCE_ON &&
          (!std::isfinite(telemetry.humidity_air) ||
           (!latch[mistIdx].cabinet_test_active &&
            telemetry.humidity_air >= MIST_WARNING_LIMIT_RH)))))
    {
        latch[mistIdx].active = false;
        latch[mistIdx].forced_state = AppIntent::AUTO;
        latch[mistIdx].expires_ms = 0;
        clearCabinetTest(latch[mistIdx]);
    }


    size_t lampIdx = static_cast<size_t>(AppChannel::LAMP);
    if (latch[lampIdx].active && latch[lampIdx].forced_state == AppIntent::FORCE_ON) {
        if (!std::isfinite(telemetry.temp_air) ||
            // Hard safety cutoff tuyệt đối: buộc tắt đèn nếu nhiệt độ >= 45°C.
            // Điều này đảm bảo đèn TẪT dù manual latch vẫn active.
            telemetry.temp_air >= LAMP_HARD_CUTOFF_C ||
            // Warning delta mềm: tắt khi vượt setpoint + 3°C
            (!latch[lampIdx].cabinet_test_active &&
             telemetry.temp_air >= setpoints.temp_target + LAMP_WARNING_DELTA_C))
        {
            latch[lampIdx].active = false;
            latch[lampIdx].forced_state = AppIntent::AUTO;
            latch[lampIdx].expires_ms = 0;
            clearCabinetTest(latch[lampIdx]);
        }
    }
}

void resetAllManualLatchesOnAOffTransition(manual::ManualLatchArray &latch)
{
    for (size_t i = 0; i < latch.size(); ++i) {
        if (latch[i].active && latch[i].forced_state != AppIntent::AUTO) {
            latch[i].active = false;
            latch[i].forced_state = AppIntent::AUTO;
            latch[i].expires_ms = 0;
            clearCabinetTest(latch[i]);
        }
    }
}

void applyManualLatchToOutputs(
    FuzzyController::ArbitratedOutputsPod &outputs,
    ManualLatchArray &latch,
    uint32_t now,
    const TelemetryData &telemetry,
    const Trajectory::SetpointPod &setpoints,
    const relay_control::RtcTimePod &rtcTime,
    uint16_t cropDay)
{
    // First, expire latch based on time
    updateLatchDecay(latch, now);

    // Second, clear latch on safety boundary violations (Fuzzy-Bounds Guarding).
    // A live cabinet test keeps only its soft-limit exception; hard stops still
    // clear the latch before the relay boundary.
    autoClearOnSensorViolation(latch, telemetry, setpoints, rtcTime);

    // Apply active latch overrides
    // Mist
    size_t mistIdx = static_cast<size_t>(AppChannel::MIST);
    if (latch[mistIdx].active) {
        if (latch[mistIdx].forced_state == AppIntent::FORCE_ON) {
            outputs.Mist = 1.0f;
        } else if (latch[mistIdx].forced_state == AppIntent::FORCE_OFF) {
            outputs.Mist = 0.0f;
        }
    }

    // Fan
    size_t fanIdx = static_cast<size_t>(AppChannel::FAN);
    if (latch[fanIdx].active) {
        if (latch[fanIdx].forced_state == AppIntent::FORCE_ON) {
            outputs.Exh = 1.0f;
        } else if (latch[fanIdx].forced_state == AppIntent::FORCE_OFF) {
            outputs.Exh = 0.0f;
        }
    }

    // Lamp
    size_t lampIdx = static_cast<size_t>(AppChannel::LAMP);
    if (latch[lampIdx].active) {
        if (latch[lampIdx].forced_state == AppIntent::FORCE_ON) {
            outputs.HLamp = 1.0f;
        } else if (latch[lampIdx].forced_state == AppIntent::FORCE_OFF) {
            outputs.HLamp = 0.0f;
        }
    }

    // Water heater. The non-bypassable hardware protection runs after this latch.
    const size_t hwatOutputIdx = static_cast<size_t>(AppChannel::HWAT);
    if (latch[hwatOutputIdx].active) {
        if (latch[hwatOutputIdx].forced_state == AppIntent::FORCE_ON) {
            outputs.HWat = 1.0f;
        } else if (latch[hwatOutputIdx].forced_state == AppIntent::FORCE_OFF) {
            outputs.HWat = 0.0f;
        }
    }
}

} // namespace manual
