#pragma once

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#else
// Host-side unit-test stubs — QueueHandle_t is defined in test/Arduino.h.
// Provide a forward typedef so this header can be included before Arduino.h.
#ifndef QUEUEHANDLE_T_DEFINED
#define QUEUEHANDLE_T_DEFINED
typedef void* QueueHandle_t;
#endif
#endif

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
 * @brief Handle for the FreeRTOS queue carrying ActuatorCommand from Core 0 to Core 1.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xActuatorQueue;

/**
 * @brief Handle for the FreeRTOS queue carrying TelemetryData from Core 1 to Core 0.
 * Created during setup(); destroyed on shutdown.
 */
extern QueueHandle_t xTelemetryQueue;
