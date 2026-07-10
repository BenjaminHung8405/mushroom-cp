#pragma once

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

/**
 * @brief FreeRTOS task running on Core 0 to handle WiFi and MQTT communication.
 * @param pvParameters Parameter pointer passed to the task (not used, can be nullptr).
 */
void task_core0_communication(void* pvParameters);
