#include "message_dispatcher.h"
#include <cstring>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "Arduino.h"
#endif

namespace mqtt {
    QueueHandle_t g_network_worker_queue = nullptr;

    void MessageDispatcher::dispatch(char* topic, uint8_t* payload, unsigned int length) {
        if (topic == nullptr || g_network_worker_queue == nullptr) {
            return;
        }

        NetworkMessage msg;
        msg.type = CommandType::UNKNOWN;

        // 1. Quick topic classification
        if (strstr(topic, "/setpoint") != nullptr) {
            msg.type = CommandType::SETPOINT_UPDATE;
        } else if (strstr(topic, "/profile") != nullptr) {
            msg.type = CommandType::PROFILE_UPDATE;
        } else {
            return; // Ignore other topics immediately
        }

        // 2. Safe payload copy to static buffer
        unsigned int max_len = sizeof(msg.payload) - 1;
        unsigned int copy_len = (length > max_len) ? max_len : length;
        if (payload != nullptr && copy_len > 0) {
            memcpy(msg.payload, payload, copy_len);
        }
        msg.payload[copy_len] = '\0';

        // 3. Push to background queue without blocking (timeout = 0)
        xQueueSend(g_network_worker_queue, &msg, 0);
    }
}
