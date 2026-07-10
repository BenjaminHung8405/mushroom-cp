#include "definitions.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "serial_mutex.h"
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

        // 3. Drain telemetry queue from Core 1 and publish to MQTT
        {
            mqtt::MqttClient& mqtt_client = mqtt::MqttClient::get_instance();
            TelemetryData tel;
            if (mqtt_client.is_connected() &&
                xTelemetryQueue != nullptr &&
                xQueueReceive(xTelemetryQueue, &tel, 0) == pdTRUE)
            {
                StaticJsonDocument<256> doc;
                if (!std::isnan(tel.temp_air)) {
                    doc["temp_air"] = tel.temp_air;
                    doc["temperature"] = tel.temp_air;
                }
                if (!std::isnan(tel.humidity_air)) {
                    doc["humidity_air"] = tel.humidity_air;
                    doc["humidity"] = tel.humidity_air;
                }
                if (!std::isnan(tel.temp_substrate)) {
                    doc["substrate_temperature"] = tel.temp_substrate;
                }
                if (!std::isnan(tel.co2_level)) {
                    doc["co2_level"] = tel.co2_level;
                    doc["co2"] = tel.co2_level;
                }

                String payload;
                serializeJson(doc, payload);

                bool ok = mqtt_client.publish_telemetry(payload);
                if (!ok)
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[CORE0_TASK] WARNING: Failed to publish telemetry.");
                }
            }
        }

        // 4. Monitor Stack High Water Mark periodically (every 5 seconds)
        static unsigned long last_stack_log = 0;
        unsigned long now = millis();
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

        // 5. Yield and feed Watchdog
        #ifndef UNIT_TEST
        vTaskDelay(pdMS_TO_TICKS(100)); // Delay 100ms
        #endif
    }
}
