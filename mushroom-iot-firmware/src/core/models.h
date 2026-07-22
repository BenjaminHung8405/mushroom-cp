#pragma once

#include <stdint.h>

/**
 * @brief Plain Old Data (POD) structure for sensor telemetry.
 * Optimized for 32-bit MCU memory alignment.
 *
 * Active sensors:
 *   - SHT30  → temp_air, humidity_air  (real I2C reads)
 *
 * Not integrated / removed:
 *   - DS18B20 (substrate temp) — not used; SHT30 covers thermal needs.
 *   - SCD30   (CO2)            — hardware not present; co2_level stays NAN.
 */
/**
 * @brief Edge-authoritative physical SSR output snapshot.
 *
 * Values are copied from the direct relay dispatcher's final output states, never
 * inferred from sensor readings or read back from GPIO.
 */
struct RelayOutputsPod {
    bool mist_active;
    bool fan_active;
    bool lamp_stage_active;       ///< Bóng đèn nhiệt tầng 1 (LAMP_1) đang bật
    bool lamp_stage2_active;      ///< Bóng đèn nhiệt tầng 2 (LAMP_2) đang bật
    bool heater_water_active;
    bool midday_blackout_active;
    uint8_t padding[2];
} __attribute__((aligned(4)));

struct TelemetryData {
    float temp_air;        ///< Air temperature in °C (from SHT30)
    float humidity_air;    ///< Air humidity in % (from SHT30)
    float co2_level;       ///< CO2 level in ppm — NAN until SCD30 is integrated
    RelayOutputsPod actuators; ///< Final edge SSR states for this control sample
} __attribute__((aligned(4)));

/**
 * @brief Plain Old Data (POD) structure for setpoint control commands.
 * Transmitted from Core 0/NVS/Encoder to Core 1 control loop via FreeRTOS queue.
 */
struct ControlSetpointCommand {
    float temp_target;
    float humidity_target;
    float co2_target;
    bool active;
    uint8_t padding[3];    ///< Explicit padding to align to 32-bit boundary (16 bytes total)
} __attribute__((aligned(4)));

/**
 * @brief Plain Old Data (POD) structure for actuator manual override commands.
 * Transmitted from Core 0 to Core 1 control loop via FreeRTOS queue.
 */
struct ActuatorOverrideCommand {
    int8_t mist_override;       // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    int8_t fan_override;        // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    int8_t heater_air_override; // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
    bool active;
} __attribute__((aligned(4)));

enum class AppChannel : uint8_t {
    MIST = 0,
    LAMP = 1,
    FAN  = 2,
    HWAT = 3,
    COUNT
};

// Unified override intent — shared by UI (MQTT) and physical buttons.
// Replaces the old toggle-only `intent_on` boolean with explicit three-state intent.
enum class AppIntent : uint8_t {
    AUTO = 0,     // Trả quyền về Fuzzy/direct relay control
    FORCE_ON = 1,  // Ép bật có kiểm soát (Fuzzy-Bounds Guarding)
    FORCE_OFF = 2, // Ép tắt
};

// Internal-only provenance for control-plane requests. MQTT payloads do not
// expose this field; producers must explicitly identify their origin.
enum class ManualRequestSource : uint8_t {
    Remote = 0,
    CabinetButton = 1,
};

struct ManualRequest {
    AppChannel channel;
    AppIntent  intent;      // AUTO / FORCE_ON / FORCE_OFF
    uint32_t   request_ms;  // millis() lúc phát request
    ManualRequestSource source = ManualRequestSource::Remote;
    uint8_t padding[3] = {0, 0, 0};
} __attribute__((aligned(4)));

/**
 * @brief Single Core 0/Core 1 control-plane event.
 *
 * Producers only enqueue this fixed-size POD. Core 1 is the sole owner of
 * operating mode, manual latches, protection state, and physical relays.
 */
enum class ControlEventType : uint8_t {
    ManualRequest = 0,
    OperatingMode = 1,
};

struct ControlEvent {
    ControlEventType type;
    uint8_t mode;                 ///< config::OperatingMode value for OperatingMode events
    uint16_t reserved;
    ManualRequest manual;         ///< Valid only when type == ManualRequest
    char command_id[37];          ///< MQTT UUID for an OperatingMode event; empty for a button
    uint32_t received_ms;
} __attribute__((aligned(4)));

/** Core 1 -> Core 0 result for a queued operating-mode command. */
struct OperatingModeAck {
    char command_id[37];
    bool success;
    uint8_t reserved[2];
    uint32_t latency_ms;
    char error_code[24];
    char error_message[64];
} __attribute__((aligned(4)));

// Payload từ Web UI qua MQTT override topic — cùng schema với ManualRequest.
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

enum class TimeConfidence : uint8_t {
    Trusted = 0,       // clock đã sync, hoặc external RTC hợp lệ
    Holdover = 1,      // mất mạng nhưng MCU chưa reset từ trusted time
    Uncertain = 2,     // reset sau mất điện, chưa có trusted time
};

enum class ManualReleaseReason : uint8_t {
    None = 0,
    TTLExpired = 1,
    SafetyLimitReached = 2,
    HardwareProtection = 3,
};

struct ManualAck {
    AppChannel          channel;
    AppIntent           requested_intent;
    ManualDecision      decision;
    AppIntent           effective_intent;
    ManualReleaseReason release_reason;
    TimeConfidence      time_confidence;
    uint8_t             padding[2];
    uint32_t            expires_ms;
    uint32_t            ack_ms;
} __attribute__((aligned(4)));

constexpr uint16_t MAX_CROP_CHECKPOINTS = 10;



struct CropCheckpoint {
    uint16_t crop_day;
    float temp_target_c;
    float humidity_target_rh;
} __attribute__((aligned(4)));

struct PersistedCropProfile {
    uint32_t magic;
    uint16_t schema_version;
    uint16_t checkpoint_count; // 1..MAX_CROP_CHECKPOINTS, tối đa 10
    int64_t crop_start_epoch_s;
    uint16_t total_crop_days;
    CropCheckpoint checkpoints[MAX_CROP_CHECKPOINTS];
    uint32_t crc32;
} __attribute__((aligned(4)));

struct PersistedTimeState {
    int64_t last_trusted_epoch_s;
    uint64_t last_trusted_uptime_ms;
    uint32_t crc32;
} __attribute__((aligned(4)));

struct PersistedManualOverride {
    AppIntent intent;
    uint8_t padding[3];
    uint32_t expires_epoch_s;
} __attribute__((aligned(4)));


