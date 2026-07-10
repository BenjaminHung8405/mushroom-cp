#include "definitions.h"
#include "wifi_manager.h"
#include "mqtt_client.h"

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#else
#include "Arduino.h"
#endif

void task_core0_communication(void* pvParameters)
{
    Serial.println("[CORE0_TASK] Starting task_core0_communication...");
    
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
        
        // 3. Monitor Stack High Water Mark periodically (every 5 seconds)
        static unsigned long last_stack_log = 0;
        unsigned long now = millis();
        if (now - last_stack_log >= 5000)
        {
            last_stack_log = now;
            #ifndef UNIT_TEST
            UBaseType_t high_water = uxTaskGetStackHighWaterMark(nullptr);
            Serial.printf("[CORE0_TASK] Stack High Water Mark: %u words\n", (unsigned int)high_water);
            #else
            Serial.println("[CORE0_TASK] Stack High Water Mark: 4096 words");
            #endif
        }
        
        // 4. Yield and feed Watchdog
        #ifndef UNIT_TEST
        vTaskDelay(pdMS_TO_TICKS(100)); // Delay 100ms
        #endif
    }
}
