#include "mqtt_client.h"
#include "config.h"
#include "wifi_manager.h"
#include "definitions.h"
#include "serial_mutex.h"
#include <ArduinoJson.h>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace mqtt
{
    MqttClient& MqttClient::getInstance()
    {
        static MqttClient instance;
        return instance;
    }

    void MqttClient::configurePubSubClient(const String& client_id)
    {
        if (!mqtt_client.setBufferSize(1024))
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: unable to allocate MQTT buffer.");
            }
            current_state = MqttState::DISCONNECTED;
            return;
        }

#ifndef UNIT_TEST
        wifi_client.setTimeout(2);
#endif

        mqtt_client.setKeepAlive(60);
        mqtt_client.setServer(config::network::MQTT_BROKER_VAL.c_str(), config::network::MQTT_PORT_VAL);
        mqtt_client.setCallback(MqttClient::handleMQTTCallback);
    }

    void MqttClient::initializeMutex()
    {
#ifndef UNIT_TEST
        if (mqtt_mutex == nullptr)
        {
            mqtt_mutex = xSemaphoreCreateMutex();
        }
#endif
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
        String client_id = getEffectiveClientId();

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
        configurePubSubClient(client_id);
        if (current_state == MqttState::DISCONNECTED)
        {
            return false;
        }

        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[MQTT] Broker: %s:%u | Client ID: %s | Buffer: 1024 | KeepAlive: 60s\n",
                          config::network::MQTT_BROKER_VAL.c_str(),
                          static_cast<unsigned>(config::network::MQTT_PORT_VAL),
                          client_id.c_str());
        }

        initializeMutex();

        current_state = MqttState::IDLE;
        return true;
    }

    void MqttClient::loop()
    {
        if (!checkWifiForMqtt())
        {
            return;
        }

        if (current_state == MqttState::ERROR_NO_CONFIG)
        {
            return;
        }

        maintainMqttConnection();
    }

    bool MqttClient::checkWifiForMqtt()
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

    void MqttClient::maintainMqttConnection()
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
                current_state = MqttState::DISCONNECTED;
                current_reconnect_interval = 2000; // Reset backoff interval on connection loss
            }

            unsigned long now = millis();
            if (now - last_reconnect_attempt >= current_reconnect_interval)
            {
                reconnectMqtt();
            }
        }
    }

    bool MqttClient::publishTelemetry(const String& payload)
    {
        if (!isConnected())
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

    bool MqttClient::publishStatus(bool is_online)
    {
        if (!isConnected())
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

    bool MqttClient::isConnected()
    {
        return mqtt_client.connected();
    }

    MqttState MqttClient::getState() const
    {
        return current_state;
    }

    const MqttTopics& MqttClient::getResolvedTopics() const
    {
        return resolved_topics;
    }

    void MqttClient::mqttCallbackStatic(char* topic, uint8_t* payload, unsigned int length)
    {
        // Route message to instance handler
        getInstance().handleMessage(topic, payload, length);
    }

    void MqttClient::handleMQTTCallback(char* topic, uint8_t* payload, unsigned int length)
    {
        getInstance().handleMessage(topic, payload, length);
    }

    bool MqttClient::validateIncomingMessage(const char* topic, const uint8_t* payload, unsigned int length)
    {
        if (topic == nullptr)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: Received message with null topic pointer.");
            }
            return false;
        }
        if (payload == nullptr && length > 0)
        {
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.println("[MQTT] Error: Received message with null payload pointer but non-zero length.");
            }
            return false;
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
            return false;
        }
        return true;
    }

    void MqttClient::routeSetpointMessage(StaticJsonDocument<768>& doc, bool is_command)
    {
        if (doc.containsKey("temperatureSetpoint") || doc.containsKey("humiditySetpoint") ||
            doc.containsKey("co2Setpoint") || doc.containsKey("temperature") ||
            doc.containsKey("humidity") || doc.containsKey("co2") ||
            doc.containsKey("clearHardwareOverride"))
        {
            processSetpoints(doc);
        }
        else if (!is_command)
        {
            processSetpoints(doc);
        }
    }

    void MqttClient::handleMessage(char* topic, uint8_t* payload, unsigned int length)
    {
        if (!validateIncomingMessage(topic, payload, length))
        {
            return;
        }

        StaticJsonDocument<768> doc;
        if (!parseJsonPayload(payload, length, doc))
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

        bool is_command = handleMqttCommand(doc);
        routeSetpointMessage(doc, is_command);
    }

    bool MqttClient::parseJsonPayload(uint8_t* payload, unsigned int length, StaticJsonDocument<768>& doc)
    {
        if (payload == nullptr && length > 0)
        {
            return false;
        }

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

    bool MqttClient::handleMqttCommand(StaticJsonDocument<768>& doc)
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
                setSharedForceFullPublish(true);
                is_command = true;
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] Command received: full_sync. Flag shared_forceFullPublish set to true.");
                }
            }
        }
        return is_command;
    }

    void MqttClient::processSetpoints(StaticJsonDocument<768>& doc)
    {
        if (doc.containsKey("clearHardwareOverride") && doc["clearHardwareOverride"].as<bool>())
        {
            storage::StorageManager::get_instance().clear_hardware_override();
            ControlSetpointCommand clearCmd = { NAN, NAN, NAN, false, {0, 0, 0} };
            if (xOverrideQueue != nullptr)
            {
                xQueueOverwrite(xOverrideQueue, &clearCmd);
                {
                    ScopedSerialLock guard(SerialLock::get_instance());
                    Serial.println("[MQTT] Cleared hardware override and queued clear command.");
                }
            }
        }

        parseAndPersistBaseline(doc);
    }

    void MqttClient::parseAndPersistBaseline(StaticJsonDocument<768>& doc)
    {
        bool has_temp = doc.containsKey("temperatureSetpoint") || doc.containsKey("temperature");
        bool has_humi = doc.containsKey("humiditySetpoint") || doc.containsKey("humidity");
        bool has_co2 = doc.containsKey("co2Setpoint") || doc.containsKey("co2");

        if (!has_temp && !has_humi && !has_co2)
        {
            return;
        }

        float val_temp = NAN;
        float val_humi = NAN;
        float val_co2 = NAN;
        bool valid = validateSetpointPayload(doc, val_temp, val_humi, val_co2);
        if (!valid)
        {
            return;
        }

        storage::BackendSetpointSnapshot snapshot;
        if (!storage::StorageManager::get_instance().load_backend_snapshot(snapshot) || !snapshot.valid)
        {
            snapshot.temp_target = 24.0f;
            snapshot.humidity_target = 90.0f;
            snapshot.co2_target = 1000.0f;
            snapshot.valid = true;
        }

        if (has_temp) snapshot.temp_target = val_temp;
        if (has_humi) snapshot.humidity_target = val_humi;
        if (has_co2) snapshot.co2_target = val_co2;
        snapshot.valid = true;

        if (!storage::StorageManager::get_instance().save_backend_snapshot(snapshot))
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[MQTT] Error: baseline persistence failed; retaining current runtime baseline.");
            return;
        }
        queueBaselineCommand(snapshot);
    }

    bool MqttClient::validateSetpointPayload(StaticJsonDocument<768>& doc, float& val_temp, float& val_humi, float& val_co2)
    {
        bool valid = true;
        if (doc.containsKey("temperatureSetpoint") || doc.containsKey("temperature"))
        {
            val_temp = doc.containsKey("temperatureSetpoint") ? doc["temperatureSetpoint"].as<float>() : doc["temperature"].as<float>();
            if (!validateSingleSetpoint("temperature", val_temp, 10.0f, 45.0f)) valid = false;
        }
        if (doc.containsKey("humiditySetpoint") || doc.containsKey("humidity"))
        {
            val_humi = doc.containsKey("humiditySetpoint") ? doc["humiditySetpoint"].as<float>() : doc["humidity"].as<float>();
            if (!validateSingleSetpoint("humidity", val_humi, 30.0f, 95.0f)) valid = false;
        }
        if (doc.containsKey("co2Setpoint") || doc.containsKey("co2"))
        {
            val_co2 = doc.containsKey("co2Setpoint") ? doc["co2Setpoint"].as<float>() : doc["co2"].as<float>();
            if (!validateSingleSetpoint("co2", val_co2, 400.0f, 10000.0f)) valid = false;
        }
        return valid;
    }

    void MqttClient::queueBaselineCommand(const storage::BackendSetpointSnapshot& snapshot)
    {
        ControlSetpointCommand baselineCmd;
        baselineCmd.temp_target = snapshot.temp_target;
        baselineCmd.humidity_target = snapshot.humidity_target;
        baselineCmd.co2_target = snapshot.co2_target;
        baselineCmd.active = true;
        memset(baselineCmd.padding, 0, sizeof(baselineCmd.padding));

        if (xBaselineQueue != nullptr)
        {
            xQueueOverwrite(xBaselineQueue, &baselineCmd);
            {
                ScopedSerialLock guard(SerialLock::get_instance());
                Serial.printf("[MQTT] Queued baseline (T:%.2f, H:%.2f, CO2:%.2f)\n",
                              baselineCmd.temp_target, baselineCmd.humidity_target, baselineCmd.co2_target);
            }
        }
    }


    bool MqttClient::validateSingleSetpoint(const char* name, float val, float min_val, float max_val)
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

    void MqttClient::reconnectMqtt()
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

        performMqttConnection();
        
        is_reconnecting = false;

