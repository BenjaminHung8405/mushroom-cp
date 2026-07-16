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

enum class CommandType : uint8_t {
    PROVISIONING_ACK,
    DEVICE_COMMAND,
    UNKNOWN
};

struct NetworkMessage {
    CommandType type;
    char payload[768];
};

extern QueueHandle_t g_network_worker_queue;

class MessageDispatcher {
public:
    /** Non-blocking classification/copy from the PubSubClient callback. */
    static void dispatch(char* topic, uint8_t* payload, unsigned int length);
};

} // namespace mqtt
