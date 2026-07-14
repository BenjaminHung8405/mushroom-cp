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

#include "models.h"

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
#endif

// Safe helper functions for thread-safe access to shared_forceFullPublish.
// consumeSharedForceFullPublish() reads and clears the request in one
// critical section, so a concurrent MQTT callback cannot be overwritten.
bool getSharedForceFullPublish();
bool consumeSharedForceFullPublish();
void setSharedForceFullPublish(bool val);

struct SharedSystemState {
    float temp_air;
    float humidity_air;
    float co2_level;
    float temp_target;
    float humidity_target;
    float co2_target;
    float h_air_duty;
    float h_wat_duty;
    float mist_duty;
    float exhaust_duty;
    RelayOutputsPod actuators;  ///< Final TPC SSR state, shared with local web API.
};

#ifndef UNIT_TEST
extern SharedSystemState shared_systemState;
#endif

void updateSharedSystemState(const SharedSystemState& state);
SharedSystemState getSharedSystemState();

#include "Telemetry.h"

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

/**
 * @brief Hydrate setpoints from NVS and push them to xBaselineQueue and xOverrideQueue.
 * Fallbacks to trajectory Day 0 if NVS baseline is missing/invalid.
 */
void hydrateSetpointsFromNVS();

