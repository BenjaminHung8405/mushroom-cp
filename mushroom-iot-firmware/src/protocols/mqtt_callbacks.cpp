#include "protocols/mqtt_callbacks.h"
#include <cstring>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

namespace mqtt {
namespace {

constexpr size_t MAX_TUNING_DESIRED_TOPIC_BYTES = 160;
char expected_tuning_desired_topic[MAX_TUNING_DESIRED_TOPIC_BYTES]{};
size_t expected_tuning_desired_topic_length = 0;

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

    memcpy(expected_tuning_desired_topic, topic, length);
    expected_tuning_desired_topic[length] = '\0';
    expected_tuning_desired_topic_length = length;
    return true;
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
            Serial.printf("[MQTT] Rejected tuning command payload too large (%u bytes, max %u).\n",
                          length,
                          static_cast<unsigned>(MAX_TUNING_DESIRED_PAYLOAD_BYTES));
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
    xQueueSend(g_network_worker_queue, &msg, 0);
}

} // namespace mqtt
