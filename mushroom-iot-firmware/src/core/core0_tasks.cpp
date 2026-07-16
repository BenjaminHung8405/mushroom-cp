#include "core/system_manager.h"
#include "network/wifi_manager.h"
#include "network/mqtt_manager.h"
#include "network/ota_manager.h"
#include "core/serial_mutex.h"
#include "network/web_interface/web_interface.h"
#include "core/telemetry.h"
#include "protocols/mqtt_callbacks.h"
#include <ArduinoJson.h>
#include <cmath>

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <esp_task_wdt.h>
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

static void drainManualAckQueue()
{
    static bool has_pending_ack = false;
    static ManualAck pending_ack{};

    if (!has_pending_ack && g_manual_ack_queue != nullptr &&
        xQueueReceive(g_manual_ack_queue, &pending_ack, 0) == pdTRUE)
    {
        has_pending_ack = true;
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MANUAL] ch=%d requested=%d effective=%d decision=%d release=%d\n",
                          static_cast<int>(pending_ack.channel),
                          static_cast<int>(pending_ack.requested_intent),
                          static_cast<int>(pending_ack.effective_intent),
                          static_cast<int>(pending_ack.decision),
                          static_cast<int>(pending_ack.release_reason));
        }
        // This state reset must not wait for network recovery.
        if (pending_ack.release_reason != ManualReleaseReason::None) {
            cabinet_buttons::notify_latch_released(pending_ack.channel);
        }
    }

    if (has_pending_ack) {
        // Resolve the originating MQTT command only after Core 1 has made
        // its safety decision. This avoids reading a stale GPIO in the MQTT callback.
        mqtt::MqttManager::getInstance().resolveManualAck(pending_ack);

        if (mqtt::MqttManager::getInstance().isConnected() &&
            mqtt::MqttManager::getInstance().publishManualAck(pending_ack))
        {
            has_pending_ack = false;
        }
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
    (void)telemetryState;
    // V3: always publish full snapshots at the persisted provisioning interval.
    // Failed publishes are intentionally discarded; the next interval publishes current state.
    mqtt::MqttManager::getInstance().publishTelemetrySnapshot(last_known_telemetry, now);
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
    // Hiding periodic stack watermark prints to avoid serial console spam during connection testing
    /*
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
    */
}

static void delayCore0Task()
{
    // processWebServer() already yields once per communication cycle. Keeping
    // this task delay at zero avoids delaying DNS/HTTP and MQTT by 10-100 ms.
}

#ifndef UNIT_TEST
static TaskHandle_t hTaskNetworkWorker = nullptr;

void taskNetworkWorker(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE0_TASK] Starting background Network Queue Worker...");
    }

    esp_task_wdt_add(nullptr);

    mqtt::NetworkMessage msg;
    while (1)
    {
        if (xQueueReceive(mqtt::g_network_worker_queue, &msg, pdMS_TO_TICKS(100)) == pdTRUE)
        {
            mqtt::MqttManager::getInstance().processNetworkMessage(msg);
        }

        esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
#endif

void taskCore0Communication(void* /*pvParameters*/)
{
    {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[CORE0_TASK] Starting taskCore0Communication...");
    }


    // Initialize MQTT
    mqtt::MqttManager::getInstance().init();

    #ifndef UNIT_TEST
    xTaskCreatePinnedToCore(
        taskNetworkWorker,
        "net_worker_task",
        10240,
        NULL,
        1,
        &hTaskNetworkWorker,
        0
    );

    esp_task_wdt_init(8, true);  // Cấu hình ngưỡng WDT lên 8 giây, hard-reset nếu timeout
    esp_task_wdt_add(nullptr);   // Đăng ký task hiện tại (Core 0) với WDT daemon
    #endif

    static TelemetryData last_known_telemetry = {NAN, NAN, NAN, {false, false, false, false, false, false, {0, 0}}};
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
        mqtt::MqttManager::getInstance().loop();

        // 2b. In unit tests, drain the network queue synchronously
        #ifdef UNIT_TEST
        if (mqtt::g_network_worker_queue != nullptr)
        {
            mqtt::NetworkMessage msg;
            while (xQueueReceive(mqtt::g_network_worker_queue, &msg, 0) == pdTRUE)
            {
                mqtt::MqttManager::getInstance().processNetworkMessage(msg);
            }
        }
        #endif

        // 3. Maintain HTTP local Webserver based on WiFi state
        processWebServer();

        // 4. Drain telemetry queue from Core 1
        drainTelemetryQueue(last_known_telemetry);

        // 4b. Forward manual ACKs independently of the telemetry interval.
        // A pending ACK is retained locally until MQTT accepts it after reconnect.
        drainManualAckQueue();

        // 5. Publish after Core 1 has produced a final relay-state snapshot. This
        // is deliberately not driven by ManualAck: an ACK only confirms a request;
        // the protector may still change its final physical relay state.
        unsigned long now = millis();
        if (consumeSharedForceFullPublish())
        {
            mqtt::MqttManager::getInstance().publishTelemetrySnapshotNow(last_known_telemetry, now);
        }
        handleTelemetryScan(now, last_known_telemetry, telemetryState);

        // 6. Monitor Stack High Water Mark
        logStackWatermark(now);

        // 7. Yield and feed Watchdog
        #ifndef UNIT_TEST
        esp_task_wdt_reset();
        #endif
        delayCore0Task();
    }
}
