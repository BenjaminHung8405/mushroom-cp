#include "definitions.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "serial_mutex.h"
#include "WebInterface.h"
#include "Telemetry.h"
#include "CryptoUtils.h"
#include <ArduinoJson.h>
#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#else
#include "Arduino.h"
#endif

void task_core0_communication(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE0_TASK] Starting task_core0_communication...");
    }

    // Initialize WiFi
    wifi::init_wifi();

    // Initialize MQTT
    mqtt::MqttClient::get_instance().init();

    #ifndef UNIT_TEST
    while (1)
    #else
    // For unit testing, run the loop once to prevent hanging the test suite
    for (int i = 0; i < 1; ++i)
    #endif
    {
        // 1. Check WiFi connection status and handle reconnects (non-blocking)
        wifi::check_wifi_connection();

        // 2. Process MQTT loop (non-blocking)
        mqtt::MqttClient::get_instance().loop();

        // 3. Maintain HTTP local Webserver based on WiFi state
        #ifndef UNIT_TEST
        if (wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED)
        {
            web_interface::init_server();
            web_interface::handle_client();
        }
        else
        {
            web_interface::stop_server();
        }
        #endif

        // 4. Drain telemetry queue from Core 1 to keep it clean and non-blocking
        static TelemetryData last_known_telemetry = {NAN, NAN, NAN};
        TelemetryData tel;
        while (xTelemetryQueue != nullptr && xQueueReceive(xTelemetryQueue, &tel, 0) == pdTRUE)
        {
            last_known_telemetry = tel;
        }

        // 5. Chu kỳ quét delta telemetry mỗi 5000ms (non-blocking)
        static unsigned long last_delta_scan = 0;
        static Telemetry::TelemetryState telemetryState = Telemetry::makeInitialState();
        unsigned long now = millis();

        if (now - last_delta_scan >= 5000)
        {
            last_delta_scan = now;
            mqtt::MqttClient& mqtt_client = mqtt::MqttClient::get_instance();
            if (mqtt_client.is_connected())
            {
                // Đồng bộ cờ force_full_publish từ MQTT callback nhận lệnh full_sync
                if (get_shared_force_full_publish())
                {
                    telemetryState.forceFullPublish = true;
                    set_shared_force_full_publish(false);
                }

                // Đánh giá ngưỡng delta biến đổi dữ liệu
                Telemetry::PublishType pubType = Telemetry::evaluateDeltaThresholds(last_known_telemetry, telemetryState, now);

                if (pubType != Telemetry::PublishType::NONE)
                {
                    // Tạo payload chỉ chứa các trường thay đổi (hoặc full payload nếu FULL)
                    String json_payload = Telemetry::buildDeltaPayload(last_known_telemetry, telemetryState.lastPubState, pubType);

                    if (json_payload.length() > 0)
                    {
                        // SPRINT 2 Rule 3: Mã hóa Base64 trước khi đẩy lên MQTT broker để bảo mật truyền thông
                        String base64_payload = CryptoUtils::encodeBase64String(json_payload);

                        bool ok = mqtt_client.publish_telemetry(base64_payload);
                        if (!ok)
                        {
                            ScopedSerialLock guard(SerialLock::get_instance());
                            Serial.println("[CORE0_TASK] WARNING: Failed to publish delta telemetry.");
                        }
                    }
                }
            }
        }

        // 6. Monitor Stack High Water Mark periodically (every 5 seconds)
        static unsigned long last_stack_log = 0;
        if (now - last_stack_log >= 5000)
        {
            last_stack_log = now;
            ScopedSerialLock guard(SerialLock::get_instance());
            #ifndef UNIT_TEST
            UBaseType_t high_water = uxTaskGetStackHighWaterMark(nullptr);
            Serial.printf("[CORE0_TASK] Stack High Water Mark: %u words\n",
                          static_cast<unsigned int>(high_water));
            #else
            Serial.println("[CORE0_TASK] Stack High Water Mark: 4096 words");
            #endif
        }

        // 7. Yield and feed Watchdog
        #ifndef UNIT_TEST
        // SoftAP captive portal needs tighter HTTP/DNS polling so phones don't
        // drop the association while the user is typing the WiFi password.
        if (wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE) {
            vTaskDelay(pdMS_TO_TICKS(10));
        } else {
            vTaskDelay(pdMS_TO_TICKS(100));
        }
        #endif
    }
}
