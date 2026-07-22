#include "network/mqtt_manager.h"

#include <cstring>
#include <algorithm>
#include <cmath>
#include <time.h>

#include "config.h"
#include "core/config_manager.h"
#include "core/serial_mutex.h"
#include "core/storage.h"
#include "core/crop_profile_storage.h"
#include "core/crop_profile_validator.h"
#include "core/system_manager.h"
#include "core/time_confidence.h"
#include "network/wifi_manager.h"
#include "protocols/mqtt_callbacks.h"

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace mqtt {
namespace {
constexpr uint16_t MQTT_BUFFER_BYTES = 2048;
constexpr uint8_t MQTT_QOS = 1;
constexpr unsigned long MIN_RECONNECT_BACKOFF_MS = 1000;
constexpr unsigned long MAX_RECONNECT_BACKOFF_MS = 60000;
constexpr size_t UUID_LEN = 36;
constexpr unsigned long BOOTSTRAP_RESPONSE_TIMEOUT_MS = 15000;
constexpr uint8_t MAX_BOOTSTRAP_CLAIMS = 3;

bool sameText(const char* left, const char* right)
{
    return left != nullptr && right != nullptr && strcmp(left, right) == 0;
}

bool validUuid(const char* value)
{
    return value != nullptr && strlen(value) == UUID_LEN;
}

bool parseRelayId(const char* relay_id, uint8_t& pin)
{
    if (sameText(relay_id, "relay_1")) {
        pin = config::pins::PIN_RELAY_MIST;
        return true;
    }
    if (sameText(relay_id, "relay_2")) {
        pin = config::pins::PIN_RELAY_FAN;
        return true;
    }
    if (sameText(relay_id, "relay_3")) {
        pin = config::pins::PIN_RELAY_HWAT;
        return true;
    }
    if (sameText(relay_id, "relay_4")) {
        pin = config::pins::PIN_RELAY_LAMP;
        return true;
    }
    return false;
}

uint32_t relayBit(uint8_t pin)
{
    if (pin == config::pins::PIN_RELAY_MIST) return 1U << 0;
    if (pin == config::pins::PIN_RELAY_FAN) return 1U << 1;
    if (pin == config::pins::PIN_RELAY_HWAT) return 1U << 2;
    if (pin == config::pins::PIN_RELAY_LAMP) return 1U << 3;
    return 0;
}

const char* boolState(bool active) { return active ? "ON" : "OFF"; }

uint32_t freeHeapBytes()
{
#ifndef UNIT_TEST
    return ESP.getFreeHeap();
#else
    return 0;
#endif
}
} // namespace

MqttManager& MqttManager::getInstance()
{
    static MqttManager instance;
    return instance;
}

MqttManager::MqttManager()
{
    memset(&last_cmd_, 0, sizeof(last_cmd_));
}

bool MqttManager::init()
{
    tenant_ = config::network::TENANT;
    device_id_ = resolveClientId();

    storage::StorageManager& storage = storage::StorageManager::get_instance();
    provisioned_ = storage.load_provisioning(telemetry_interval_sec_, reporting_qos_);
    String provision_token;
    if (provisioned_ && storage.load_provision_token(provision_token)) {
        config::network::MQTT_PASSWORD_VAL = provision_token;
    } else if (provisioned_) {
        Serial.println("[MQTT] Provisioning record has no valid token; restarting bootstrap.");
        provisioned_ = false;
        storage.clear_provisioning();
    }
    bootstrap_mac_ = resolveBootstrapMac();
    if (!validateConfig()) {
        state_ = MqttState::ERROR_NO_CONFIG;
        return false;
    }

    configurePubSubClient(device_id_);
#ifndef UNIT_TEST
    if (mutex_ == nullptr) {
        mutex_ = xSemaphoreCreateMutex();
    }
#endif

    state_ = MqttState::IDLE;
    Serial.printf("[MQTT] V3 initialized: tenant=%s device=%s state=%s interval=%us\n",
                  tenant_.c_str(), device_id_.c_str(),
                  provisioned_ ? "ACTIVE" : "UNPROVISIONED",
                  static_cast<unsigned>(telemetry_interval_sec_));
    return true;
}

void MqttManager::configurePubSubClient(const String& client_id)
{
    (void)client_id;
    if (!client_.setBufferSize(MQTT_BUFFER_BYTES)) {
        Serial.println("[MQTT] Failed to allocate packet buffer.");
        state_ = MqttState::ERROR_NO_CONFIG;
        return;
    }
#ifndef UNIT_TEST
    wifi_client_.setTimeout(2);
#endif
    client_.setKeepAlive(60);
    client_.setServer(config::network::MQTT_BROKER_VAL.c_str(), config::network::MQTT_PORT_VAL);
    client_.setCallback(MqttManager::onCallbackStatic);
}

bool MqttManager::validateConfig() const
{
    if (tenant_.length() == 0 || device_id_.length() == 0 ||
        config::network::MQTT_BROKER_VAL.length() == 0 ||
        config::network::MQTT_PORT_VAL == 0) {
        Serial.println("[MQTT] Missing broker configuration or device identity.");
        return false;
    }
    if (!provisioned_) {
        return bootstrap_mac_.length() == 12 &&
               String(config::network::BOOTSTRAP_USER).length() > 0 &&
               String(config::network::BOOTSTRAP_SECRET).length() > 0;
    }
    if (config::network::MQTT_USER_VAL.length() == 0 ||
        config::network::MQTT_PASSWORD_VAL.length() == 0 ||
        config::network::MQTT_USER_VAL != device_id_) {
        Serial.println("[MQTT] Invalid identity: MQTT username must equal device/client ID.");
        return false;
    }
    return true;
}

bool MqttManager::checkWifiReady() const
{
    return wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED;
}

void MqttManager::loop()
{
    if (state_ == MqttState::ERROR_NO_CONFIG) {
        return;
    }
    if (!checkWifiReady()) {
        if (client_.connected()) {
            client_.disconnect();
        }
        state_ = MqttState::ERROR_NO_WIFI;
        return;
    }
    if (state_ == MqttState::ERROR_NO_WIFI) {
        state_ = MqttState::DISCONNECTED;
    }
    maintainLoop();
}

void MqttManager::maintainLoop()
{
    if (client_.connected()) {
        client_.loop();
        state_ = MqttState::CONNECTED;
        if (!provisioned_ && provision_state_ == ProvisionState::CLAIMING &&
            millis() - claim_started_at_ >= BOOTSTRAP_RESPONSE_TIMEOUT_MS) {
            Serial.println("[MQTT] Bootstrap claim timed out.");
            client_.disconnect();
            if (bootstrap_claim_attempts_ >= MAX_BOOTSTRAP_CLAIMS) {
                bootstrap_claim_attempts_ = 0;
            }
            current_reconnect_backoff_ = std::min(
                current_reconnect_backoff_ * 2 + (millis() % 501UL),
                MAX_RECONNECT_BACKOFF_MS);
        }
        return;
    }

    state_ = MqttState::DISCONNECTED;
    const unsigned long now = millis();
    if (now - last_connect_attempt_ >= current_reconnect_backoff_) {
        tryReconnect();
    }
}

void MqttManager::tryReconnect()
{
#ifndef UNIT_TEST
    if (mutex_ != nullptr && xSemaphoreTake((SemaphoreHandle_t)mutex_, 0) != pdTRUE) {
        return;
    }
#endif
    last_connect_attempt_ = millis();
    state_ = MqttState::CONNECTING;
    if (!doConnect()) {
        state_ = MqttState::DISCONNECTED;
        current_reconnect_backoff_ = std::min(
            current_reconnect_backoff_ * 2 + (millis() % 501UL),
            MAX_RECONNECT_BACKOFF_MS);
    }
#ifndef UNIT_TEST
    if (mutex_ != nullptr) {
        xSemaphoreGive((SemaphoreHandle_t)mutex_);
    }
#endif
}

bool MqttManager::doConnect()
{
    const bool bootstrap = !provisioned_;
    const String client_id = bootstrap ? bootstrap_mac_ : device_id_;
    const char* username = bootstrap ? config::network::BOOTSTRAP_USER
                                     : device_id_.c_str();
    const char* password = bootstrap ? config::network::BOOTSTRAP_SECRET
                                     : config::network::MQTT_PASSWORD_VAL.c_str();
    const String lwt_topic = resolveLwtTopic();
    const String lwt_payload = lwtPayloadOffline();
    const bool connected = bootstrap
        ? client_.connect(client_id.c_str(), username, password)
        : client_.connect(client_id.c_str(), username, password,
                          lwt_topic.c_str(), MQTT_QOS, true, lwt_payload.c_str());
    if (!connected) {
        Serial.printf("[MQTT] Connect failed (state=%d).\n", client_.state());
        return false;
    }

    state_ = MqttState::CONNECTED;
    current_reconnect_backoff_ = MIN_RECONNECT_BACKOFF_MS;
    subscribePerLifecycle();
    if (bootstrap) {
        if (!publishBootstrapClaim()) {
            client_.disconnect();
            return false;
        }
        provision_state_ = ProvisionState::CLAIMING;
        claim_started_at_ = millis();
        bootstrap_claim_attempts_ += 1;
        Serial.printf("[MQTT] Bootstrap claim %u sent for MAC %s.\n",
                      static_cast<unsigned>(bootstrap_claim_attempts_), bootstrap_mac_.c_str());
    } else {
        provision_state_ = ProvisionState::IDLE;
        current_reconnect_backoff_ = MIN_RECONNECT_BACKOFF_MS;
        publishStatus(true);
        publishProvisioningAnnounce(); // best effort metadata; never gates active lifecycle
        Serial.printf("[MQTT] Connected as %s (ACTIVE).\n", device_id_.c_str());
    }
    return true;
}

void MqttManager::subscribePerLifecycle()
{
    if (!provisioned_) {
        const String response = tenant_ + "/provision/response/" + bootstrap_mac_;
        client_.subscribe(response.c_str(), MQTT_QOS);
        return;
    }
    const String command = tenant_ + "/esp32/" + device_id_ + "/down/command";
    client_.subscribe(command.c_str(), MQTT_QOS);
}

void MqttManager::onCallbackStatic(char* topic, uint8_t* payload, unsigned int length)
{
    MqttManager::getInstance().onCallback(topic, payload, length);
}

void MqttManager::onCallback(char* topic, uint8_t* payload, unsigned int length)
{
    MessageDispatcher::dispatch(topic, payload, length);
}

void MqttManager::onMessage(char* topic, uint8_t* payload, unsigned int length)
{
    // A complete crop profile contains up to ten checkpoints. Keep the parser
    // bounded, but allow the documented command payload to fit in one packet.
    if (topic == nullptr || (payload == nullptr && length > 0) || length >= 1536) {
        return;
    }
    char safe_payload[1536];
    if (length > 0) {
        memcpy(safe_payload, payload, length);
    }
    safe_payload[length] = '\0';

    StaticJsonDocument<1536> doc;
    if (deserializeJson(doc, safe_payload)) {
        Serial.printf("[MQTT] Rejected malformed JSON on %s.\n", topic);
        return;
    }
    JsonObject root = doc.as<JsonObject>();
    const String topic_text(topic);
    if (topic_text == tenant_ + "/provision/response/" + bootstrap_mac_) {
        if (!provisioned_) {
            applyBootstrapResponse(root);
        }
        return;
    }
    if (topic_text.endsWith("/down/command")) {
        dispatchCommand(root);
    }
}

bool MqttManager::applyBootstrapResponse(JsonObject root)
{
    const char* device_id = root["device_id"] | "";
    const char* mqtt_username = root["mqtt_username"] | "";
    const char* mqtt_token = root["mqtt_token"] | "";
    if (!sameText(device_id, device_id_.c_str()) ||
        !sameText(mqtt_username, device_id_.c_str()) || strlen(mqtt_token) < UUID_LEN) {
        Serial.println("[MQTT] Ignored invalid bootstrap provisioning response.");
        return false;
    }

    uint16_t interval = root["telemetry_interval_sec"] |
                        config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
    uint8_t qos = root["reporting_qos"] | config::network::DEFAULT_REPORTING_QOS;
    if (interval == 0) interval = config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
    if (qos > 1) qos = config::network::DEFAULT_REPORTING_QOS;

    storage::StorageManager& storage = storage::StorageManager::get_instance();
    if (!storage.save_provision_token(String(mqtt_token)) ||
        !storage.save_provisioning(interval, qos)) {
        Serial.println("[MQTT] Bootstrap response received but NVS persistence failed.");
        return false;
    }

    telemetry_interval_sec_ = interval;
    reporting_qos_ = qos;
    provisioned_ = true;
    provision_state_ = ProvisionState::RECEIVED_TOKEN;
    config::network::MQTT_CLIENT_ID_VAL = device_id_;
    config::network::MQTT_USER_VAL = device_id_;
    config::network::MQTT_PASSWORD_VAL = mqtt_token;
    client_.disconnect();
    provision_state_ = ProvisionState::RECONNECTING;
    last_connect_attempt_ = millis() - MIN_RECONNECT_BACKOFF_MS;
    current_reconnect_backoff_ = MIN_RECONNECT_BACKOFF_MS;
    Serial.println("[MQTT] Bootstrap token persisted; reconnecting with device credentials.");
    return true;
}

bool MqttManager::publishBootstrapClaim()
{
    StaticJsonDocument<256> doc;
    doc["mac_address"] = bootstrap_mac_;
    doc["hardware_model"] = "ESP32-S3-N16R8";
    doc["firmware_version"] = "3.0.0";
    String payload;
    serializeJson(doc, payload);
    const String topic = tenant_ + "/provision/request";
    return client_.publish(topic.c_str(), reinterpret_cast<const uint8_t*>(payload.c_str()),
                           payload.length(), false);
}

String MqttManager::resolveBootstrapMac() const
{
    constexpr const char* prefix = "mushroom_s3_";
    constexpr size_t prefix_len = 12;
    const char* value = device_id_.c_str();
    if (strlen(value) != prefix_len + 12 || strncmp(value, prefix, prefix_len) != 0) {
        return "";
    }
    for (size_t i = prefix_len; i < prefix_len + 12; ++i) {
        if (!((value[i] >= '0' && value[i] <= '9') ||
              (value[i] >= 'a' && value[i] <= 'f'))) {
            return "";
        }
    }
    return String(value + prefix_len);
}

bool MqttManager::publishStatus(bool is_online)
{
    if (!client_.connected()) return false;
    const String topic = resolveLwtTopic();
    const String payload = is_online ? lwtPayloadOnline() : lwtPayloadOffline();
    return client_.publish(topic.c_str(), reinterpret_cast<const uint8_t*>(payload.c_str()),
                           payload.length(), true);
}

String MqttManager::resolveLwtTopic() const
{
    return tenant_ + "/esp32/" + device_id_ + "/status";
}

String MqttManager::lwtPayloadOffline() const
{
    StaticJsonDocument<192> doc;
    doc["device_id"] = device_id_;
    doc["online"] = false;
    doc["status"] = "OFFLINE_UNEXPECTED";
    doc["last_seen_utc"] = nullptr;
    doc["reason"] = "LWT_TRIGGERED";
    String out;
    serializeJson(doc, out);
    return out;
}

String MqttManager::lwtPayloadOnline() const
{
    StaticJsonDocument<192> doc;
    doc["device_id"] = device_id_;
    doc["online"] = true;
    doc["status"] = "ONLINE";
    doc["reason"] = "NORMAL_CONNECT";
    String out;
    serializeJson(doc, out);
    return out;
}

bool MqttManager::publishProvisioningAnnounce()
{
    if (!client_.connected()) return false;
    StaticJsonDocument<512> doc;
    doc["$schema"] = "https://iot.acme.com/schema/v1/provision-announce";
    doc["device_id"] = device_id_;
    doc["firmware_version"] = "3.0.0";
    doc["hardware_revision"] = "ESP32-S3-N16R8";
#ifndef UNIT_TEST
    doc["mac_address"] = WiFi.macAddress();
#else
    doc["mac_address"] = "00:00:00:00:00:00";
#endif
    doc["chip_model"] = "ESP32-S3";
    JsonArray capabilities = doc.createNestedArray("capabilities");
    capabilities.add("temperature");
    capabilities.add("humidity");
    capabilities.add("relay_control");
    doc["boot_reason"] = "BOOT";
    doc["free_heap_bytes"] = freeHeapBytes();
    String payload;
    serializeJson(doc, payload);
    const String topic = tenant_ + "/esp32/" + device_id_ + "/up/provisioning/announce";
    return client_.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishTelemetry(const String& payload)
{
    if (!client_.connected() || !provisioned_ || payload.length() == 0) {
        return false;
    }
    const String topic = tenant_ + "/esp32/" + device_id_ + "/up/telemetry";
    return client_.publish(topic.c_str(), payload.c_str());
}

void MqttManager::buildActuatorStates(JsonObject act_root) const
{
    // Existing control data has final edge state values; names follow fixed relay contract.
    act_root["relay_1"] = "UNKNOWN";
    act_root["relay_2"] = "UNKNOWN";
    act_root["relay_3"] = "UNKNOWN";
    act_root["relay_4"] = "UNKNOWN";
}

void MqttManager::buildTelemetryPayload(JsonObject root, const TelemetryData& telemetry)
{
    root["$schema"] = "https://iot.acme.com/schema/v1/telemetry";
    root["device_id"] = device_id_;
    root["sequence_number"] = ++sequence_number_;
    root["uptime_sec"] = millis() / 1000UL;
    root["operating_mode"] = getOperatingModeSnapshot() == config::OperatingMode::AI ? "AI" : "MANUAL";
    JsonObject readings = root.createNestedObject("readings");
    if (std::isnan(telemetry.temp_air)) readings["temperature_celsius"] = nullptr;
    else readings["temperature_celsius"] = telemetry.temp_air;
    if (std::isnan(telemetry.humidity_air)) readings["humidity_percent"] = nullptr;
    else readings["humidity_percent"] = telemetry.humidity_air;
#ifndef UNIT_TEST
    readings["rssi_dbm"] = WiFi.RSSI();
#else
    readings["rssi_dbm"] = nullptr;
#endif
    JsonObject states = root.createNestedObject("actuator_states");
    states["relay_1"] = boolState(telemetry.actuators.mist_active);
    states["relay_2"] = boolState(telemetry.actuators.fan_active);
    states["relay_3"] = boolState(telemetry.actuators.heater_water_active);
    states["relay_4"] = boolState(telemetry.actuators.lamp_stage_active);
    // Control metadata — firmware-authoritative setpoint source & revision.
    {
        SharedSystemState sys = getSharedSystemState();
        JsonObject ctrl = root.createNestedObject("control");
        if (std::isnan(sys.temp_target))       ctrl["temperature_target_celsius"] = nullptr;
        else                                   ctrl["temperature_target_celsius"] = sys.temp_target;
        if (std::isnan(sys.humidity_target))   ctrl["humidity_target_percent"] = nullptr;
        else                                   ctrl["humidity_target_percent"] = sys.humidity_target;
        if (std::isnan(sys.co2_target))        ctrl["co2_target_ppm"] = nullptr;
        else                                   ctrl["co2_target_ppm"] = sys.co2_target;
        ctrl["source"] = controlSourceName(sys.control_source);
        ctrl["config_revision"] = sys.config_revision;
    }

    JsonObject metadata = root.createNestedObject("metadata");
    metadata["free_heap_bytes"] = freeHeapBytes();
    metadata["wifi_reconnect_count"] = 0;
}

void MqttManager::dispatchCommand(JsonObject root)
{
    const char* command_id_raw = root["command_id"] | "";
    const char* requested_device = root["device_id"] | "";
    String command_id(command_id_raw);
    const unsigned long started_ms = millis();

    if (!provisioned_) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", 0, nullptr, false,
                          "NOT_PROVISIONED", "Device has not completed provisioning");
        return;
    }
    if (!validUuid(command_id_raw)) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", 0, nullptr, false,
                          "INVALID_COMMAND_ID", "command_id must be a UUID");
        return;
    }
    if (!sameText(requested_device, device_id_.c_str())) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", 0, nullptr, false,
                          "DEVICE_ID_MISMATCH", "Command targets another device");
        return;
    }
    if (last_cmd_.active && sameText(last_cmd_.id, command_id_raw)) {
        // The original command is still waiting for Core 1. Never claim success
        // from a stale GPIO read; its terminal ACK will be emitted after arbitration.
        if (!last_cmd_.pending) {
            replayDuplicateAck(command_id_raw, millis() - started_ms);
        }
        return;
    }
    const char* action = root["action"] | "";

    // Commands are only expiry-validated if the local clock is trusted.
    const char* expires_at = root["expires_at_utc"] | "";
    if (expires_at[0] != '\0') {
        if (time_conf::getTimeConfidence() != TimeConfidence::Trusted) {
            publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                              "CLOCK_UNTRUSTED", "Cannot validate expires_at_utc without a trusted clock");
            return;
        }
        // ISO-8601 parsing belongs to the time service; a trusted clock coupled with a
        // non-empty timestamp is required. Reject malformed values rather than guessing.
        if (strlen(expires_at) < 20) {
            publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                              "INVALID_EXPIRY", "expires_at_utc must be ISO-8601 UTC");
            return;
        }
    }
    const JsonObject parameters = root["parameters"].as<JsonObject>();
    if (sameText(action, "SET_RELAY")) {
        executeRelayCommand(parameters, command_id, 0);
    } else if (sameText(action, "SET_BASELINE_SETPOINT")) {
        executeBaselineSetpointCommand(parameters, command_id, started_ms);
    } else if (sameText(action, "SET_CROP_PROFILE")) {
        executeCropProfileCommand(parameters, command_id, started_ms);
    } else if (sameText(action, "SET_OPERATING_MODE")) {
        executeOperatingModeCommand(root, command_id, started_ms);
    } else {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                          "INVALID_ACTION", "Supported actions: SET_RELAY, SET_BASELINE_SETPOINT, SET_CROP_PROFILE, SET_OPERATING_MODE");
    }
}

