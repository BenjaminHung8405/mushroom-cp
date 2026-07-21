#include "protocols/mqtt_callbacks.h"
#include <cstring>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

namespace mqtt {
namespace {

constexpr char TUNING_DESIRED_TOPIC_SUFFIX[] = "/down/tuning/desired";

bool isTuningDesiredTopic(const char* topic)
{
    if (topic == nullptr) {
        return false;
    }

    const size_t topic_length = strlen(topic);
    constexpr size_t suffix_length = sizeof(TUNING_DESIRED_TOPIC_SUFFIX) - 1;
    return topic_length >= suffix_length &&
           strcmp(topic + topic_length - suffix_length, TUNING_DESIRED_TOPIC_SUFFIX) == 0;
}

} // namespace

QueueHandle_t g_network_worker_queue = nullptr;

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
