#pragma once

#include "core/models.h"
#include <ArduinoJson.h>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace storage {

/**
 * @brief Result codes for dynamic tuning updates.
 */
enum class TuningResult : uint8_t {
    ACCEPTED = 0,
    REJECTED = 1,
    DUPLICATE = 2
};

/**
 * @brief Reason codes providing details for the TuningResult.
 */
enum class TuningReason : uint8_t {
    OK = 0,
    INVALID_SCHEMA = 1,
    INVALID_DEVICE_ID = 2,
    INVALID_UUID = 3,
    OUT_OF_BOUNDS = 4,
    CROSS_FIELD_VIOLATION = 5,
    DUPLICATE_UUID = 6,
    NO_CHANGE = 7,             ///< Semantic diff check (no-write)
    NVS_WRITE_ERROR = 8,
    QUEUE_FULL_ERROR = 9
};

class TuningConfigManager {
public:
    static TuningConfigManager& getInstance();

    TuningConfigManager(const TuningConfigManager&) = delete;
    TuningConfigManager& operator=(const TuningConfigManager&) = delete;

    /**
     * @brief Initialize the TuningConfigManager.
     * Hydrates the config from NVS (both slots validation, fallback to defaults).
     * Creates/prepares the queue and enqueues the active configuration.
     * @return true if initialized successfully, false otherwise.
     */
    bool init();

    /**
     * @brief Process a desired tuning JSON command.
     * Validates schema, device ID, bounds, UUID, and does semantic diff.
     * If valid, persists to NVS double-buffer and posts to queue.
     * @param doc The parsed JSON object/variant.
     * @param reason Out parameter to receive the detail reason.
     * @return TuningResult ACCEPTED, REJECTED, or DUPLICATE.
     */
    TuningResult processCommand(const JsonVariant& doc, TuningReason& reason);

    /**
     * @brief Retrieve a stable copy of active tuning parameters.
     * Does not expose the internal NVS slot envelope.
     * @return DynamicTuningParams structure containing active config.
     */
    DynamicTuningParams getActiveParams();

    /**
     * @brief Reset manager state (mainly for unit tests isolation).
     */
    void resetForTest();

private:
    TuningConfigManager();
    ~TuningConfigManager() = default;

    DynamicTuningParams _active_params;
    bool _initialized = false;

#ifndef UNIT_TEST
    void* _mutex = nullptr;
#endif

    void lock();
    void unlock();

    // Helper functions for validation & NVS (implemented in C4 & C5)
    TuningReason validateAndParse(const JsonVariant& doc, DynamicTuningParams& out_params);
    bool loadFromNvs(DynamicTuningParams& out_params);
    bool saveToNvs(const DynamicTuningParams& params);
};

} // namespace storage
