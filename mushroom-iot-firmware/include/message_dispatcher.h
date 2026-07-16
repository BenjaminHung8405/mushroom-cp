#pragma once
#include <Arduino.h>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#else
#ifndef QUEUEHANDLE_T_DEFINED
#define QUEUEHANDLE_T_DEFINED
typedef void* QueueHandle_t;
#endif
#endif

namespace mqtt {
    enum class CommandType {
        SETPOINT_UPDATE,
        PROFILE_UPDATE,
        UNKNOWN
    };

    struct NetworkMessage {
        CommandType type;
        char payload[512]; // Fixed-size buffer to prevent heap fragmentation
    };

    // FreeRTOS queue handle connecting Core 0 network callbacks to background worker
    extern QueueHandle_t g_network_worker_queue;

    class MessageDispatcher {
    public:
        /**
         * @brief Dispatches the received MQTT topic and payload to the background queue worker.
         * Runs on the network task. Must be non-blocking and lightweight.
         */
        static void dispatch(char* topic, uint8_t* payload, unsigned int length);
    };
}
