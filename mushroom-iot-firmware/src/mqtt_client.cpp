#include "mqtt_client.h"
#include "config.h"
#include "wifi_manager.h"
#include "definitions.h"
#include "local_control.h"
#include "serial_mutex.h"
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
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[MQTT] Initializing MQTT client skeleton...");
        }

        // 1. Validate MQTT Configuration
        if (config::network::MQTT_BROKER_VAL.length() == 0)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: MQTT broker address is empty.");
            }
            current_state = MqttState::ERROR_NO_CONFIG;
            return false;
        }

        // 2. Resolve topics dynamically based on Client ID
        String client_id = get_effective_client_id();

        resolved_topics.status = "mushroom/device/" + client_id + "/status";
        resolved_topics.telemetry = "mushroom/device/" + client_id + "/telemetry";
        resolved_topics.setpoint = "mushroom/device/" + client_id + "/setpoint";

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Resolved Topics:\n");
            Serial.printf("  - Status (LWT): %s\n", resolved_topics.status.c_str());
            Serial.printf("  - Telemetry:    %s\n", resolved_topics.telemetry.c_str());
            Serial.printf("  - Setpoint:     %s\n", resolved_topics.setpoint.c_str());
        }

        // 3. Configure PubSubClient server, buffer, keepalive, and callback.
        // Buffer must exceed JWT/password + LWT + telemetry JSON size (default 128 is too small).
        if (!mqtt_client.setBufferSize(1024))
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: unable to allocate MQTT buffer.");
            }
            current_state = MqttState::DISCONNECTED;
            return false;
        }
        
        // Cấu hình TCP timeout 2s tránh bị treo WiFiClient lâu hơn TWDT (5s)
#ifndef UNIT_TEST
        wifi_client.setTimeout(2);