void MqttManager::executeBaselineSetpointCommand(
    JsonObject params,
    String command_id,
    unsigned long started_ms)
{
    const bool hasTemperature = params.containsKey("temperature_celsius");
    const bool hasHumidity = params.containsKey("humidity_percent");
    const bool hasCo2 = params.containsKey("co2_ppm");
    const bool hasRevision = params.containsKey("config_revision");
    const uint32_t revision = params["config_revision"] | 0U;
    const float temperature = params["temperature_celsius"] | NAN;
    const float humidity = params["humidity_percent"] | NAN;
    const float co2 = params["co2_ppm"] | NAN;

    // Keep these limits aligned with StorageManager::is_valid_backend().
    if (!hasTemperature || !hasHumidity || !hasCo2 || !hasRevision || revision == 0U ||
        !std::isfinite(temperature) || temperature < 10.0f || temperature > 45.0f ||
        !std::isfinite(humidity) || humidity < 30.0f || humidity > 95.0f ||
        !std::isfinite(co2) || co2 < 400.0f || co2 > 10000.0f)
    {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms,
                          nullptr, false, "INVALID_SETPOINT",
                          "temperature_celsius, humidity_percent, and co2_ppm must be finite values within device limits");
        return;
    }
    uint32_t appliedRevision = 0;
    storage::StorageManager::get_instance().load_baseline_config_revision(appliedRevision);
    if (revision <= appliedRevision) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "baseline_setpoint", revision, 0, "STALE_CONFIG_REVISION",
                         "config_revision must be newer than the persisted baseline revision");
        return;
    }
    if (xBaselineQueue == nullptr) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms,
                          nullptr, false, "CONTROL_QUEUE_UNAVAILABLE",
                          "Core 1 baseline control queue is unavailable");
        return;
    }

    const storage::BackendSetpointSnapshot snapshot = {
        temperature,
        humidity,
        co2,
        true,
    };
    if (!storage::StorageManager::get_instance().save_backend_snapshot(snapshot) ||
        !storage::StorageManager::get_instance().save_baseline_config_revision(revision)) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "baseline_setpoint", revision, 0, "PERSISTENCE_FAILED",
                         "Unable to persist the baseline setpoint and revision");
        return;
    }

    const ControlSetpointCommand command = {
        temperature,
        humidity,
        co2,
        true,
        {0, 0, 0},
    };
    if (xQueueOverwrite(xBaselineQueue, &command) != pdTRUE) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms,
                          nullptr, false, "CONTROL_QUEUE_UNAVAILABLE",
                          "Unable to deliver the baseline setpoint to Core 1");
        return;
    }

    setBaselineConfigRevision(revision);
    Serial.printf("[CONTROL] Applied baseline setpoint rev=%lu: T=%.2f H=%.2f CO2=%.0f\n",
                  static_cast<unsigned long>(revision), temperature, humidity, co2);
    setSharedForceFullPublish(true);
    publishConfigAck(command_id.c_str(), "SUCCESS", millis() - started_ms,
                     "baseline_setpoint", revision, 0, nullptr, nullptr);
}

