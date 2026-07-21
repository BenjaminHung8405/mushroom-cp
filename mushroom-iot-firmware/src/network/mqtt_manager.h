#pragma once

#include <Arduino.h>
#ifndef UNIT_TEST
#include <WiFi.h>
#endif
#include <ArduinoJson.h>
#ifdef UNIT_TEST
#include <PubSubClient.h>
#else
#include <PubSubClientQos1.h>
#endif
#include "config.h"
#include "core/time_confidence.h"
#include "core/models.h"
#include "protocols/mqtt_callbacks.h"

namespace mqtt {

enum class ProvisionState : uint8_t {
    IDLE,
    CLAIMING,
    RECEIVED_TOKEN,
    RECONNECTING,
};

enum class MqttState : uint8_t {
    IDLE,             // before init
    CONNECTING,       // in progress of connect attempt
    CONNECTED,        // broker connected, subscribed per lifecycle
    DISCONNECTED,     // lost or failed last attempt; will retry
    ERROR_NO_WIFI,    // WiFi not ready — reconnect deferred
    ERROR_NO_CONFIG   // missing broker/user/clientId
};

/**
 * Fixed-length storage for one last processed command UUID + cached ACK result.
 * RFC-4122 UUID = 36 hex chars + '\0' = 37 bytes.  ACK fields are compact PODs.
 */
struct LastCommandSlot {
    char id[37];                // current command_id (hex string)
    char relay_id[10];          // relay_1 through relay_4
    bool active;                // true while awaiting or caching a terminal ACK
    bool pending;               // true until Core 1 accepts or rejects the request
    bool requested_on;          // requested logical relay state
    uint8_t channel;            // AppChannel value for matching a Core 1 ACK
    uint32_t started_ms;        // millis() when the request was enqueued
    uint32_t actual_state_bits; // bit 0: cached final ON state for duplicate ACKs
} __attribute__((aligned(4)));

class MqttManager {
public:
    static MqttManager& getInstance();

    MqttManager(const MqttManager&) = delete;
    MqttManager& operator=(const MqttManager&) = delete;

    /** Initialise client, resolve topics, set callback & LWT. */
    bool init();

    /** Non-blocking loop invoked from Core 0 communication task. */
    void loop();

    /* ---- Published payloads ---- */

    /** Set online/offline on the /status topic. */
    bool publishStatus(bool is_online);

    /** Publish a fully formed telemetry v1 payload (non-retained). */
    bool publishTelemetry(const String& payload);

    /** Build and publish a full telemetry v1 snapshot when its persisted interval is due. */
    bool publishTelemetrySnapshot(const TelemetryData& telemetry, unsigned long now_ms);

    /** Publish a full telemetry snapshot immediately after a local state transition. */
    bool publishTelemetrySnapshotNow(const TelemetryData& telemetry, unsigned long now_ms);

    /** Command acknowledgement QoS 1 (non-retained). */
    bool publishCommandAck(char* command_id, const char* status,
                           uint32_t latency_ms, const char* relay_id,
                           bool relay_on, const char* error_code,
                           const char* error_message);

    /** Publish a Core 1 manual-control acknowledgement immediately (non-retained). */
    bool publishManualAck(const ManualAck& ack);

    /** Resolve a pending MQTT SET_RELAY command from Core 1's safety decision. */
    bool resolveManualAck(const ManualAck& ack);

    /** Provisioning announce QoS 1 (non-retained). Called by handleConnectionSuccess(). */
    bool publishProvisioningAnnounce();

    /** Called by the worker task for a deferred MQTT callback message. */
    void processNetworkMessage(const NetworkMessage& message);

    /** Sends one binary offline telemetry chunk; ACK controls journal reclamation. */
    bool send_sync_burst();

    /* ---- State accessors ---- */
    bool isConnected();
    MqttState getState() const;
    uint16_t getTelemetryIntervalSec() const;
    const char* getTenant() const;
    const char* getDeviceId() const;
    uint8_t getReportingQos() const;
    unsigned long getReconnectInterval() const { return current_reconnect_backoff_; }

private:
    MqttManager();
    ~MqttManager() = default;

    // Connection helpers
    bool validateConfig() const;
    void configurePubSubClient(const String& client_id);
    bool checkWifiReady() const;
    void maintainLoop();
    void tryReconnect();
    bool doConnect();

    // Callbacks
    static void onCallbackStatic(char* topic, uint8_t* payload, unsigned int length);
    void onCallback(char* topic, uint8_t* payload, unsigned int length);

    // Message pipeline
    void onMessage(char* topic, uint8_t* payload, unsigned int length);

    // Provisioning
    bool applyBootstrapResponse(JsonObject root);
    void handleSyncBurstAck(JsonObject root);
    bool publishBootstrapClaim();
    String resolveBootstrapMac() const;

    // Telemetry builder
    void buildTelemetryPayload(JsonObject root, const TelemetryData& telemetry);
    void buildActuatorStates(JsonObject act_root) const;

    // Command dispatcher
    void dispatchCommand(JsonObject root);
    void executeOperatingModeCommand(JsonObject root, String command_id, unsigned long started_ms);
    bool queueOperatingModeToCore1(config::OperatingMode mode, const String& command_id,
                                   unsigned long received_ms);
    void executeBaselineSetpointCommand(JsonObject params, String command_id,
                                        unsigned long started_ms);
    void executeCropProfileCommand(JsonObject params, String command_id,
                                   unsigned long started_ms);
    bool publishConfigAck(const char* command_id, const char* status,
                          uint32_t latency_ms, const char* kind,
                          uint32_t config_revision, uint16_t checkpoint_count,
                          const char* error_code, const char* error_message);
    void executeRelayCommand(JsonObject params, String command_id,
                             uint32_t issue_epoch_s);
    bool queueRelayToCore1(uint8_t pin, bool activate);
    void recordProcessedCommand(String command_id, uint32_t latency_ms,
                                const char* relay_id, bool relay_on);
    void replayDuplicateAck(const char* command_id, uint32_t latency_ms);

    // Helpers
    String resolveClientId() const;
    String resolveLwtTopic() const;
    String lwtPayloadOffline() const;
    String lwtPayloadOnline() const;
    void subscribePerLifecycle();

    // State
#ifndef UNIT_TEST
    WiFiClient wifi_client_;
    PubSubClientQos1 client_{wifi_client_};
#else
    WiFiClient wifi_client_;
    PubSubClient client_;
#endif

    MqttState state_ = MqttState::IDLE;
    String tenant_;
    String device_id_;

    uint16_t telemetry_interval_sec_ = config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
    uint8_t reporting_qos_ = config::network::DEFAULT_REPORTING_QOS;

    // Lifecycle state persisted across reconnects
    bool provisioned_ = false;
    ProvisionState provision_state_ = ProvisionState::IDLE;
    String bootstrap_mac_;
    uint8_t bootstrap_claim_attempts_ = 0;
    unsigned long claim_started_at_ = 0;
    unsigned long sequence_number_ = 0;

    // Dedup cache
    LastCommandSlot last_cmd_{};

    // Timers
    unsigned long last_connect_attempt_ = 0;
    unsigned long current_reconnect_backoff_ = 1000;
    unsigned long last_telemetry_due_ = 0;

#ifndef UNIT_TEST
    void* mutex_ = nullptr;
#endif
};

} // namespace mqtt