#endif
        
        mqtt_client.setKeepAlive(60);
        mqtt_client.setServer(config::network::MQTT_BROKER_VAL.c_str(), config::network::MQTT_PORT_VAL);
        mqtt_client.setCallback(MqttClient::mqtt_callback_static);

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Broker: %s:%u | Client ID: %s | Buffer: 1024 | KeepAlive: 60s\n",
                          config::network::MQTT_BROKER_VAL.c_str(),
                          static_cast<unsigned>(config::network::MQTT_PORT_VAL),
                          client_id.c_str());
        }

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
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.printf("[MQTT] WiFi is not connected (State: %d). Suspending MQTT connection.\n", (int)wifi_state);
                }
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
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] WiFi restored. MQTT client back to DISCONNECTED state.");
            }
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
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] Connection lost. Transitioning to DISCONNECTED.");
                }
                local_control::on_backend_link_lost();
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
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Cannot publish telemetry: Client not connected.");
            }
            return false;
        }

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Telemetry publish placeholder (Topic: %s, Payload: %s)\n",
                          resolved_topics.telemetry.c_str(), payload.c_str());
        }
                      
        return mqtt_client.publish(resolved_topics.telemetry.c_str(), payload.c_str());
    }

    bool MqttClient::publish_status(bool is_online)
    {
        if (!is_connected())
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Cannot publish status: Client not connected.");
            }
            return false;
        }

        String payload = is_online ? "{\"status\":\"online\"}" : "{\"status\":\"offline\"}";
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Status publish placeholder (Topic: %s, Payload: %s)\n",
                          resolved_topics.status.c_str(), payload.c_str());
        }

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
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: Received message with null topic pointer.");
            }
            return;
        }
        if (payload == nullptr && length > 0)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: Received message with null payload pointer but non-zero length.");
            }
            return;
        }

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Received message on topic: %s. Length: %u\n", topic, length);
        }

        if (resolved_topics.setpoint != topic)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Warning: Received message on unexpected topic.");
            }
            return;
        }

        constexpr unsigned int MAX_PAYLOAD_SIZE = 512;
        if (length > MAX_PAYLOAD_SIZE)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Error: Payload size (%u) exceeds maximum limit of %u bytes.\n", length, MAX_PAYLOAD_SIZE);
            }
            return;
        }

        char safe_payload[MAX_PAYLOAD_SIZE + 1];
        if (length > 0)
        {
            memcpy(safe_payload, payload, length);
        }
        safe_payload[length] = '\0';
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Raw payload: %s\n", safe_payload);
        }

        // Tăng dung lượng StaticJsonDocument lên 768 bytes để tránh tràn RAM overhead khi parse
        StaticJsonDocument<768> doc;
        DeserializationError error = deserializeJson(doc, safe_payload);

        if (error)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] JSON Deserialization failed: %s\n", error.c_str());
            }
            return;
        }

        process_setpoints(doc);
    }

    void MqttClient::process_setpoints(const StaticJsonDocument<768>& doc)
    {
        // Backend provides advisory targets. Core 1 computes every relay state locally
        // so a missed MQTT OFF packet cannot leave mist/heater latched indefinitely.
        constexpr float MIN_SAFE_TEMP = 10.0f;
        constexpr float MAX_SAFE_TEMP = 45.0f;
        constexpr float MIN_SAFE_HUMI = 30.0f;
        constexpr float MAX_SAFE_HUMI = 95.0f;
        constexpr float MIN_SAFE_CO2 = 400.0f;
        constexpr float MAX_SAFE_CO2 = 10000.0f;

        local_control::LocalSetpoints setpoints = local_control::get_active_setpoints();
        bool changed = false;

        if (doc.containsKey("temperatureSetpoint"))
        {
            float value = doc["temperatureSetpoint"].as<float>();
            if (validate_single_setpoint("temperature", value, MIN_SAFE_TEMP, MAX_SAFE_TEMP))
            {
                setpoints.temperature_setpoint = value;
                changed = true;
            }
        }
        if (doc.containsKey("humiditySetpoint"))
        {
            float value = doc["humiditySetpoint"].as<float>();
            if (validate_single_setpoint("humidity", value, MIN_SAFE_HUMI, MAX_SAFE_HUMI))
            {
                setpoints.humidity_setpoint = value;
                changed = true;
            }
        }
        if (doc.containsKey("co2Setpoint"))
        {
            float value = doc["co2Setpoint"].as<float>();
            if (validate_single_setpoint("co2", value, MIN_SAFE_CO2, MAX_SAFE_CO2))
            {
                setpoints.co2_setpoint = value;
                changed = true;
            }
        }
        if (doc.containsKey("thermal_shock_protection"))
        {
            setpoints.thermal_shock_protection = doc["thermal_shock_protection"].as<bool>();
            changed = true;
        }
        if (doc.containsKey("setpoint_ttl_sec"))
        {
            uint32_t ttl_sec = doc["setpoint_ttl_sec"].as<uint32_t>();
            if (ttl_sec >= 30 && ttl_sec <= 3600)
            {
                setpoints.setpoint_ttl_ms = ttl_sec * 1000UL;
                changed = true;
            }
        }

        if (changed)
        {
            setpoints.received_at_ms = millis();
            setpoints.valid = true;
            local_control::update_setpoints(setpoints);
        }
        else if (doc.containsKey("mist_generator_active") ||
                 doc.containsKey("convection_fan_active") ||
                 doc.containsKey("heating_lamp_active"))
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Ignoring raw actuator command: Edge hysteresis owns relay safety.");
            }
        }
        else
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Warning: payload contains no valid advisory setpoints.");
            }
        }
    }


    bool MqttClient::validate_single_setpoint(const char* name, float val, float min_val, float max_val)
    {
        if (!isnan(val) && val >= min_val && val <= max_val) {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Parse & Validate Setpoint: %s = %.2f (SAFE)\n", name, val);
            }
            return true;
        }
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Error: %s setpoint %.2f out of safe range [%.1f, %.1f]\n",
                          name, val, min_val, max_val);
        }
        return false;
    }

    void MqttClient::reconnect_mqtt()
    {
        // 1. Safeguard against calling reconnect when WiFi is not ready or SoftAP mode is active
        wifi::WifiState wifi_state = wifi::get_wifi_state();
        if (wifi_state != wifi::WifiState::STA_CONNECTED)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Reconnect aborted: WiFi is not STA_CONNECTED.");
            }
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
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] Reconnect skipped: mutex locked by another process.");
                }
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
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[MQTT] Attempting connection to MQTT broker...");
        }

        if (config::network::MQTT_PASSWORD_VAL.length() == 0)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Missing provisioned MQTT PSK. MQTT connection aborted.");
            }
            current_state = MqttState::DISCONNECTED;
            return false;
        }

        String client_id = get_effective_client_id();
        if (config::network::MQTT_USER_VAL != client_id)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Invalid identity: MQTT username must equal client/device ID.");
            }
            current_state = MqttState::ERROR_NO_CONFIG;
            return false;
        }

        // Define Last Will and Testament (LWT) status offline payload
        String lwt_topic = resolved_topics.status;
        String lwt_payload = "{\"status\":\"offline\"}";

        // Never log JWT/password. State codes: 0=MQTT_CONNECTED, 4=MQTT_CONNECT_UNAUTHORIZED.
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Connect context: broker=%s:%u user=%s clientId=%s lwt=%s\n",
                          config::network::MQTT_BROKER_VAL.c_str(),
                          static_cast<unsigned>(config::network::MQTT_PORT_VAL),
                          config::network::MQTT_USER_VAL.c_str(),
                          client_id.c_str(),
                          lwt_topic.c_str());
        }

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
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Connected to broker successfully.");
            }
            current_state = MqttState::CONNECTED;
            
            // Subscribe to the incoming control setpoint commands
            mqtt_client.subscribe(resolved_topics.setpoint.c_str(), 1);
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Subscribed to topic: %s\n", resolved_topics.setpoint.c_str());
            }
            
            // Publish online status
            publish_status(true);
        }
        else
        {
            const int mqtt_state = mqtt_client.state();
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Connection to broker failed (state=%d). Will retry later.\n", mqtt_state);
            }
            if (mqtt_state == 4)
            {
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] state=4 means MQTT_CONNECT_UNAUTHORIZED. Check EMQX credentials/token provisioning.");
                }
            }
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
