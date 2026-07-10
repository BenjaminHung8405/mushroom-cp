#include "mqtt_client.h"
#include "config.h"
#include "wifi_manager.h"

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
        String client_id = config::network::MQTT_CLIENT_ID_VAL;
        if (client_id.length() == 0)
        {
            // Fallback default client id if empty
            client_id = "esp32_mushroom_default";
        }

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

        current_state = MqttState::IDLE;
        return true;
    }

    void MqttClient::loop()
    {
        // Skeleton implementation of loop (to be expanded in C2)
        // Check WiFi state first before running MQTT loop
        wifi::WifiState wifi_state = wifi::get_wifi_state();
        
        if (wifi_state != wifi::WifiState::STA_CONNECTED)
        {
            current_state = MqttState::ERROR_NO_WIFI;
            return;
        }

        // If WiFi is connected and we are in error state, transition back to idle/disconnected
        if (current_state == MqttState::ERROR_NO_WIFI)
        {
            current_state = MqttState::DISCONNECTED;
        }

        if (mqtt_client.connected())
        {
            mqtt_client.loop();
            current_state = MqttState::CONNECTED;
        }
        else
        {
            reconnect_mqtt();
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
        Serial.printf("[MQTT] Received message on topic: %s. Length: %u\n", topic, length);
        // Skeleton parsing/handler (to be fully implemented in C3)
    }

    void MqttClient::reconnect_mqtt()
    {
        if (is_reconnecting) return;
        
        is_reconnecting = true;
        Serial.println("[MQTT] Attempting connection to MQTT broker...");
        
        String client_id = config::network::MQTT_CLIENT_ID_VAL;
        if (client_id.length() == 0)
        {
            client_id = "esp32_mushroom_default";
        }
        
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
            Serial.println("[MQTT] Connection to broker failed.");
            current_state = MqttState::DISCONNECTED;
        }
        
        is_reconnecting = false;
    }

} // namespace mqtt