void MqttManager::executeCropProfileCommand(
    JsonObject params,
    String command_id,
    unsigned long started_ms)
{
    const uint32_t revision = params["config_revision"] | 0U;
    const JsonObject source = params["profile"].as<JsonObject>();
    if (revision == 0U || source.isNull() || g_profile_update_queue == nullptr) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "PROFILE_INVALID",
                         "config_revision, profile, and the Core 1 profile queue are required");
        return;
    }

    uint32_t appliedRevision = 0;
    storage::CropProfileStorage::getInstance().loadProfileConfigRevision(appliedRevision);
    if (revision <= appliedRevision) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "STALE_CONFIG_REVISION",
                         "config_revision must be newer than the persisted profile revision");
        return;
    }

    PersistedCropProfile profile{};
    profile.magic = 0x43524F50; // CROP
    profile.schema_version = source["schema_version"] | 0U;
    profile.crop_start_epoch_s = source["crop_start_epoch_s"] | 0LL;
    profile.total_crop_days = source["total_crop_days"] | 0U;
    const JsonArray checkpoints = source["checkpoints"].as<JsonArray>();
    if (checkpoints.isNull() || checkpoints.size() == 0 ||
        checkpoints.size() > MAX_CROP_CHECKPOINTS) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "PROFILE_INVALID",
                         "checkpoints must contain between 1 and MAX_CROP_CHECKPOINTS entries");
        return;
    }

    profile.checkpoint_count = static_cast<uint16_t>(checkpoints.size());
    for (uint16_t i = 0; i < profile.checkpoint_count; ++i) {
        const JsonObject checkpoint = checkpoints[i].as<JsonObject>();
        if (checkpoint.isNull() || !checkpoint.containsKey("crop_day") ||
            !checkpoint.containsKey("temp_target_c") ||
            !checkpoint.containsKey("humidity_target_rh")) {
            publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                             "crop_profile", revision, 0, "PROFILE_INVALID",
                             "every checkpoint requires crop_day, temp_target_c, and humidity_target_rh");
            return;
        }
        profile.checkpoints[i].crop_day = checkpoint["crop_day"] | 0U;
        profile.checkpoints[i].temp_target_c = checkpoint["temp_target_c"] | NAN;
        profile.checkpoints[i].humidity_target_rh = checkpoint["humidity_target_rh"] | NAN;
    }
    if (!storage::CropProfileValidator::validate(profile)) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "PROFILE_INVALID",
                         "profile schema, days, checkpoint ordering, or target ranges are invalid");
        return;
    }

    profile.crc32 = storage::CropProfileStorage::calculateCRC32(
        reinterpret_cast<const uint8_t*>(&profile), sizeof(profile) - sizeof(profile.crc32));
    if (!storage::CropProfileStorage::getInstance().saveProfile(profile) ||
        !storage::CropProfileStorage::getInstance().saveProfileConfigRevision(revision)) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "PERSISTENCE_FAILED",
                         "Unable to persist crop profile");
        return;
    }

    if (params["clear_baseline"] | false) {
        storage::BackendSetpointSnapshot existing{};
        if (storage::StorageManager::get_instance().load_backend_snapshot(existing) &&
            !storage::StorageManager::get_instance().clear_backend_snapshot()) {
            publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                             "crop_profile", revision, 0, "PERSISTENCE_FAILED",
                             "Profile was saved but the old baseline could not be cleared");
            return;
        }
        setBaselineConfigRevision(0);
        const ControlSetpointCommand inactive = {NAN, NAN, NAN, false, {0, 0, 0}};
        if (xBaselineQueue == nullptr || xQueueOverwrite(xBaselineQueue, &inactive) != pdTRUE) {
            publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                             "crop_profile", revision, 0, "CONTROL_QUEUE_UNAVAILABLE",
                             "Profile was saved but the baseline queue is unavailable");
            return;
        }
    }

    if (xQueueOverwrite(g_profile_update_queue, &profile) != pdTRUE) {
        publishConfigAck(command_id.c_str(), "FAILED", millis() - started_ms,
                         "crop_profile", revision, 0, "CONTROL_QUEUE_UNAVAILABLE",
                         "Profile was saved but cannot be delivered to Core 1");
        return;
    }

    setProfileConfigRevision(revision);
    Serial.printf("[CONTROL] Applied crop profile rev=%lu checkpoints=%u\n",
                  static_cast<unsigned long>(revision), profile.checkpoint_count);
    setSharedForceFullPublish(true);
    publishConfigAck(command_id.c_str(), "SUCCESS", millis() - started_ms,
                     "crop_profile", revision, profile.checkpoint_count, nullptr, nullptr);
}

