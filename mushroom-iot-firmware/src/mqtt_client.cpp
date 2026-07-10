#include "mqtt_client.h"
#include "config.h"
#include "wifi_manager.h"
#include <ArduinoJson.h>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace mqtt
{
    MqttClient& MqttClient::get_instance()
    {
        static MqttClient instance;
        return instance;
    }

    bool MqttClient::init()
    {
        Serial.println("[MQTT] Initializing MQTT client skeleton...");

        // 1. Validate MQTT Configuration
        if (config::network::MQTT_BROKER_VAL.length() == 0)
        {
            Serial.println("[MQTT] Error: MQTT broker address is empty.");
            current_state = MqttState::ERROR_NO_CONFIG;
            return false;
        }

        // 2. Resolve topics dynamically based on Client ID
        String client_id = get_effective_client_id();

        resolved_topics.status = "mushroom/device/" + client_id + "/status";
        resolved_topics.telemetry = "mushroom/device/" + client_id + "/telemetry";
        resolved_topics.setpoint = "mushroom/device/" + client_id + "/setpoint";

        Serial.printf("[MQTT] Resolved Topics:\n");
        Serial.printf("  - Status (LWT): %s\n", resolved_topics.status.c_str());
        Serial.printf("  - Telemetry:    %s\n", resolved_topics.telemetry.c_str());
        Serial.printf("  - Setpoint:     %s\n", resolved_topics.setpoint.c_str());

        // 3. Configure PubSubClient server and callback (to be fully integrated in C2/C3)
        mqtt_client.setServer(config::network::MQTT_BROKER_VAL.c_str(), config::network::MQTT_PORT_VAL);
        mqtt_client.setCallback(MqttClient::mqtt_callback_static);

#ifndef UNIT_TEST
        if (mqtt_mutex == nullptr)
        {
            mqtt_mutex = xSemaphoreCreateMutex();
        }
#endif

        current_state = MqttState::IDLE;
        return true;
    }

    void MqttClient::loop()
    {
        if (!check_wifi_for_mqtt())
        {
            return;
        }

        if (current_state == MqttState::ERROR_NO_CONFIG)
        {
            return;
        }

        maintain_mqtt_connection();
    }

    bool MqttClient::check_wifi_for_mqtt()
    {
        wifi::WifiState wifi_state = wifi::get_wifi_state();
        
        if (wifi_state != wifi::WifiState::STA_CONNECTED)
        {
            if (current_state != MqttState::ERROR_NO_WIFI)
            {
                Serial.printf("[MQTT] WiFi is not connected (State: %d). Suspending MQTT connection.\n", (int)wifi_state);
                current_state = MqttState::ERROR_NO_WIFI;
                if (mqtt_client.connected())
                {
                    mqtt_client.disconnect();
                }
            }
            return false;
        }

        if (current_state == MqttState::ERROR_NO_WIFI)
        {
            Serial.println("[MQTT] WiFi restored. MQTT client back to DISCONNECTED state.");
            current_state = MqttState::DISCONNECTED;
        }
        return true;
    }

    void MqttClient::maintain_mqtt_connection()
    {
        constexpr unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

        if (mqtt_client.connected())
        {
            mqtt_client.loop();
            current_state = MqttState::CONNECTED;
        }
        else
        {
            if (current_state == MqttState::CONNECTED)
            {
                Serial.println("[MQTT] Connection lost. Transitioning to DISCONNECTED.");
                current_state = MqttState::DISCONNECTED;
            }

            unsigned long now = millis();
            if (now - last_reconnect_attempt >= MQTT_RECONNECT_INTERVAL_MS)
            {
                reconnect_mqtt();
            }
        }
    }

    bool MqttClient::publish_telemetry(const String& payload)
    {
        if (!is_connected())
        {
            Serial.println("[MQTT] Cannot publish telemetry: Client not connected.");
            return false;
        }

        Serial.printf("[MQTT] Telemetry publish placeholder (Topic: %s, Payload: %s)\n",
                      resolved_topics.telemetry.c_str(), payload.c_str());
                      
        return mqtt_client.publish(resolved_topics.telemetry.c_str(), payload.c_str());
    }

    bool MqttClient::publish_status(bool is_online)
    {
        if (!is_connected())
        {
            Serial.println("[MQTT] Cannot publish status: Client not connected.");
            return false;
        }

        String payload = is_online ? "{\"status\":\"online\"}" : "{\"status\":\"offline\"}";
        Serial.printf("[MQTT] Status publish placeholder (Topic: %s, Payload: %s)\n",
                      resolved_topics.status.c_str(), payload.c_str());

        return mqtt_client.publish(resolved_topics.status.c_str(), (const uint8_t*)payload.c_str(), payload.length(), true);
    }

    bool MqttClient::is_connected()
    {
        return mqtt_client.connected();
    }

    MqttState MqttClient::get_state() const
    {
        return current_state;
    }

    const MqttTopics& MqttClient::get_resolved_topics() const
    {
        return resolved_topics;
    }

    void MqttClient::mqtt_callback_static(char* topic, uint8_t* payload, unsigned int length)
    {
        // Route message to instance handler
        get_instance().handle_message(topic, payload, length);
    }

    void MqttClient::handle_message(char* topic, uint8_t* payload, unsigned int length)
    {
        // 1. Sanity Check / Null Pointer Safeguards
        if (topic == nullptr)
        {
            Serial.println("[MQTT] Error: Received message with null topic pointer.");
            return;
        }
        if (payload == nullptr && length > 0)
        {
            Serial.println("[MQTT] Error: Received message with null payload pointer but non-zero length.");
            return;
        }

        Serial.printf("[MQTT] Received message on topic: %s. Length: %u\n", topic, length);

        if (resolved_topics.setpoint != topic)
        {
            Serial.println("[MQTT] Warning: Received message on unexpected topic.");
            return;
        }

        constexpr unsigned int MAX_PAYLOAD_SIZE = 512;
        if (length > MAX_PAYLOAD_SIZE)
        {
            Serial.printf("[MQTT] Error: Payload size (%u) exceeds maximum limit of %u bytes.\n", length, MAX_PAYLOAD_SIZE);
            return;
        }

        char safe_payload[MAX_PAYLOAD_SIZE + 1];
        if (length > 0)
        {
            memcpy(safe_payload, payload, length);
        }
        safe_payload[length] = '\0';
        Serial.printf("[MQTT] Raw payload: %s\n", safe_payload);

        // Tăng dung lượng StaticJsonDocument lên 768 bytes để tránh tràn RAM overhead khi parse
        StaticJsonDocument<768> doc;
        DeserializationError error = deserializeJson(doc, safe_payload);

        if (error)
        {
            Serial.printf("[MQTT] JSON Deserialization failed: %s\n", error.c_str());
            return;
        }

        process_setpoints(doc);
    }

    void MqttClient::process_setpoints(const StaticJsonDocument<768>& doc)
    {
        bool has_valid_setpoint = false;

        // Bổ sung ngưỡng validate vật lý (Physical Safety Boundaries Check)
        constexpr float MIN_SAFE_TEMP = 10.0f;
        constexpr float MAX_SAFE_TEMP = 45.0f;
        constexpr float MIN_SAFE_HUMI = 30.0f;
        constexpr float MAX_SAFE_HUMI = 95.0f;

        // Kiểm tra và validate setpoint nhiệt độ
        float temp_sp = -999.0f;
        if (doc.containsKey("temperatureSetpoint")) {
            temp_sp = doc["temperatureSetpoint"].as<float>();
        } else if (doc.containsKey("temperature")) {
            temp_sp = doc["temperature"].as<float>();
        }

        if (temp_sp != -999.0f) {
            if (temp_sp >= MIN_SAFE_TEMP && temp_sp <= MAX_SAFE_TEMP && !isnan(temp_sp)) {
                Serial.printf("[MQTT] Parse & Validate Setpoint: temperature = %.2f (SAFE)\n", temp_sp);
                has_valid_setpoint = true;
            } else {
                Serial.printf("[MQTT] Error: temperature setpoint %.2f out of safe range [%.1f, %.1f]\n", 
                              temp_sp, MIN_SAFE_TEMP, MAX_SAFE_TEMP);
            }
        }

        // Kiểm tra và validate setpoint độ ẩm
        float humi_sp = -999.0f;
        if (doc.containsKey("humiditySetpoint")) {
            humi_sp = doc["humiditySetpoint"].as<float>();
        } else if (doc.containsKey("humidity")) {
            humi_sp = doc["humidity"].as<float>();
        }

        if (humi_sp != -999.0f) {
            if (humi_sp >= MIN_SAFE_HUMI && humi_sp <= MAX_SAFE_HUMI && !isnan(humi_sp)) {
                Serial.printf("[MQTT] Parse & Validate Setpoint: humidity = %.2f (SAFE)\n", humi_sp);
                has_valid_setpoint = true;
            } else {
                Serial.printf("[MQTT] Error: humidity setpoint %.2f out of safe range [%.1f, %.1f]\n", 
                              humi_sp, MIN_SAFE_HUMI, MAX_SAFE_HUMI);
            }
        }

        if (!has_valid_setpoint)
        {
            Serial.println("[MQTT] Warning: JSON payload does not contain any valid/safe setpoint values.");
        }
    }

    void MqttClient::reconnect_mqtt()
    {
        // 1. Safeguard against calling reconnect when WiFi is not ready or SoftAP mode is active
        wifi::WifiState wifi_state = wifi::get_wifi_state();
        if (wifi_state != wifi::WifiState::STA_CONNECTED)
        {
            Serial.println("[MQTT] Reconnect aborted: WiFi is not STA_CONNECTED.");
            current_state = MqttState::ERROR_NO_WIFI;
            return;
        }

        if (is_reconnecting) return;

        // 2. Lock Mutex to prevent concurrent connection attempts across tasks
#ifndef UNIT_TEST
        if (mqtt_mutex != nullptr)
        {
            if (xSemaphoreTake((SemaphoreHandle_t)mqtt_mutex, 0) != pdTRUE)
            {
                Serial.println("[MQTT] Reconnect skipped: mutex locked by another process.");
                return;
            }
        }
#endif
        
        is_reconnecting = true;
        last_reconnect_attempt = millis();

        perform_mqtt_connection();
        
        is_reconnecting = false;

#ifndef UNIT_TEST
        if (mqtt_mutex != nullptr)
        {
            xSemaphoreGive((SemaphoreHandle_t)mqtt_mutex);
        }
#endif
    }

    bool MqttClient::perform_mqtt_connection()
    {
        Serial.println("[MQTT] Attempting connection to MQTT broker...");
        
        String client_id = get_effective_client_id();
        
        // Define Last Will and Testament (LWT) status offline payload
        String lwt_topic = resolved_topics.status;
        String lwt_payload = "{\"status\":\"offline\"}";
        
        bool connected = mqtt_client.connect(
            client_id.c_str(),
            config::network::MQTT_USER_VAL.c_str(),
            config::network::MQTT_PASSWORD_VAL.c_str(),
            lwt_topic.c_str(),
            1, // QoS
            true, // Retain
            lwt_payload.c_str()
        );
        
        if (connected)
        {
            Serial.println("[MQTT] Connected to broker successfully.");
            current_state = MqttState::CONNECTED;
            
            // Subscribe to the incoming control setpoint commands
            mqtt_client.subscribe(resolved_topics.setpoint.c_str(), 1);
            Serial.printf("[MQTT] Subscribed to topic: %s\n", resolved_topics.setpoint.c_str());
            
            // Publish online status
            publish_status(true);
        }
        else
        {
            Serial.println("[MQTT] Connection to broker failed. Will retry later.");
            current_state = MqttState::DISCONNECTED;
        }
        return connected;
    }

    String MqttClient::get_effective_client_id() const
    {
        String client_id = config::network::MQTT_CLIENT_ID_VAL;
        if (client_id.length() == 0)
        {
            client_id = "esp32_mushroom_default";
        }
        return client_id;
    }

} // namespace mqtt