#ifndef UNIT_TEST
        if (mqtt_mutex != nullptr)
        {
            xSemaphoreGive((SemaphoreHandle_t)mqtt_mutex);
        }
#endif
    }

    void MqttClient::handleMqttConnectionSuccess()
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
        publishStatus(true);
    }

    void MqttClient::handleMqttConnectionFailure()
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

    bool MqttClient::performMqttConnection()
    {
        {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[MQTT] Attempting connection to MQTT broker...");
        }

        String client_id = getEffectiveClientId();
        if (!validateConnectionConfig(client_id))
        {
            return false;
        }

        String lwt_topic;
        String lwt_payload;
        getLwtConfig(lwt_topic, lwt_payload);

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
            handleMqttConnectionSuccess();
        }
        else
        {
            handleMqttConnectionFailure();
        }
        return connected;
    }

    bool MqttClient::validateConnectionConfig(const String& client_id)
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

    void MqttClient::getLwtConfig(String& lwt_topic, String& lwt_payload)
    {
        lwt_topic = resolved_topics.status;
        lwt_payload = "{\"status\":\"offline\"}";
    }

    String MqttClient::getEffectiveClientId() const
    {
        String client_id = config::network::MQTT_CLIENT_ID_VAL;
        if (client_id.length() == 0)
        {
            client_id = "esp32_mushroom_default";
        }
        return client_id;
    }

    unsigned long MqttClient::getReconnectInterval() const
    {
        return current_reconnect_interval;
    }

} // namespace mqtt