void MqttManager::executeOperatingModeCommand(JsonObject root, String command_id, unsigned long started_ms)
{
    const char* mode = root["parameters"]["mode"] | "";
    config::OperatingMode nextMode;
    if (sameText(mode, "AI")) {
        nextMode = config::OperatingMode::AI;
    } else if (sameText(mode, "MANUAL")) {
        nextMode = config::OperatingMode::MANUAL;
    } else {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                          "INVALID_OPERATING_MODE", "mode must be AI or MANUAL");
        return;
    }

    // Core 1 owns mode, latches and relay arbitration. MQTT only validates and
    // enqueues a fixed-size event so a transition cannot tear a control tick.
    if (!queueOperatingModeToCore1(nextMode, command_id, started_ms)) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                          "CONTROL_QUEUE_FULL", "Core 1 control queue is full; retry the command");
    }
}

bool MqttManager::queueOperatingModeToCore1(
    config::OperatingMode mode, const String& command_id, unsigned long received_ms)
{
    ControlEvent event{};
    event.type = ControlEventType::OperatingMode;
    event.mode = static_cast<uint8_t>(mode);
    event.received_ms = received_ms;
    strncpy(event.command_id, command_id.c_str(), sizeof(event.command_id) - 1U);
    return enqueueControlEvent(event);
}

