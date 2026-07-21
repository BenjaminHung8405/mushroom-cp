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

constexpr size_t MAX_TUNING_DESIRED_PAYLOAD_BYTES = 512;

enum class CommandType : uint8_t {
    BOOTSTRAP_RESPONSE,
    DEVICE_COMMAND,
    SYNC_BURST_ACK,
    TUNING_DESIRED,
    UNKNOWN
};

struct NetworkMessage {
    CommandType type;
    uint16_t payload_length;
    char payload[768];
};

extern QueueHandle_t g_network_worker_queue;

class MessageDispatcher {
public:
    /** Non-blocking classification/copy from the PubSubClient callback. */
    static void dispatch(char* topic, uint8_t* payload, unsigned int length);
};

} // namespace mqtt
