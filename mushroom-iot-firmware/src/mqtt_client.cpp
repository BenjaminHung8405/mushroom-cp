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
        mqtt_client.setCallback(MqttClient::handleMQTTCallback);

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
        if (mqtt_client.connected())
        {
            mqtt_client.loop();
            current_state = MqttState::CONNECTED;
            current_reconnect_interval = 2000; // Reset backoff interval on success
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
                current_reconnect_interval = 2000; // Reset backoff interval on connection loss
            }

            unsigned long now = millis();
            if (now - last_reconnect_attempt >= current_reconnect_interval)
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

    void MqttClient::handleMQTTCallback(char* topic, uint8_t* payload, unsigned int length)
    {
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

        StaticJsonDocument<768> doc;
        if (!parse_json_payload(payload, length, doc))
        {
            return;
        }

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[DEBUG] handle_message contains key 'cmd'? %d, addr=%p\n", doc.containsKey("cmd"), (void*)&doc);
            if (doc.containsKey("cmd")) {
                Serial.printf("[DEBUG] cmd raw: %s\n", doc["cmd"].as<String>().c_str());
                Serial.printf("[DEBUG] cmd isString? %d\n", doc["cmd"].is<const char*>());
            }
            String s;
            serializeJson(doc, s);
            Serial.printf("[DEBUG] handle_message doc serialized: %s\n", s.c_str());
        }

        bool is_command = handle_mqtt_command(doc);

        if (doc.containsKey("temperatureSetpoint") || doc.containsKey("humiditySetpoint") ||
            doc.containsKey("co2Setpoint") || doc.containsKey("temperature") ||
            doc.containsKey("humidity") || doc.containsKey("co2") ||
            doc.containsKey("thermal_shock_protection") || doc.containsKey("setpoint_ttl_sec"))
        {
            process_setpoints(doc);
        }
        else if (!is_command)
        {
            process_setpoints(doc);
        }
    }

    bool MqttClient::parse_json_payload(uint8_t* payload, unsigned int length, StaticJsonDocument<768>& doc)
    {
        constexpr unsigned int MAX_PAYLOAD_SIZE = 512;
        if (length > MAX_PAYLOAD_SIZE)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Error: Payload size (%u) exceeds maximum limit of %u bytes.\n", length, MAX_PAYLOAD_SIZE);
            }
            return false;
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

        const char* const_payload = safe_payload;
        DeserializationError error = deserializeJson(doc, const_payload);
        if (error)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] JSON Deserialization failed: %s\n", error.c_str());
            }
            return false;
        }
        return true;
    }

    bool MqttClient::handle_mqtt_command(StaticJsonDocument<768>& doc)
    {
        bool is_command = false;
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[DEBUG] handle_mqtt_command entered. contains cmd? %d, addr=%p\n", doc.containsKey("cmd"), (void*)&doc);
            if (doc.containsKey("cmd")) {
                const char* val = doc["cmd"].as<const char*>();
                Serial.printf("[DEBUG] cmd value inside: %s\n", val ? val : "null");
            }
            String s;
            serializeJson(doc, s);
            Serial.printf("[DEBUG] handle_mqtt_command doc serialized: %s\n", s.c_str());
        }
        if (doc.containsKey("cmd"))
        {
            const char* cmd_val = doc["cmd"].as<const char*>();
            if (cmd_val != nullptr && strcmp(cmd_val, "full_sync") == 0)
            {
                set_shared_force_full_publish(true);
                is_command = true;
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] Command received: full_sync. Flag shared_forceFullPublish set to true.");
                }
            }
        }
        return is_command;
    }

    void MqttClient::process_setpoints(StaticJsonDocument<768>& doc)
    {
        local_control::LocalSetpoints setpoints = local_control::get_active_setpoints();
        bool changed = false;

        extract_setpoints(doc, setpoints, changed);

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

    bool MqttClient::extract_setpoints(StaticJsonDocument<768>& doc, local_control::LocalSetpoints& setpoints, bool& changed)
    {
        constexpr float MIN_SAFE_TEMP = 10.0f;
        constexpr float MAX_SAFE_TEMP = 45.0f;
        constexpr float MIN_SAFE_HUMI = 30.0f;
        constexpr float MAX_SAFE_HUMI = 95.0f;
        constexpr float MIN_SAFE_CO2 = 400.0f;
        constexpr float MAX_SAFE_CO2 = 10000.0f;

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
        return changed;
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
        if (WiFi.status() != WL_CONNECTED || wifi_state != wifi::WifiState::STA_CONNECTED)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Reconnect aborted: WiFi status is not WL_CONNECTED (status=%d, state=%d).\n", 
                              (int)WiFi.status(), (int)wifi_state);
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

        String client_id = get_effective_client_id();
        if (!validate_connection_config(client_id))
        {
            return false;
        }

        String lwt_topic;
        String lwt_payload;
        get_lwt_config(lwt_topic, lwt_payload);

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
            current_reconnect_interval = 2000; // Reset backoff interval on success
            
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
            current_reconnect_interval = std::min(current_reconnect_interval * 2, 60000UL); // Double and limit to 60s
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Reconnect interval increased to %lu ms (exponential backoff).\n", current_reconnect_interval);
            }
        }
        return connected;
    }

    bool MqttClient::validate_connection_config(const String& client_id)
    {
        if (config::network::MQTT_PASSWORD_VAL.length() == 0)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Missing provisioned MQTT PSK. MQTT connection aborted.");
            }
            current_state = MqttState::DISCONNECTED;
            return false;
        }

        if (config::network::MQTT_USER_VAL != client_id)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Invalid identity: MQTT username must equal client/device ID.");
            }
            current_state = MqttState::ERROR_NO_CONFIG;
            return false;
        }
        return true;
    }

    void MqttClient::get_lwt_config(String& lwt_topic, String& lwt_payload)
    {
        lwt_topic = resolved_topics.status;
        lwt_payload = "{\"status\":\"offline\"}";
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

    unsigned long MqttClient::get_reconnect_interval() const
    {
        return current_reconnect_interval;
    }

} // namespace mqtt
