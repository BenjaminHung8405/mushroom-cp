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
    /**
     * @brief Create RTOS resources (EventGroup) at startup.
     * Must be called once at firmware startup, at the same tier as queue/task creation.
     * Returns false if resource allocation fails (fail-fast).
     */
    static bool init();
    /** Configure the sole desired topic accepted by the callback. */
    static bool setExpectedTuningDesiredTopic(const char* topic);
    /** Non-blocking classification/copy from the PubSubClient callback. */
    static void dispatch(char* topic, uint8_t* payload, unsigned int length);
    /** Consume one deferred queue-overflow signal in the Core-0 worker. */
    static bool consumeTuningQueueOverflow();
};

} // namespace mqtt