void MqttManager::executeRelayCommand(JsonObject params, String command_id, uint32_t issue_epoch_s)
{
    (void)issue_epoch_s;
    const unsigned long started_ms = millis();
    const char* relay_id = params["relay_id"] | "";
    const char* state = params["state"] | "";
    const uint32_t duration = params["duration_sec"] | 0U;
    uint8_t pin = 0;

    if (!parseRelayId(relay_id, pin)) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, nullptr, false,
                          "INVALID_RELAY", "relay_id must be relay_1 through relay_4");
        return;
    }
    if (!sameText(state, "ON") && !sameText(state, "OFF")) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, relay_id, false,
                          "INVALID_STATE", "state must be ON or OFF");
        return;
    }
    if (duration != 0U) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, relay_id, false,
                          "DURATION_UNSUPPORTED", "duration_sec must be 0");
        return;
    }

    const bool requested_on = sameText(state, "ON");
    if (!queueRelayToCore1(pin, requested_on)) {
        publishCommandAck(const_cast<char*>(command_id.c_str()), "FAILED", millis() - started_ms, relay_id, false,
                          "CONTROL_QUEUE_FULL", "Core 1 control queue is full; retry the command");
        return;
    }

    // Core 1 owns safety arbitration and the physical GPIO write. Do not read
    // GPIO here: this callback runs before the next Core 1 control tick.
    memset(&last_cmd_, 0, sizeof(last_cmd_));
    strncpy(last_cmd_.id, command_id.c_str(), sizeof(last_cmd_.id) - 1);
    strncpy(last_cmd_.relay_id, relay_id, sizeof(last_cmd_.relay_id) - 1);
    last_cmd_.active = true;
    last_cmd_.pending = true;
    last_cmd_.requested_on = requested_on;
    last_cmd_.channel = static_cast<uint8_t>(
        pin == config::pins::PIN_RELAY_MIST ? AppChannel::MIST :
        pin == config::pins::PIN_RELAY_FAN ? AppChannel::FAN :
        pin == config::pins::PIN_RELAY_LAMP ? AppChannel::LAMP : AppChannel::HWAT);
    last_cmd_.started_ms = started_ms;
}

