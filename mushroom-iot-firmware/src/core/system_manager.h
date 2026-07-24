#pragma once

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/event_groups.h>
#include <freertos/semphr.h>
#else
// Host-side unit-test stubs — QueueHandle_t is defined in test/Arduino.h.
// Provide a forward typedef so this header can be included before Arduino.h.
#ifndef QUEUEHANDLE_T_DEFINED
#define QUEUEHANDLE_T_DEFINED
typedef void* QueueHandle_t;
#endif
#ifndef EVENTGROUPHANDLE_T_DEFINED
#define EVENTGROUPHANDLE_T_DEFINED
typedef void* EventGroupHandle_t;
#endif
#endif

#include "core/models.h"
#include "config.h"

// Wifi Event Bits for multi-core synchronization
#define WIFI_CONNECTED_BIT          (1 << 0)
#define WIFI_SOFTAP_BIT             (1 << 1)
// Hardware button (BOOT/GPIO0) requests handled by Core 0 WiFi manager.
#define WIFI_FORCE_PROVISION_BIT    (1 << 2)
#define WIFI_FACTORY_RESET_BIT      (1 << 3)

extern EventGroupHandle_t xWifiEventGroup;

extern volatile bool shared_forceFullPublish;
#ifndef UNIT_TEST
extern SemaphoreHandle_t xTelemetryMutex;
extern TaskHandle_t hTaskCore1Control;
extern TaskHandle_t hTaskHWButton;
extern TaskHandle_t hTaskEncoder;
extern TaskHandle_t hTaskCabinetButtons;
#endif

// Safe helper functions for thread-safe access to shared_forceFullPublish.
// consumeSharedForceFullPublish() reads and clears the request in one
// critical section, so a concurrent MQTT callback cannot be overwritten.
bool getSharedForceFullPublish();
bool consumeSharedForceFullPublish();
void setSharedForceFullPublish(bool val);

/** Returns Core-1-owned operating-mode mirror for telemetry serialization. */
config::OperatingMode getOperatingModeSnapshot();

enum class ControlSource : uint8_t {
    SafeOffline,
    TemporaryOverride,
    BaselineSetpoint,
    CropProfile,
    Trajectory,
};

const char* controlSourceName(ControlSource source);

struct SharedSystemState {
    float temp_air;
    float humidity_air;
    float co2_level;
    float temp_target;
    float humidity_target;
    float co2_target;
    float h_lamp_duty;
    float h_wat_duty;
    float mist_duty;
    float exhaust_duty;
    RelayOutputsPod actuators;  ///< Final direct SSR state, shared with local web API.
    ControlSource control_source;
    uint32_t config_revision;
};

#ifndef UNIT_TEST
extern SharedSystemState shared_systemState;
#endif

void updateSharedSystemState(const SharedSystemState& state);
SharedSystemState getSharedSystemState();

// Revisions are persisted by their respective storage manager and mirrored here
// so Core 1 telemetry can report the exact configuration currently in use.
void setBaselineConfigRevision(uint32_t revision);
uint32_t getBaselineConfigRevision();
void setProfileConfigRevision(uint32_t revision);
uint32_t getProfileConfigRevision();

#include "core/telemetry.h"

void processTelemetryPublication(unsigned long now, const TelemetryData& last_known_telemetry, Telemetry::TelemetryState& telemetryState);

/**
 * @brief FreeRTOS task running on Core 0 to handle WiFi and MQTT communication.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 */
void taskCore0Communication(void* pvParameters);

/**
 * @brief FreeRTOS task running on Core 1 to handle sensor reading and actuator control.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 */
void taskCore1Control(void* pvParameters);

/**
 * @brief FreeRTOS task running on Core 1 to poll the hardware WiFi-reset button.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 * @details Active-LOW BOOT/GPIO0. 5s hold forces SoftAP provisioning; 10s hold factory-resets NVS.
 */
void taskHardwareButton(void* pvParameters);

/**
 * @brief FreeRTOS task on Core 0 that processes KY-040 encoder input.
 */
