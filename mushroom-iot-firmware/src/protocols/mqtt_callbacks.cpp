#include "protocols/mqtt_callbacks.h"
#include <cstring>

#ifndef UNIT_TEST
#include <freertos/event_groups.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

namespace mqtt {
namespace {

constexpr size_t MAX_TUNING_DESIRED_TOPIC_BYTES = 160;
constexpr EventBits_t TUNING_QUEUE_OVERFLOW_EVENT = (1 << 0);
char expected_tuning_desired_topic[MAX_TUNING_DESIRED_TOPIC_BYTES]{};
size_t expected_tuning_desired_topic_length = 0;
EventGroupHandle_t tuning_callback_events = nullptr;

bool isTuningDesiredTopic(const char* topic)
{
    if (topic == nullptr || expected_tuning_desired_topic_length == 0) {
        return false;
    }

    const size_t topic_length = strlen(topic);
    return topic_length == expected_tuning_desired_topic_length &&
           memcmp(topic, expected_tuning_desired_topic, topic_length) == 0;
}

} // namespace

QueueHandle_t g_network_worker_queue = nullptr;

bool MessageDispatcher::setExpectedTuningDesiredTopic(const char* topic)
{
    if (topic == nullptr) return false;
    const size_t length = strnlen(topic, MAX_TUNING_DESIRED_TOPIC_BYTES);
    if (length == 0 || length >= MAX_TUNING_DESIRED_TOPIC_BYTES) return false;

    // EventGroup must have been created by init() at startup.
    // setExpectedTuningDesiredTopic() is a pure configuration setter and must
    // not create RTOS resources; that belongs to the startup ownership tier.
    if (tuning_callback_events == nullptr) {
        // init() was not called — this is a programming error.
        return false;
    }

    memcpy(expected_tuning_desired_topic, topic, length);
    expected_tuning_desired_topic[length] = '\0';
    expected_tuning_desired_topic_length = length;
    return true;
}

bool MessageDispatcher::init()
{
    // Create the EventGroup used by the callback/Core-0 overflow signal at the
    // same startup tier where queues and tasks are created. This gives clear
    // ownership, predictable lifecycle, and fail-fast feedback on OOM at boot.
    if (tuning_callback_events != nullptr) {
        // Already initialised (e.g. in tests that call init() twice).
        return true;
    }
    tuning_callback_events = xEventGroupCreate();
    return tuning_callback_events != nullptr;
}

void MessageDispatcher::dispatch(char* topic, uint8_t* payload, unsigned int length)
{
    if (topic == nullptr || g_network_worker_queue == nullptr) {
        return;
    }

    NetworkMessage msg{};
    if (strstr(topic, "/provision/response/") != nullptr) {
        msg.type = CommandType::BOOTSTRAP_RESPONSE;
    } else if (strstr(topic, "/down/command") != nullptr) {
        msg.type = CommandType::DEVICE_COMMAND;
    } else if (strstr(topic, "/down/sync-burst/ack") != nullptr) {
        msg.type = CommandType::SYNC_BURST_ACK;
    } else if (isTuningDesiredTopic(topic)) {
        if (length > MAX_TUNING_DESIRED_PAYLOAD_BYTES) {
            return;
        }
        msg.type = CommandType::TUNING_DESIRED;
    } else {
        return;
    }

    const unsigned int copy_len = length < sizeof(msg.payload) - 1
                                      ? length
                                      : sizeof(msg.payload) - 1;
    if (payload != nullptr && copy_len > 0) {
        memcpy(msg.payload, payload, copy_len);
    }
    msg.payload[copy_len] = '\0';
    msg.payload_length = static_cast<uint16_t>(copy_len);
    if (xQueueSend(g_network_worker_queue, &msg, 0) != pdTRUE) {
        // The callback only records the bounded failure. Core 0 performs all
        // logging, reporting, and reconnect work outside this callback.
        if (msg.type == CommandType::TUNING_DESIRED) {
            xEventGroupSetBits(tuning_callback_events, TUNING_QUEUE_OVERFLOW_EVENT);
        }
    }
}

bool MessageDispatcher::consumeTuningQueueOverflow()
{
    if (tuning_callback_events == nullptr) return false;
    // waitBits(clearOnExit=true) atomically observes and clears a pending
    // event. A producer that signals after the clear leaves its bit set for
    // the next Core-0 loop, so a concurrent overflow cannot be lost.
    return (xEventGroupWaitBits(tuning_callback_events,
                                TUNING_QUEUE_OVERFLOW_EVENT,
                                pdTRUE,
                                pdFALSE,
                                0) &
            TUNING_QUEUE_OVERFLOW_EVENT) != 0;
}

} // namespace mqtt