bool MqttManager::queueRelayToCore1(uint8_t pin, bool activate)
{
    // Core 1 owns relay arbitration. Existing V3 scope exposes mist/fan/lamp
    // through its manual request queue; water-heater has no manual channel yet.
    ManualRequest request{};
    bool supported = true;
    if (pin == config::pins::PIN_RELAY_MIST) request.channel = AppChannel::MIST;
    else if (pin == config::pins::PIN_RELAY_FAN) request.channel = AppChannel::FAN;
    else if (pin == config::pins::PIN_RELAY_LAMP) request.channel = AppChannel::LAMP;
    else if (pin == config::pins::PIN_RELAY_HWAT) request.channel = AppChannel::HWAT;
    else supported = false;
    if (!supported) return false;
    request.intent = activate ? AppIntent::FORCE_ON : AppIntent::FORCE_OFF;
    request.request_ms = millis();
    request.source = ManualRequestSource::Remote;
    ControlEvent event{};
    event.type = ControlEventType::ManualRequest;
    event.manual = request;
    event.received_ms = request.request_ms;
    return enqueueControlEvent(event);
}

bool MqttManager::resolveManualAck(const ManualAck& ack)
{
    if (!last_cmd_.active || !last_cmd_.pending ||
        last_cmd_.channel != static_cast<uint8_t>(ack.channel)) {
        return true;
    }
    if (!client_.connected()) {
        return false;
    }

    const uint32_t latency_ms = millis() - last_cmd_.started_ms;
    const bool accepted = ack.decision == ManualDecision::Accepted;
    const bool actual_on = accepted && ack.effective_intent == AppIntent::FORCE_ON;
    if (accepted) {
        const bool published = publishCommandAck(last_cmd_.id, "SUCCESS", latency_ms, last_cmd_.relay_id,
                                                 actual_on, nullptr, nullptr);
        if (published) {
            last_cmd_.pending = false;
            last_cmd_.actual_state_bits = actual_on ? 1U : 0U;
        }
        return published;
    }

    const char* error_code = "SAFETY_REJECTED";
    const char* error_message = "Core 1 safety gate rejected the relay request";
    if (ack.decision == ManualDecision::RejectedTemp) {
        error_code = "TEMPERATURE_LIMIT";
        error_message = "Lamp request rejected by temperature safety limit";
    } else if (ack.decision == ManualDecision::RejectedHumi) {
        error_code = "HUMIDITY_LIMIT";
        error_message = "Mist request rejected by humidity safety limit";
    } else if (ack.decision == ManualDecision::RejectedBlackout) {
        error_code = "BLACKOUT_ACTIVE";
        error_message = "Request rejected during the biosafety blackout window";
    } else if (ack.decision == ManualDecision::RejectedNAN) {
        error_code = "SENSOR_INVALID";
        error_message = "Request rejected because required sensor data is invalid";
    }
    const bool published = publishCommandAck(last_cmd_.id, "FAILED", latency_ms, last_cmd_.relay_id,
                                             false, error_code, error_message);
    if (published) {
        last_cmd_.pending = false;
        last_cmd_.actual_state_bits = 0U;
    }
    return published;
}

