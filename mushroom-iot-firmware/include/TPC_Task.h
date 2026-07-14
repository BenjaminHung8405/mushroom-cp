#pragma once

#include <stdint.h>

#include "FuzzyController.h"

/**
 * @file TPC_Task.h
 * @brief Hardware safety interlock and non-blocking time-proportional SSR control.
 *
 * TPC is intentionally the sole layer that translates normalized demands into
 * GPIO levels. It uses long windows and minimum transition times; it is not
 * high-frequency PWM.
 */
namespace TPC_Task
{

    /** A validated local RTC sample used by the biosafety interlock. */
    struct RtcTimePod
    {
        bool valid;
        uint8_t hour;
        uint8_t minute;
    } __attribute__((aligned(4)));

    /** Per-SSR timing configuration, expressed in milliseconds. */
    struct TpcChannelConfig
    {
        uint8_t pin;
        uint32_t window_ms;
        uint32_t min_on_ms;
        uint32_t min_off_ms;
        uint32_t offset_ms;
    } __attribute__((aligned(4)));

    /** Explicit, caller-owned scheduler state for one SSR channel. */
    struct TpcChannelState
    {
        uint32_t window_started_ms;
        uint32_t last_transition_ms;
        bool output_high;
        bool initialized;
    } __attribute__((aligned(4)));

    /** Scheduler state for all four physical SSR outputs. */
    struct TpcSchedulerState
    {
        TpcChannelState Lamp1;
        TpcChannelState Lamp2;
        TpcChannelState HWat;
        TpcChannelState Mist;
        TpcChannelState Exh;
    } __attribute__((aligned(4)));

    /**
     * @brief Returns a zeroed, explicitly uninitialized scheduler state.
     */
    TpcSchedulerState makeInitialSchedulerState();

    /**
     * @brief Enforces the non-bypassable midday water-heater/mister blackout.
     *
     * Both channels are forced to zero from 11:00 through 13:30 inclusive. An
     * unavailable or malformed RTC sample is fail-safe and applies the same
     * shutdown. Other output channels are left unchanged.
     */
    void hardwareProtectionOverride(
        FuzzyController::ArbitratedOutputsPod &outputs,
        const RtcTimePod &rtcTime);

    /**
     * @brief Converts a normalized duty into SSR GPIO state using a TPC window.
     *
     * `millis()` is sampled internally and the function never blocks. The state
     * is caller-owned, so no scheduler state is hidden in static globals. A valid
     * channel configuration requires a non-zero window; an invalid configuration
     * fails safe by commanding LOW. GPIO output is exclusively digitalWrite.
     */
    void updateTpcChannel(
        const TpcChannelConfig &config,
        TpcChannelState &state,
        float dutyDemand);

    /**
     * @brief Staged dispatch of lamp demand across two physical lamp channels.
     */
    void applyLampStaging(
        float lampDemand,
        TpcChannelState& stage1,
        TpcChannelState& stage2,
        const TpcChannelConfig& config1,
        const TpcChannelConfig& config2);

    /**
     * @brief Applies protected duty demands to all SSR channels using TPC.
     */
    void applyTpcOutputs(
        const FuzzyController::ArbitratedOutputsPod &outputs,
        const TpcChannelConfig &lamp1Config,
        const TpcChannelConfig &lamp2Config,
        const TpcChannelConfig &hWatConfig,
        const TpcChannelConfig &mistConfig,
        const TpcChannelConfig &exhConfig,
        TpcSchedulerState &state);

} // namespace TPC_Task

