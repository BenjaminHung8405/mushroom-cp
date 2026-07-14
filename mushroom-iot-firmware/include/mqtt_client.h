#pragma once

#include <Arduino.h>

#ifndef UNIT_TEST
#include <WiFi.h>
#include <PubSubClient.h>
#endif

#include <ArduinoJson.h>
#include "storage.h"
#include "models.h"

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
        String manual_ack;  ///< Topic to publish manual control feedback/ack (retained)
        
        // --- Incoming / Subscribe Topics ---
        String setpoint;    ///< Topic to subscribe for incoming control setpoint commands
        String profile;     ///< Topic to subscribe for crop profile synchronization
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
        static MqttClient& getInstance();

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
        bool publishTelemetry(const String& payload);

        /**
         * @brief Publishes online/offline status to the resolved status topic.
         * @param is_online true for "online" state, false for "offline" state.
         * @return true if publication succeeded.
         */
        bool publishStatus(bool is_online);

        /**
         * @brief Publishes manual ack payload to the resolved manual_ack topic.
         * @param ack ManualAck structure to publish.
         * @return true if publication succeeded.
         */
        bool publishManualAck(const ManualAck& ack);

        /**
         * @brief Checks if the client is currently connected to the broker.
         */
        bool isConnected();

        /**
         * @brief Gets the current client state.
         */
        MqttState getState() const;

        /**
         * @brief Returns the resolved topics struct containing runtime topic names.
         */
        const MqttTopics& getResolvedTopics() const;

        /**
         * @brief Returns the current reconnect interval (for unit testing backoff).
         */
        unsigned long getReconnectInterval() const;

    private:
        MqttClient() = default;
        ~MqttClient() = default;

        /**
         * @brief Static wrapper callback hook registered into PubSubClient.
         */
        static void mqttCallbackStatic(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Static callback hook that handles incoming MQTT messages.
         */
        static void handleMQTTCallback(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Internal message handler to process incoming payloads on subscribed topics.
         */
        void handleMessage(char* topic, uint8_t* payload, unsigned int length);

        /**
         * @brief Internal helper to process setpoint JSON fields.
         */
        void processSetpoints(StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to process actuator override JSON fields.
         */
        void processActuatorOverrides(StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to process crop profile JSON fields.
         */
        void processProfileMessage(StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to validate a single setpoint value.
         */
        bool validateSingleSetpoint(const char* name, float val, float min_val, float max_val);

        /**
         * @brief Internal helper to parse and validate JSON payload.
         */
        bool parseJsonPayload(uint8_t* payload, unsigned int length, StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to handle MQTT control commands.
         */
        bool handleMqttCommand(StaticJsonDocument<768>& doc);

        /**
         * @brief Internal helper to validate MQTT credentials before connecting.
         */
        bool validateConnectionConfig(const String& client_id);

        /**
         * @brief Internal helper to retrieve Last Will and Testament configuration.
         */
        void getLwtConfig(String& lwt_topic, String& lwt_payload);

        /**
         * @brief Non-blocking reconnect strategy method.
         */
        void reconnectMqtt();

        /**
         * @brief Internal helper to execute the connection to the MQTT broker.
         */
        bool performMqttConnection();

        /**
         * @brief Internal helper to check WiFi state for MQTT.
         */
        bool checkWifiForMqtt();

        /**
         * @brief Internal helper to maintain MQTT connection.
         */
        void maintainMqttConnection();

        /**
         * @brief Get effective Client ID, returning default if empty.
         */
        String getEffectiveClientId() const;

        // --- Private helpers to decompose long methods (<50 lines) ---
        void configurePubSubClient(const String& client_id);
        void initializeMutex();
        bool validateIncomingMessage(const char* topic, const uint8_t* payload, unsigned int length);
        void routeSetpointMessage(StaticJsonDocument<768>& doc, bool is_command);
        void parseAndPersistBaseline(StaticJsonDocument<768>& doc);
        bool validateSetpointPayload(StaticJsonDocument<768>& doc, float& val_temp, float& val_humi, float& val_co2);
        void queueBaselineCommand(const storage::BackendSetpointSnapshot& snapshot);
        void handleMqttConnectionSuccess();
        void handleMqttConnectionFailure();

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