void MqttManager::recordProcessedCommand(String command_id, uint32_t latency_ms,
                                         const char* relay_id, bool relay_on)
{
    memset(&last_cmd_, 0, sizeof(last_cmd_));
    strncpy(last_cmd_.id, command_id.c_str(), sizeof(last_cmd_.id) - 1);
    strncpy(last_cmd_.relay_id, relay_id, sizeof(last_cmd_.relay_id) - 1);
    last_cmd_.active = true;
    last_cmd_.actual_state_bits = relay_on ? 1U : 0U;
    (void)latency_ms;
}

void MqttManager::replayDuplicateAck(const char* command_id, uint32_t latency_ms)
{
    const bool on = (last_cmd_.actual_state_bits & 1U) != 0;
    publishCommandAck(const_cast<char*>(command_id), "SUCCESS", latency_ms,
                      last_cmd_.relay_id, on, nullptr, nullptr);
}

bool MqttManager::publishConfigAck(const char* command_id, const char* status,
                                       uint32_t latency_ms, const char* kind,
                                       uint32_t config_revision, uint16_t checkpoint_count,
                                       const char* error_code, const char* error_message)
{
    if (!client_.connected()) return false;
    StaticJsonDocument<512> doc;
    doc["$schema"] = "https://iot.acme.com/schema/v1/command-ack";
    doc["command_id"] = command_id == nullptr ? "" : command_id;
    doc["device_id"] = device_id_;
    doc["status"] = status;
    doc["latency_ms"] = latency_ms;
    if (error_code == nullptr) {
        JsonObject result = doc.createNestedObject("result");
        result["kind"] = kind;
        result["config_revision"] = config_revision;
        if (checkpoint_count > 0) result["checkpoint_count"] = checkpoint_count;
        result["accepted"] = true;
        doc["error"] = nullptr;
    } else {
        doc["result"] = nullptr;
        JsonObject error = doc.createNestedObject("error");
        error["code"] = error_code;
        error["message"] = error_message == nullptr ? "Command failed" : error_message;
        error["retry_eligible"] = false;
    }
    String payload;
    serializeJson(doc, payload);
    const String topic = tenant_ + "/esp32/" + device_id_ + "/up/command/ack";
    return client_.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishCommandAck(char* command_id, const char* status,
                                    uint32_t latency_ms, const char* relay_id,
                                    bool relay_on, const char* error_code,
                                    const char* error_message)
{
    if (!client_.connected()) return false;
    StaticJsonDocument<512> doc;
    doc["$schema"] = "https://iot.acme.com/schema/v1/command-ack";
    doc["command_id"] = command_id == nullptr ? "" : command_id;
    doc["device_id"] = device_id_;
    doc["status"] = status;
    doc["latency_ms"] = latency_ms;
    doc["executed_at_utc"] = nullptr;
    doc["ack_timestamp_utc"] = nullptr;
    if (error_code == nullptr) {
        JsonObject result = doc.createNestedObject("result");
        result["relay_id"] = relay_id;
        result["actual_state"] = boolState(relay_on);
        result["confirmation"] = "GPIO_READBACK";
        doc["error"] = nullptr;
    } else {
        doc["result"] = nullptr;
        JsonObject error = doc.createNestedObject("error");
        error["code"] = error_code;
        error["message"] = error_message == nullptr ? "Command failed" : error_message;
        error["retry_eligible"] = sameText(error_code, "CONTROL_QUEUE_FULL");
    }
    String payload;
    serializeJson(doc, payload);
    const String topic = tenant_ + "/esp32/" + device_id_ + "/up/command/ack";
    return client_.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishManualAck(const ManualAck& ack)
{
    if (!provisioned_ || !client_.connected()) {
        return false;
    }

    StaticJsonDocument<384> doc;
    doc["$schema"] = "https://iot.acme.com/schema/v1/manual-ack";
    doc["device_id"] = device_id_;
    doc["channel"] = static_cast<uint8_t>(ack.channel);
    doc["requested_intent"] = static_cast<uint8_t>(ack.requested_intent);
    doc["decision"] = static_cast<uint8_t>(ack.decision);
    doc["effective_intent"] = static_cast<uint8_t>(ack.effective_intent);
    doc["release_reason"] = static_cast<uint8_t>(ack.release_reason);
    doc["time_confidence"] = static_cast<uint8_t>(ack.time_confidence);
    doc["expires_ms"] = ack.expires_ms;
    doc["ack_ms"] = ack.ack_ms;

    String payload;
    serializeJson(doc, payload);
    const String topic = tenant_ + "/esp32/" + device_id_ + "/up/manual/ack";
    // PubSubClient publishes non-retained messages at its supported outbound QoS.
    return client_.publish(topic.c_str(), payload.c_str());
}

bool MqttManager::publishTelemetrySnapshot(const TelemetryData& telemetry, unsigned long now_ms)
{
    const unsigned long interval_ms = static_cast<unsigned long>(telemetry_interval_sec_) * 1000UL;
    if (last_telemetry_due_ != 0 && now_ms - last_telemetry_due_ < interval_ms) {
        return false;
    }
    return publishTelemetrySnapshotNow(telemetry, now_ms);
}

bool MqttManager::publishTelemetrySnapshotNow(const TelemetryData& telemetry, unsigned long now_ms)
{
    if (!provisioned_ || !client_.connected()) {
        return false;
    }

    StaticJsonDocument<768> doc;
    buildTelemetryPayload(doc.to<JsonObject>(), telemetry);
    String payload;
    serializeJson(doc, payload);
    if (!publishTelemetry(payload)) {
        return false; // explicitly no offline buffering
    }
    last_telemetry_due_ = now_ms;
    return true;
}

void MqttManager::processNetworkMessage(const NetworkMessage& message)
{
    String topic;
    if (message.type == CommandType::BOOTSTRAP_RESPONSE) {
        topic = tenant_ + "/provision/response/" + bootstrap_mac_;
    } else if (message.type == CommandType::DEVICE_COMMAND) {
        topic = tenant_ + "/esp32/" + device_id_ + "/down/command";
    } else {
        return;
    }
    onMessage(const_cast<char*>(topic.c_str()),
              reinterpret_cast<uint8_t*>(const_cast<char*>(message.payload)),
              strlen(message.payload));
}

bool MqttManager::isConnected() { return client_.connected(); }
MqttState MqttManager::getState() const { return state_; }
uint16_t MqttManager::getTelemetryIntervalSec() const { return telemetry_interval_sec_; }
const char* MqttManager::getTenant() const { return tenant_.c_str(); }
const char* MqttManager::getDeviceId() const { return device_id_.c_str(); }
uint8_t MqttManager::getReportingQos() const { return reporting_qos_; }

String MqttManager::resolveClientId() const
{
    return config::network::MQTT_CLIENT_ID_VAL.length() > 0
               ? config::network::MQTT_CLIENT_ID_VAL
               : config::network::resolve_device_identity();
}

} // namespace mqtt
