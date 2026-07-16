#include "protocols/mqtt_callbacks.h"
#include <cstring>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

namespace mqtt {

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
    xQueueSend(g_network_worker_queue, &msg, 0);
}

} // namespace mqtt
