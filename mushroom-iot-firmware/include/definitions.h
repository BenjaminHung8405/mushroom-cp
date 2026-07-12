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
#endif

// Safe helper functions for thread-safe access to shared_forceFullPublish
bool get_shared_force_full_publish();
void set_shared_force_full_publish(bool val);

#include "models.h"

/**
 * @brief FreeRTOS task running on Core 0 to handle WiFi and MQTT communication.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 */
void task_core0_communication(void* pvParameters);

/**
 * @brief FreeRTOS task running on Core 1 to handle sensor reading and actuator control.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 */
void task_core1_control(void* pvParameters);

/**
 * @brief FreeRTOS task running on Core 1 to poll the hardware WiFi-reset button.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 * @details Active-LOW BOOT/GPIO0. 5s hold forces SoftAP provisioning; 10s hold factory-resets NVS.
 */
void task_hardware_button(void* pvParameters);

/**
 * @brief Handle for the FreeRTOS queue carrying ActuatorCommand from Core 0 to Core 1.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xActuatorQueue;

/**
 * @brief Handle for the FreeRTOS queue carrying TelemetryData from Core 1 to Core 0.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xTelemetryQueue;
