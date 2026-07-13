#include "definitions.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "serial_mutex.h"
#include "WebInterface.h"
#include "Telemetry.h"
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

static void drainTelemetryQueue(TelemetryData& last_known_telemetry)
{
    TelemetryData tel;
    while (xTelemetryQueue != nullptr && xQueueReceive(xTelemetryQueue, &tel, 0) == pdTRUE)
    {
        last_known_telemetry = tel;
    }
}

static void processWebServer()
{
#ifndef UNIT_TEST
    auto state = wifi::get_wifi_state();
    if (state == wifi::WifiState::STA_CONNECTED)
    {
        web_interface::initServer();
        web_interface::handleClient();
    }
    else
    {
        web_interface::stopServer();
    }
#endif
    // CPU Yield Guard: Prevent Core 0 starvation by yielding to RTOS every cycle.
    vTaskDelay(pdMS_TO_TICKS(1));
}

void processTelemetryPublication(unsigned long now, const TelemetryData& last_known_telemetry, Telemetry::TelemetryState& telemetryState)
{
    mqtt::MqttClient& mqtt_client = mqtt::MqttClient::getInstance();
    if (mqtt_client.isConnected())
    {
        const bool consumed_force = consumeSharedForceFullPublish();
        if (consumed_force)
        {
            telemetryState.forceFullPublish = true;
        }

        const Telemetry::PublishType pubType =
            Telemetry::evaluateDeltaThresholds(last_known_telemetry, telemetryState, now);

        if (pubType != Telemetry::PublishType::NONE)
        {
            bool success = false;
            String json_payload = Telemetry::buildDeltaPayload(last_known_telemetry, telemetryState.lastPubState, pubType);

            if (json_payload.length() > 0)
            {
                if (mqtt_client.publishTelemetry(json_payload))
                {
                    Telemetry::commitSuccessfulPublish(
                        telemetryState, last_known_telemetry, now);
                    success = true;
                }
                else
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[CORE0_TASK] WARNING: Failed to publish delta telemetry.");
                }
            }

            if (!success && consumed_force)
            {
                setSharedForceFullPublish(true);
            }
        }
    }
}

static void handleTelemetryScan(unsigned long now, const TelemetryData& last_known_telemetry, Telemetry::TelemetryState& telemetryState)
{
    static unsigned long last_delta_scan = 0;
    if (now - last_delta_scan >= 5000)
    {
        last_delta_scan = now;
        processTelemetryPublication(now, last_known_telemetry, telemetryState);
    }
}

static void logStackWatermark(unsigned long now)
{
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
}

static void delayCore0Task()
{
    // processWebServer() already yields once per communication cycle. Keeping
    // this task delay at zero avoids delaying DNS/HTTP and MQTT by 10-100 ms.
}

void taskCore0Communication(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE0_TASK] Starting taskCore0Communication...");
    }


    // Initialize MQTT
    mqtt::MqttClient::getInstance().init();

    static TelemetryData last_known_telemetry = {NAN, NAN, NAN};
    static Telemetry::TelemetryState telemetryState = Telemetry::makeInitialState();

    #ifndef UNIT_TEST
    while (1)
    #else
    for (int i = 0; i < 1; ++i)
    #endif
    {
        // 1. Check WiFi connection status and handle reconnects (non-blocking)
        wifi::check_wifi_connection();

        // 2. Process MQTT loop (non-blocking)
        mqtt::MqttClient::getInstance().loop();

        // 3. Maintain HTTP local Webserver based on WiFi state
        processWebServer();

        // 4. Drain telemetry queue from Core 1
        drainTelemetryQueue(last_known_telemetry);

        // 5. Telemetry publication scan
        unsigned long now = millis();
        handleTelemetryScan(now, last_known_telemetry, telemetryState);

        // 6. Monitor Stack High Water Mark
        logStackWatermark(now);

        // 7. Yield and feed Watchdog
        delayCore0Task();
    }
}
