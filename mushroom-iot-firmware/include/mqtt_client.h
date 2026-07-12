#pragma once

#include <Arduino.h>

#ifndef UNIT_TEST
#include <WiFi.h>
#include <PubSubClient.h>
#endif

#include <ArduinoJson.h>

namespace mqtt
{
    /**
     * @brief MQTT Client Connection and Configuration States.
     */
    enum class MqttState
    {
        IDLE,               ///< Initial state before setup
        CONNECTING,         ///< Attempting to connect to the broker
        CONNECTED,          ///< Connected successfully and subscribed to topics
        DISCONNECTED,       ///< Disconnected from the broker
        ERROR_NO_WIFI,      ///< Cannot connect because WiFi is offline/SoftAP active
        ERROR_NO_CONFIG     ///< Invalid or missing MQTT configuration parameters
    };

    /**
     * @brief Structure to group resolved MQTT topics clearly by function.
     * Includes both outgoing (publish) and incoming (subscribe) topics.
     */
    struct MqttTopics
    {
        // --- Outgoing / Publish Topics ---
        String status;      ///< Topic to publish online/offline status (retained LWT)
        String telemetry;   ///< Topic to publish telemetry data (sensors & actuator states)
        
        // --- Incoming / Subscribe Topics ---
        String setpoint;    ///< Topic to subscribe for incoming control setpoint commands
    };

    /**
     * @brief MQTT Client manager implemented as a Singleton.
     * Manages connection state, reconnect timers, subscription, and message parsing.
     */
    class MqttClient
    {
    public:
        /**
         * @brief Access the Singleton instance of the MQTT client.
         */
        static MqttClient& get_instance();

        // Prevent copying and assignment
        MqttClient(const MqttClient&) = delete;
        MqttClient& operator=(const MqttClient&) = delete;

        /**
         * @brief Initialize the MQTT client setup.
         * Resolves the topic names, sets up the server credentials, and hooks callback function.
         * @return true if initialization succeeded, false if NVS config is missing.
         */
        bool init();

        /**
         * @brief Non-blocking loop method to maintain connection and handle packet processing.
         * Should be called periodically in the main loop of Core 0 Task.
         */
        void loop();

        /**
         * @brief Publishes telemetry data to the resolved telemetry topic.
         * @param payload JSON formatted telemetry payload string.
         * @return true if publish request was sent to client buffer.
         */
        bool publish_telemetry(const String& payload);

        /**
         * @brief Publishes online/offline status to the resolved status topic.
         * @param is_online true for "online" state, false for "offline" state.
         * @return true if publication succeeded.
         */
        bool publish_status(bool is_online);

        /**
         * @brief Checks if the client is currently connected to the broker.
         */
        bool is_connected();

        /**
         * @brief Gets the current client state.
         */
        MqttState get_state() const;

        /**
         * @brief Returns the resolved topics struct containing runtime topic names.
         */
        const MqttTopics& get_resolved_topics() const;

        /**
         * @brief Returns the current reconnect interval (for unit testing backoff).
         */
        unsigned long get_reconnect_interval() const;

    private:
        MqttClient() = default;
        ~MqttClient() = default;

        /**
         * @brief Static wrapper callback hook registered into PubSubClient.
         */
        static void mqtt_callback_static(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Static callback hook that handles incoming MQTT messages.
         */
        static void handleMQTTCallback(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Internal message handler to process incoming payloads on subscribed topics.
         */
        void handle_message(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Internal helper to process setpoint JSON fields.
         */
        void process_setpoints(const StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to validate a single setpoint value.
         */
        bool validate_single_setpoint(const char* name, float val, float min_val, float max_val);

        /**
         * @brief Non-blocking reconnect strategy method.
         */
        void reconnect_mqtt();

        /**
         * @brief Internal helper to execute the connection to the MQTT broker.
         */
        bool perform_mqtt_connection();

        /**
         * @brief Internal helper to check WiFi state for MQTT.
         */
        bool check_wifi_for_mqtt();

        /**
         * @brief Internal helper to maintain MQTT connection.
         */
        void maintain_mqtt_connection();

        /**
         * @brief Get effective Client ID, returning default if empty.
         */
        String get_effective_client_id() const;

        // Network clients
#ifndef UNIT_TEST
        WiFiClient wifi_client;
        PubSubClient mqtt_client{wifi_client};
#else
        // Mock variables for offline tests
        WiFiClient wifi_client;
        PubSubClient mqtt_client;
#endif

        MqttState current_state = MqttState::IDLE;
        MqttTopics resolved_topics;
        unsigned long last_reconnect_attempt = 0;
        unsigned long current_reconnect_interval = 2000; ///< Current backoff reconnect interval in ms
        bool is_reconnecting = false;
#ifndef UNIT_TEST
        void* mqtt_mutex = nullptr;
#endif
    };

} // namespace mqtt