void taskEncoderInput(void* pvParameters);

enum class HardwareOverridePersistenceOperation : uint8_t {
    Save,
    Clear,
};

/** POD request from the encoder input task to the Core-0 NVS worker. */
struct HardwareOverridePersistenceRequest {
    uint32_t sequence;
    HardwareOverridePersistenceOperation operation;
    float temp_target;
    float humidity_target;
} __attribute__((aligned(4)));

/** POD result returned after Core 0 has durably handled an encoder request. */
struct HardwareOverridePersistenceResult {
    uint32_t sequence;
    HardwareOverridePersistenceOperation operation;
    bool success;
    uint8_t padding[3];
    uint32_t latency_ms;
} __attribute__((aligned(4)));

#ifndef UNIT_TEST
/**
 * @brief FreeRTOS task on Core 0 that processes physical cabinet buttons with Shift-Register debounce.
 */
void taskCabinetButtons(void* pvParameters);
#endif

namespace cabinet_buttons {
    /**
     * @brief Reset the toggle state for a channel back to FORCE_ON.
     * Must be called by Core 0 whenever a manual latch is auto-released (TTL expire or safety gate),
     * so that the next physical press correctly sends FORCE_ON again.
     */
    void notify_latch_released(AppChannel channel);

#ifdef UNIT_TEST
    void process_cabinet_buttons();
    void reset_for_test();
#endif
}


/**
 * @brief Handle for the FreeRTOS queue carrying TelemetryData from Core 1 to Core 0.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xTelemetryQueue;

/**
 * @brief Handle for the FreeRTOS queue carrying baseline setpoints (Backend baseline) from Core 0/NVS to Core 1.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xBaselineQueue;

/**
 * @brief Handle for the FreeRTOS queue carrying hardware override setpoints from Core 0/NVS/Encoder to Core 1.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xOverrideQueue;

/** Latest hardware-override persistence request (encoder -> Core 0). */
extern QueueHandle_t xHardwareOverridePersistenceRequestQueue;

/** Latest hardware-override persistence result (Core 0 -> encoder). */
extern QueueHandle_t xHardwareOverridePersistenceResultQueue;

/** Executes at most one encoder persistence request on Core 0. */
void processHardwareOverridePersistence();

/**
 * @brief Handle for the FreeRTOS queue carrying manual actuator overrides from Core 0 to Core 1.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xActuatorOverrideQueue;

/**
 * @brief Handle for the FreeRTOS queue carrying manual requests (Core 0/buttons to Core 1).
 */
/**
 * @brief Unified, non-blocking Core 0 -> Core 1 control event queue.
 * Core 1 drains this FIFO at the beginning of each control tick.
 */
extern QueueHandle_t g_control_event_queue;

/** Enqueue a control event without blocking. Returns false when the queue is full. */
bool enqueueControlEvent(const ControlEvent& event);

// Deprecated test-only compatibility handles. They are never consumed by the
// production pipeline; all real producers use g_control_event_queue.
extern QueueHandle_t g_manual_request_queue;
extern QueueHandle_t g_mqtt_override_queue;


/**
 * @brief Handle for the FreeRTOS queue carrying manual acks (Core 1 to Core 0).
 */
extern QueueHandle_t g_manual_ack_queue;

/** Core 1 -> Core 0 operating-mode command acknowledgements. */
extern QueueHandle_t g_operating_mode_ack_queue;

/**
 * @brief Handle for the FreeRTOS queue carrying complete validated crop profiles from Core 0 to Core 1.
 */
extern QueueHandle_t g_profile_update_queue;
extern QueueHandle_t g_tuning_config_queue;

/**
 * @brief Hydrate setpoints from NVS and push them to xBaselineQueue and xOverrideQueue.
 * Fallbacks to trajectory Day 0 if NVS baseline is missing/invalid.
 */
void initQueues();
void initSemaphores();
void createCoreTasks();
void hydrateSetpointsFromNVS();
