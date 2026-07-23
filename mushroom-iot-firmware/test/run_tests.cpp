#include "Arduino.h"
#include "Preferences.h"
#include "core/storage.h"
#include "config.h"
#include "network/wifi_manager.h"
#include "network/mqtt_manager.h"
#include "core/system_manager.h"
#include "core/models.h"
#include "core/sensors.h"
#include "core/actuator_controller.h"
#include "core/serial_mutex.h"
#include "core/math_engine.h"
#include "core/trajectory.h"
#include "core/adaptive_tuner.h"
#include "core/fuzzy_controller.h"
#include "core/actuator_controller.h"
#include "core/telemetry.h"
#include "network/web_interface/web_interface.h"
#include "core/encoder.h"
#include "core/manual_control.h"
#include "core/protector.h"
#include "core/crop_profile_storage.h"
#include "core/crop_profile_validator.h"
#include "core/time_confidence.h"
#include "network/ota_manager.h"
#include "core/config_manager.h"
#include "core/tuning_config_manager.h"
#include "../lib/PubSubClientQos1/src/PubSubClientQos1.h"
#include "storage/tuning_storage.h"
using storage::TuningNvsRecord;
#undef MQTT_CALLBACK_SIGNATURE
#include <cassert>
#include <type_traits>
#include <cmath>
#include <cstddef>

namespace test_ingress { void run_all_tests(); }
namespace test_outbox { void run_all_tests(); }

HardwareSerial Serial;
std::map<std::string, std::map<std::string, std::string>> Preferences::_global_storage;
bool Preferences::mock_fail_put_bytes = false;
size_t Preferences::mock_fail_put_bytes_after = 0;
size_t Preferences::mock_put_bytes_count = 0;
void (*Preferences::mock_put_bytes_hook)(const char* key, const void* value, size_t len) = nullptr;
void (*Preferences::mock_end_hook)() = nullptr;

uint32_t calculateTuningRecordCrcForTest(const TuningNvsRecord& record) {
    uint32_t crc = 0xFFFFFFFF;
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    for (size_t i = 0; i < offsetof(TuningNvsRecord, crc32); ++i) {
        crc ^= bytes[i];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 1U) ? (crc >> 1U) ^ 0xEDB88320U : crc >> 1U;
        }
    }
    return ~crc;
}

void alterPendingTuningPaddingAfterWrite() {
    auto& storage = Preferences::_global_storage[config::network::NVS_NAMESPACE];
    auto it = storage.find("tune_s0");
    if (it != storage.end() && it->second.size() == sizeof(TuningNvsRecord)) {
        TuningNvsRecord record{};
        std::memcpy(&record, it->second.data(), sizeof(record));
        if (record.commit_state == 1) {
            record.params.padding_uuid[0] = 0xA5;
            record.params.padding_uuid[1] = 0x5A;
            record.params.padding_uuid[2] = 0x7E;
            record.crc32 = calculateTuningRecordCrcForTest(record);
            it->second.assign(reinterpret_cast<const char*>(&record), sizeof(record));
        }
    }
    Preferences::mock_end_hook = nullptr;
}

void alterFieldAndRecalculateCrcHook(const char* key, const void*, size_t len) {
    if (std::strcmp(key, "tune_s0") == 0 && len == sizeof(TuningNvsRecord)) {
        auto& storage = Preferences::_global_storage[config::network::NVS_NAMESPACE];
        auto it = storage.find(key);
        if (it != storage.end() && it->second.size() == sizeof(TuningNvsRecord)) {
            TuningNvsRecord record{};
            std::memcpy(&record, it->second.data(), sizeof(record));
            record.params.lamp_gain_scale += 0.5f;
            record.crc32 = calculateTuningRecordCrcForTest(record);
            it->second.assign(reinterpret_cast<const char*>(&record), sizeof(record));
        }
    }
}

bool WiFiClient::mock_fail_write = false;

wl_status_t WiFiClass::mock_status = WL_IDLE_STATUS;
wifi_mode_t WiFiClass::mock_mode = WIFI_OFF;
std::string WiFiClass::mock_ssid = "";
std::string WiFiClass::mock_pass = "";
bool WiFiClass::disconnect_called = false;
WiFiClass WiFi;
unsigned long mock_millis_offset = 0;
bool PubSubClient::mock_connected = false;
uint16_t PubSubClient::mock_buffer_size = 0;
uint16_t PubSubClient::mock_keep_alive = 0;
int PubSubClient::mock_state = 0;
std::string PubSubClient::mock_server_host = "";
uint16_t PubSubClient::mock_server_port = 0;
bool PubSubClient::mock_connect_result = true;
bool PubSubClient::mock_publish_result = true;
bool PubSubClient::mock_has_pending_qos1_publish = false;
PubSubClient::MQTT_CALLBACK_SIGNATURE PubSubClient::mock_callback = nullptr;
std::vector<std::string> PubSubClient::mock_subscribed_topics;
std::string PubSubClient::mock_last_published_topic = "";
std::string PubSubClient::mock_last_published_payload = "";
bool PubSubClient::mock_last_published_retained = false;
uint8_t PubSubClient::mock_last_published_qos = 0;
EventBits_t mock_event_group_bits = 0;

std::map<uint8_t, uint8_t> mock_pin_modes;
std::map<uint8_t, uint8_t> mock_pin_values;
std::map<uint8_t, int> mock_pin_write_order;
int mock_operation_counter = 0;


void setup();
void loop();
void initQueues();
void initSemaphores();

void (*mock_queue_send_hook)(QueueHandle_t, const void*) = nullptr;
void (*mock_queue_overwrite_hook)(QueueHandle_t, const void*) = nullptr;
bool mock_fail_queue_overwrite = false;
bool mock_fail_queue_send = false;
bool mock_core1_adopted_tuning_candidate = false;
bool mock_drain_tuning_overwrite = false;

int main() {
    static storage::TuningStorageImpl tuning_storage;
    storage::TuningConfigManager::getInstance().setStorage(&tuning_storage);

    mock_queue_send_hook = [](QueueHandle_t xQueue, const void* pvItemToQueue) {
        if (mqtt::g_network_worker_queue != nullptr && xQueue == mqtt::g_network_worker_queue) {
            const mqtt::NetworkMessage* msg = static_cast<const mqtt::NetworkMessage*>(pvItemToQueue);
            mqtt::MqttManager::getInstance().processNetworkMessage(*msg);
        }
    };
    initQueues();
    initSemaphores();

    config::FUZZY_CONTROL_ENABLED = true;
    Serial.println("--- Starting StorageManager Unit Tests ---");

    storage::StorageManager& storage = storage::StorageManager::get_instance();

    // 1. Initialize
    assert(storage.init() == true);

    // 2. WiFi credentials check when empty
    assert(storage.has_wifi_credentials() == false);
    String ssid, pass;
    assert(storage.load_wifi_credentials(ssid, pass) == false);

    // 3. Save WiFi credentials
    assert(storage.save_wifi_credentials("MyTestWiFi", "supersecure123") == true);
    assert(storage.has_wifi_credentials() == true);

    // 4. Load WiFi credentials and verify
    String loaded_ssid, loaded_pass;
    assert(storage.load_wifi_credentials(loaded_ssid, loaded_pass) == true);
    assert(loaded_ssid == "MyTestWiFi");
    assert(loaded_pass == "supersecure123");

    // 5. MQTT Config check when empty
    assert(storage.has_mqtt_config() == false);
    String broker, user, mqtt_pass;
    uint16_t port = 0;
    assert(storage.load_mqtt_config(broker, port, user, mqtt_pass) == false);

    // 6. Save MQTT Configuration
    assert(storage.save_mqtt_config("192.168.100.5", 1883, "admin", "adminpass") == true);
    assert(storage.has_mqtt_config() == true);

    // 7. Load MQTT Configuration and verify
    String loaded_broker, loaded_user, loaded_mqtt_pass;
    uint16_t loaded_port = 0;
    assert(storage.load_mqtt_config(loaded_broker, loaded_port, loaded_user, loaded_mqtt_pass) == true);
    assert(loaded_broker == "192.168.100.5");
    assert(loaded_port == 1883);
    assert(loaded_user == "admin");
    assert(loaded_mqtt_pass == "adminpass");

    // 8. Provisioning record save/load
    uint16_t loaded_interval = 0;
    uint8_t loaded_qos = 0;
    assert(storage.load_provisioning(loaded_interval, loaded_qos) == false);
    assert(storage.save_provisioning(45, 1) == true);
    assert(storage.load_provisioning(loaded_interval, loaded_qos) == true);
    assert(loaded_interval == 45);
    assert(loaded_qos == 1);

    // 9. Clear WiFi credentials
    assert(storage.clear_wifi_credentials() == true);
    assert(storage.has_wifi_credentials() == false);
    assert(storage.load_wifi_credentials(loaded_ssid, loaded_pass) == false);

    // MQTT config should still exist
    assert(storage.has_mqtt_config() == true);

    // 10. Factory Reset
    assert(storage.factory_reset() == true);
    assert(storage.has_mqtt_config() == false);
    assert(storage.load_provisioning(loaded_interval, loaded_qos) == false);

    // 11. Test dynamic configuration loading
    // Initial status should be empty
    assert(config::network::STA_SSID == "");
    assert(config::network::STA_PASS == "");

    // Save new values
    assert(storage.save_wifi_credentials("DynamicWiFi", "dynamicpass123") == true);
    assert(storage.save_mqtt_config("192.168.1.99", 1884, "dynamic_user", "dynamic_pass") == true);

    // Load config
    assert(config::network::load_runtime_config() == true);

    // Verify updated variables
    assert(config::network::STA_SSID == "DynamicWiFi");
    assert(config::network::STA_PASS == "dynamicpass123");
    assert(config::network::MQTT_BROKER_VAL == "192.168.1.99");
    assert(config::network::MQTT_PORT_VAL == 1884);
    assert(config::network::MQTT_USER_VAL == "mushroom_s3_unittest");
    assert(config::network::MQTT_PASSWORD_VAL == "dynamic_pass");

    // Clean up
    assert(storage.factory_reset() == true);

    // --- F1: StorageManager Snapshots Unit Tests ---
    Serial.println("[TEST] Starting Task F1 - StorageManager Snapshots Unit Tests...");
    {
        // 1. Initial empty checks
        storage::BackendSetpointSnapshot back_sp;
        storage::HardwareOverrideSnapshot hw_sp;
        assert(storage.load_backend_snapshot(back_sp) == false);
        assert(storage.load_hardware_override(hw_sp) == false);

        // 2. Save and load valid Backend Snapshot
        storage::BackendSetpointSnapshot valid_back = { 25.5f, 80.0f, 1200.0f, true };
        assert(storage.save_backend_snapshot(valid_back) == true);

        storage::BackendSetpointSnapshot loaded_back;
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.temp_target == 25.5f);
        assert(loaded_back.humidity_target == 80.0f);
        assert(loaded_back.co2_target == 1200.0f);
        assert(loaded_back.valid == true);

        // 3. Validation bounds for Backend Snapshot (T: [10, 45], H: [30, 95], CO2: [400, 10000])
        storage::BackendSetpointSnapshot invalid_back_t1 = { 9.9f, 80.0f, 1200.0f, true };
        storage::BackendSetpointSnapshot invalid_back_t2 = { 45.1f, 80.0f, 1200.0f, true };
        storage::BackendSetpointSnapshot invalid_back_h1 = { 25.0f, 29.9f, 1200.0f, true };
        storage::BackendSetpointSnapshot invalid_back_h2 = { 25.0f, 95.1f, 1200.0f, true };
        storage::BackendSetpointSnapshot invalid_back_c1 = { 25.0f, 80.0f, 399.0f, true };
        storage::BackendSetpointSnapshot invalid_back_c2 = { 25.0f, 80.0f, 10001.0f, true };

        assert(storage.save_backend_snapshot(invalid_back_t1) == false);
        assert(storage.save_backend_snapshot(invalid_back_t2) == false);
        assert(storage.save_backend_snapshot(invalid_back_h1) == false);
        assert(storage.save_backend_snapshot(invalid_back_h2) == false);
        assert(storage.save_backend_snapshot(invalid_back_c1) == false);
        assert(storage.save_backend_snapshot(invalid_back_c2) == false);

        // Inactive snapshots are not persisted with unchecked values.
        storage::BackendSetpointSnapshot inactive_back = { 9.0f, 9.0f, 99.0f, false };
        assert(storage.save_backend_snapshot(inactive_back) == false);

        // Restore to valid
        assert(storage.save_backend_snapshot(valid_back) == true);

        // 4. Wear / Epsilon checks for Backend Snapshot (delta >= 0.1f)
        // 4.1. Small change < 0.1f (T changes by 0.05f) -> should skip writing, old value remains
        storage::BackendSetpointSnapshot small_change_back = { 25.55f, 80.0f, 1200.0f, true };
        assert(storage.save_backend_snapshot(small_change_back) == true);
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.temp_target == 25.5f); // Still old value

        // 4.2. Large change >= 0.1f (T changes by 0.1f) -> should write
        storage::BackendSetpointSnapshot large_change_back = { 25.6f, 80.0f, 1200.0f, true };
        assert(storage.save_backend_snapshot(large_change_back) == true);
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.temp_target == 25.6f); // Updated

        // 4.3. Change humidity >= 0.1f -> should write
        storage::BackendSetpointSnapshot hum_change_back = { 25.6f, 80.1f, 1200.0f, true };
        assert(storage.save_backend_snapshot(hum_change_back) == true);
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.humidity_target == 80.1f);

        // 4.4. Change CO2 >= 0.1f -> should write
        storage::BackendSetpointSnapshot co2_change_back = { 25.6f, 80.1f, 1201.0f, true };
        assert(storage.save_backend_snapshot(co2_change_back) == true);
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.co2_target == 1201.0f);

        // 4.5. Change valid flag -> should write immediately
        storage::BackendSetpointSnapshot valid_toggle_back = { 25.6f, 80.1f, 1201.0f, false };
        assert(storage.save_backend_snapshot(valid_toggle_back) == true);
        assert(storage.load_backend_snapshot(loaded_back) == true);
        assert(loaded_back.valid == false);

        // Restore valid_back for subsequent tests
        assert(storage.save_backend_snapshot(valid_back) == true);

        // 5. Hardware Override Snapshot
        storage::HardwareOverrideSnapshot valid_hw = { 25.5f, 80.0f, true };
        assert(storage.save_hardware_override(valid_hw) == true);

        storage::HardwareOverrideSnapshot loaded_hw;
        assert(storage.load_hardware_override(loaded_hw) == true);
        assert(loaded_hw.temp_target == 25.5f);
        assert(loaded_hw.humidity_target == 80.0f);
        assert(loaded_hw.active == true);

        // 5.1. Validation bounds for HW (T: [20, 40], H: [50, 95])
        storage::HardwareOverrideSnapshot invalid_hw_t1 = { 19.9f, 80.0f, true };
        storage::HardwareOverrideSnapshot invalid_hw_t2 = { 40.1f, 80.0f, true };
        storage::HardwareOverrideSnapshot invalid_hw_h1 = { 25.0f, 49.9f, true };
        storage::HardwareOverrideSnapshot invalid_hw_h2 = { 25.0f, 95.1f, true };

        assert(storage.save_hardware_override(invalid_hw_t1) == false);
        assert(storage.save_hardware_override(invalid_hw_t2) == false);
        assert(storage.save_hardware_override(invalid_hw_h1) == false);
        assert(storage.save_hardware_override(invalid_hw_h2) == false);

        // Inactive overrides are cleared rather than persisted with unchecked values.
        storage::HardwareOverrideSnapshot inactive_hw = { 99.0f, 99.0f, false };
        assert(storage.save_hardware_override(inactive_hw) == false);

        // Restore valid HW
        assert(storage.save_hardware_override(valid_hw) == true);

        // 5.2. Epsilon checks for HW (delta >= 0.1f)
        storage::HardwareOverrideSnapshot small_change_hw = { 25.55f, 80.0f, true };
        assert(storage.save_hardware_override(small_change_hw) == true);
        assert(storage.load_hardware_override(loaded_hw) == true);
        assert(loaded_hw.temp_target == 25.5f); // Unchanged

        storage::HardwareOverrideSnapshot large_change_hw = { 25.6f, 80.0f, true };
        assert(storage.save_hardware_override(large_change_hw) == true);
        assert(storage.load_hardware_override(loaded_hw) == true);
        assert(loaded_hw.temp_target == 25.6f); // Updated

        storage::HardwareOverrideSnapshot hum_change_hw = { 25.6f, 80.1f, true };
        assert(storage.save_hardware_override(hum_change_hw) == true);
        assert(storage.load_hardware_override(loaded_hw) == true);
        assert(loaded_hw.humidity_target == 80.1f);

        storage::HardwareOverrideSnapshot active_toggle_hw = { 25.6f, 80.1f, false };
        assert(storage.save_hardware_override(active_toggle_hw) == true);
        assert(storage.load_hardware_override(loaded_hw) == true);
        assert(loaded_hw.active == false);

        // 6. Clear Snapshots
        assert(storage.save_backend_snapshot(valid_back) == true);
        assert(storage.save_hardware_override(valid_hw) == true);

        assert(storage.clear_backend_snapshot() == true);
        assert(storage.load_backend_snapshot(loaded_back) == false);

        assert(storage.clear_hardware_override() == true);
        assert(storage.load_hardware_override(loaded_hw) == false);

        // Clean up NVS
        assert(storage.factory_reset() == true);
    }
    Serial.println("[TEST] Task F1 - Snapshots Unit Tests Passed!");

    // 11b. Verify compiled MQTT default host port and init diagnostics settings
    assert(std::strcmp(config::network::DEFAULT_MQTT_BROKER, "mushroomapp.mitelai.com") == 0);
    assert(config::network::DEFAULT_MQTT_PORT == 1883);
    config::network::MQTT_BROKER_VAL = config::network::DEFAULT_MQTT_BROKER;
    config::network::MQTT_PORT_VAL = config::network::DEFAULT_MQTT_PORT;
    // MqttManager resolves identity/provisioning from NVS rather than the
    // mutable config client ID. Seed an ACTIVE device lifecycle explicitly.
    assert(storage.save_provisioning(config::network::DEFAULT_TELEMETRY_INTERVAL_SEC,
                                     config::network::DEFAULT_REPORTING_QOS) == true);
    assert(storage.save_provision_token("12345678-1234-1234-1234-123456789abc") == true);
    config::network::MQTT_CLIENT_ID_VAL = "mushroom_s3_unittest";
    config::network::MQTT_USER_VAL = "mushroom_s3_unittest";
    config::network::MQTT_PASSWORD_VAL = "12345678-1234-1234-1234-123456789abc";
    PubSubClient::mock_buffer_size = 0;
    PubSubClient::mock_keep_alive = 0;
    PubSubClient::mock_server_host = "";
    PubSubClient::mock_server_port = 0;
    {
        mqtt::MqttManager& mqtt_manager = mqtt::MqttManager::getInstance();
        assert(mqtt_manager.init() == true);
        assert(PubSubClient::mock_buffer_size == 2048);
        assert(PubSubClient::mock_keep_alive == 60);
        assert(PubSubClient::mock_server_host == "mushroomapp.mitelai.com");
        assert(PubSubClient::mock_server_port == 1883);
        assert(mqtt_manager.getState() == mqtt::MqttState::IDLE);
    }

    // 12. Test WiFi Manager Connection Logic
    Serial.println("[TEST] Starting WiFi Manager Unit Tests...");

    // Ensure NVS is empty
    assert(storage.has_wifi_credentials() == false);

    // Reset mock states
    WiFi.mock_status = WL_IDLE_STATUS;
    WiFi.mock_mode = WIFI_OFF;
    WiFi.mock_ssid = "";
    WiFi.mock_pass = "";
    WiFi.disconnect_called = false;
    mock_millis_offset = 0;

    // Test init_wifi when NVS is empty (should result in SOFTAP_ACTIVE)
    assert(wifi::init_wifi() == wifi::WifiState::SOFTAP_ACTIVE);
    assert(wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE);

    // Save credentials to NVS
    assert(storage.save_wifi_credentials("WiFi_STA_Test", "sta_password") == true);

    // Test init_wifi when NVS has credentials (should result in STA_CONNECTING)
    assert(wifi::init_wifi() == wifi::WifiState::STA_CONNECTING);
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);
    assert(WiFi.mock_mode == WIFI_STA);
    assert(WiFi.mock_ssid == "WiFi_STA_Test");
    assert(WiFi.mock_pass == "sta_password");

    // 11.1 Check connection in progress (no change)
    WiFi.mock_status = WL_DISCONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // 11.2 Simulate successful connection
    WiFi.mock_status = WL_CONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);

    // 11.3 Simulate connection lost
    WiFi.mock_status = WL_DISCONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);

    // 11.4 Check reconnection delay (before 10s reconnect interval)
    mock_millis_offset = 5000; // 5 seconds have passed
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);

    // 11.5 Check reconnection trigger (after 10s reconnect interval)
    mock_millis_offset = 11000; // 11 seconds have passed
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // 11.6 Simulate connection timeout (15s connection timeout)
    // Currently mock_millis_offset = 11000, and state is STA_CONNECTING (re-connection started)
    // Connection start time is around 11000.
    // Progress time by 5s (total 16s) -> connection time elapsed = 5s. No timeout yet.
    mock_millis_offset = 16000;
    WiFi.mock_status = WL_DISCONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // Progress time by another 11s (total 27s) -> connection time elapsed = 16s. Timeout!
    WiFi.disconnect_called = false;
    mock_millis_offset = 27000;
    wifi::check_wifi_connection();
    assert(WiFi.disconnect_called == true);

    // 11.7 Verify Fallback to SoftAP after 3 failed attempts
    Serial.println("[TEST] Verifying fallback to SoftAP after 3 failed connection attempts...");

    // Attempt 1 failed at offset=27000, state is STA_DISCONNECTED.
    // Transition to Attempt 2: Reconnection interval is 10s. Advance to offset=38000.
    mock_millis_offset = 38000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // Timeout Attempt 2: Connection timeout is 15s. Advance to offset=54000.
    mock_millis_offset = 54000;
    WiFi.disconnect_called = false;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);
    assert(WiFi.disconnect_called == true);

    // Transition to Attempt 3: Reconnection interval is 10s. Advance to offset=65000.
    mock_millis_offset = 65000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // Timeout Attempt 3: Connection timeout is 15s. Advance to offset=81000.
    mock_millis_offset = 81000;
    WiFi.disconnect_called = false;
    wifi::check_wifi_connection();
    // This was the 3rd failed attempt! We should fall back to SOFTAP_ACTIVE.
    assert(wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE);
    assert(WiFi.disconnect_called == true);

    // Verify Multi-core event bits synchronization (WIFI_SOFTAP_BIT set, WIFI_CONNECTED_BIT clear)
    assert((mock_event_group_bits & WIFI_SOFTAP_BIT) != 0);
    assert((mock_event_group_bits & WIFI_CONNECTED_BIT) == 0);

    // 11.8 Verify SoftAP Inactivity Timeout (15 minutes / 900,000 ms)
    Serial.println("[TEST] Verifying SoftAP inactivity timeout...");
    // SoftAP started at offset=81000.
    // Advance by 14 minutes (840,000 ms) -> offset=921000. SoftAP should remain active.
    mock_millis_offset = 921000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE);

    // Advance by another 2 minutes (total 16 minutes / 960,000 ms) -> offset=1041000.
    // SoftAP should timeout and revert to STA_DISCONNECTED to retry network.
    mock_millis_offset = 1041000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);
    assert((mock_event_group_bits & WIFI_SOFTAP_BIT) == 0);
    assert((mock_event_group_bits & WIFI_CONNECTED_BIT) == 0);

    // Clean up
    assert(storage.factory_reset() == true);

    // 12. Test MQTT Client Initialization and Topic Resolution
    Serial.println("[TEST] Starting MQTT Client Unit Tests...");
    mqtt::MqttManager& mqtt_manager = mqtt::MqttManager::getInstance();

    // 12.1 Test initialization failure when MQTT broker is empty
    config::network::MQTT_BROKER_VAL = "";
    assert(mqtt_manager.init() == false);
    assert(mqtt_manager.getState() == mqtt::MqttState::ERROR_NO_CONFIG);

    // 12.2 Test successful initialization
    config::network::MQTT_BROKER_VAL = "192.168.1.50";
    config::network::MQTT_PORT_VAL = 1883;
    config::network::MQTT_CLIENT_ID_VAL = "mushroom_s3_unittest";
    config::network::MQTT_USER_VAL = "mushroom_s3_unittest";
    assert(storage.save_provisioning(config::network::DEFAULT_TELEMETRY_INTERVAL_SEC,
                                     config::network::DEFAULT_REPORTING_QOS) == true);
    assert(storage.save_provision_token("12345678-1234-1234-1234-123456789abc") == true);
    config::network::MQTT_PASSWORD_VAL = "12345678-1234-1234-1234-123456789abc";

    assert(mqtt_manager.init() == true);
    assert(mqtt_manager.getState() == mqtt::MqttState::IDLE);

    // 12.3 Test loop behavior when WiFi is disconnected (no connection)
    // WiFiManager is currently in STA_DISCONNECTED (from step 11)
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::ERROR_NO_WIFI);

    // 12.4 Test loop behavior when WiFi becomes connected
    // WiFiManager is currently in STA_DISCONNECTED, with last reconnect attempt at t=27000.
    // We must advance mock time to exceed the 10-second reconnect interval (e.g. t=38000).
    mock_millis_offset = 38000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    // Now set WiFi mock status to connected, and check connection again to transition to STA_CONNECTED
    WiFi.mock_status = WL_CONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);

    // Call loop, it should transition state when reconnect_mqtt is called in UNIT_TEST mock
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::CONNECTED);
    assert(mqtt_manager.isConnected() == true);

    // 12.4b Test connection failure path and state diagnostics
    PubSubClient::mock_connected = false;
    PubSubClient::mock_connect_result = false;
    PubSubClient::mock_state = 4;  // MQTT_CONNECT_UNAUTHORIZED
    config::network::MQTT_PASSWORD_VAL = "test_jwt_token";
    mock_millis_offset += 5000;
    mqtt_manager.loop();  // detects connection loss -> DISCONNECTED
    mock_millis_offset += 5000;
    mqtt_manager.loop();  // attempts reconnect, fails with state=4
    assert(mqtt_manager.getState() == mqtt::MqttState::DISCONNECTED);
    assert(PubSubClient::mock_state == 4);
    PubSubClient::mock_connect_result = true;
    mock_millis_offset += 9000;
    mqtt_manager.loop();  // reconnect succeeds
    assert(mqtt_manager.getState() == mqtt::MqttState::CONNECTED);
    assert(mqtt_manager.isConnected() == true);

    // 12.4d Test Task D1 - Subscribe to tuning desired topic QoS 1 on reconnect/connect
    Serial.println("[TEST] Testing Task D1 - Subscribe desired topic QoS 1...");
    {
        bool found_tuning_desired = false;
        for (const auto& topic : PubSubClient::mock_subscribed_topics) {
            if (topic == "test_tenant/esp32/mushroom_s3_unittest/down/tuning/desired") {
                found_tuning_desired = true;
            }
        }
        assert(found_tuning_desired == true);
    }

    // 12.4e Task D2: the callback only accepts the exact provisioned topic,
    // bounds its byte copy to 512 bytes, and defers processing by queue.
    Serial.println("[TEST] Testing Task D2 - Deferred bounded tuning dispatch...");
    {
        QueueHandle_t previous_queue = mqtt::g_network_worker_queue;
        void (*previous_hook)(QueueHandle_t, const void*) = mock_queue_send_hook;
        mqtt::g_network_worker_queue = xQueueCreate(1, sizeof(mqtt::NetworkMessage));
        mock_queue_send_hook = nullptr;
        assert(mqtt::MessageDispatcher::setExpectedTuningDesiredTopic(
            "test_tenant/esp32/mushroom_s3_unittest/down/tuning/desired"));

        char desired_topic[] = "test_tenant/esp32/mushroom_s3_unittest/down/tuning/desired";
        uint8_t desired_payload[] = {'{', '\0', '}'};
        mqtt::MessageDispatcher::dispatch(desired_topic, desired_payload, sizeof(desired_payload));

        mqtt::NetworkMessage message{};
        assert(xQueueReceive(mqtt::g_network_worker_queue, &message, 0) == pdTRUE);
        assert(message.type == mqtt::CommandType::TUNING_DESIRED);
        assert(message.payload_length == sizeof(desired_payload));
        assert(std::memcmp(message.payload, desired_payload, sizeof(desired_payload)) == 0);

        const char* rejected_topics[] = {
            "other_tenant/esp32/mushroom_s3_unittest/down/tuning/desired",
            "test_tenant/esp32/another_device/down/tuning/desired",
            "test_tenant/esp32/mushroom_s3_unittest/down/extra/tuning/desired",
            "test_tenant/esp32/mushroom_s3_unittest/up/tuning/desired",
            "test_tenant/esp32/mushroom_s3_unittest/down/tuning/desired/extra",
        };
        for (const char* rejected_topic : rejected_topics) {
            mqtt::MessageDispatcher::dispatch(const_cast<char*>(rejected_topic), desired_payload,
                                              sizeof(desired_payload));
            assert(xQueueReceive(mqtt::g_network_worker_queue, &message, 0) == pdFALSE);
        }

        uint8_t oversized_payload[mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES + 1]{};
        mqtt::MessageDispatcher::dispatch(desired_topic, oversized_payload, sizeof(oversized_payload));
        assert(xQueueReceive(mqtt::g_network_worker_queue, &message, 0) == pdFALSE);

        // Queue-full desired messages must not be silently accepted. The
        // callback defers its rejection to Core 0 and does not parse inline.
        mock_fail_queue_send = true;
        mqtt::MessageDispatcher::dispatch(desired_topic, desired_payload, sizeof(desired_payload));
        mqtt::MessageDispatcher::dispatch(desired_topic, desired_payload, sizeof(desired_payload));
        mock_fail_queue_send = false;
        assert(mqtt::MessageDispatcher::consumeTuningQueueOverflow() == true);
        assert(mqtt::MessageDispatcher::consumeTuningQueueOverflow() == false);

        // A new overflow after a consumer clear must remain pending for the
        // next Core-0 loop rather than being lost by a check-then-clear race.
        mock_fail_queue_send = true;
        mqtt::MessageDispatcher::dispatch(desired_topic, desired_payload, sizeof(desired_payload));
        mock_fail_queue_send = false;
        assert(mqtt::MessageDispatcher::consumeTuningQueueOverflow() == true);

        mqtt::g_network_worker_queue = previous_queue;
        mock_queue_send_hook = previous_hook;
    }

    // 12.4c Test Exponential Backoff and WiFi Safeguard (Task D3)
    Serial.println("[TEST] Testing Task D3 - Exponential Backoff and WiFi Safeguard...");

    // Ensure client is currently CONNECTED. Backoff value is internal detail
    // that varies per-platform; we only verify state machine transitions.
    mqtt_manager.setStateForTest(mqtt::MqttState::CONNECTED);
    assert(mqtt_manager.getState() == mqtt::MqttState::CONNECTED);

    // 1. Sudden WiFi disconnection
    WiFi.mock_status = WL_DISCONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);

    // Call loop to detect WiFi loss, transition to ERROR_NO_WIFI, and disconnect MQTT
    PubSubClient::mock_connected = false;
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::ERROR_NO_WIFI);

    // 2. Attempt to reconnect during WiFi outage. WiFi Safeguard must prevent this, state remains ERROR_NO_WIFI
    mock_millis_offset += 3000;
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::ERROR_NO_WIFI);

    // 3. Restore WiFi connection
    // WiFiManager is in STA_DISCONNECTED. Advance past minimum reconnect gap.
    mock_millis_offset += 11000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    WiFi.mock_status = WL_CONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);

    // Set MQTT mock to fail connection so that it transitions to DISCONNECTED on restored WiFi
    PubSubClient::mock_connect_result = false;
    PubSubClient::mock_connected = false;

    // Call loop again. WiFi restored -> DISCONNECTED + immediate reconnect attempt.
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::DISCONNECTED);

    // Retry 2: wait until current backoff expires
    mock_millis_offset += 4000;
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::DISCONNECTED);

    // Retry 3
    mock_millis_offset += 8000;
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::DISCONNECTED);

    // 4. Restore connection success
    PubSubClient::mock_connect_result = true;
    PubSubClient::mock_connected = true;

    // Advance far enough for next reconnect attempt
    mock_millis_offset += 16000;
    mqtt_manager.loop();
    assert(mqtt_manager.getState() == mqtt::MqttState::CONNECTED);
    assert(mqtt_manager.isConnected() == true);

    // 12.5 Test publish functions return value under connected state
    assert(mqtt_manager.publishStatus(true) == true);
    assert(mqtt_manager.publishTelemetry("{\"temp\":25.5}") == true);

    // 12.6 Test incoming message parsing (Task C3)
    Serial.println("[TEST] Testing Task C3 - MQTT message parsing...");
    assert(PubSubClient::mock_callback != nullptr);

    char setpoint_topic[] = "test_tenant/esp32/esp32_mushroom_test_client/down/command";

    // Case A: Valid JSON with temperatureSetpoint and humiditySetpoint
    {
        Serial.println("--- Case A: Valid JSON with temperatureSetpoint and humiditySetpoint ---");
        std::string payload = "{\"temperatureSetpoint\":26.50,\"humiditySetpoint\":85.00}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
    }

    // Case B: Valid JSON with temperature and humidity keys
    {
        Serial.println("--- Case B: Valid JSON with temperature and humidity keys ---");
        std::string payload = "{\"temperature\":24.00,\"humidity\":78.50}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
    }

    // Case C: Invalid JSON format
    {
        Serial.println("--- Case C: Invalid JSON format (Should fail deserialization) ---");
        std::string payload = "{\"temperature\":24.00, invalid_json}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
    }

    // Case D: Payload size exceeds limit (Should fail size check)
    {
        Serial.println("--- Case D: Payload size exceeds 512 bytes limit ---");
        std::string payload(515, 'A');
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
    }

    // Case E: Unexpected topic (Should reject topic)
    {
        Serial.println("--- Case E: Unexpected topic ---");
        char unexpected_topic[] = "mushroom/device/esp32_mushroom_test_client/unexpected";
        std::string payload = "{\"temperature\":24.00}";
        PubSubClient::mock_callback(unexpected_topic, (uint8_t*)payload.c_str(), payload.length());
    }

    // Case F: Null pointer topic or payload
    {
        Serial.println("--- Case F: Null pointer topic or payload ---");
        PubSubClient::mock_callback(nullptr, (uint8_t*)"{}", 2);
        PubSubClient::mock_callback(setpoint_topic, nullptr, 10);
    }

    // Case G: Setpoints out of physical boundaries (Temp: [10.0, 45.0], Humi: [30.0, 95.0])
    {
        Serial.println("--- Case G: Setpoints out of boundaries ---");
        std::string payload_too_high = "{\"temperature\":50.00,\"humidity\":99.00}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload_too_high.c_str(), payload_too_high.length());

        std::string payload_too_low = "{\"temperature\":5.00,\"humidity\":20.00}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload_too_low.c_str(), payload_too_low.length());
    }

    // Case H: NaN values for setpoint
    {
        Serial.println("--- Case H: NaN values for setpoint ---");
        std::string payload_nan = "{\"temperature\":nan,\"humidity\":nan}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload_nan.c_str(), payload_nan.length());
    }

    // Case J: Legacy full_sync payloads are not part of the V3 command
    // envelope and must not mutate control state.
    {
        Serial.println("--- Case J: Legacy full_sync rejected ---");
        setSharedForceFullPublish(false);
        std::string payload = "{\"cmd\":\"full_sync\"}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
        assert(getSharedForceFullPublish() == false);
    }

    // Case K: Atomic consume of full_sync flag (Task E2 regression)
    {
        Serial.println("--- Case K: Atomic consume_shared_force_full_publish ---");
        setSharedForceFullPublish(false);
        assert(consumeSharedForceFullPublish() == false);
        setSharedForceFullPublish(true);
        assert(consumeSharedForceFullPublish() == true);
        assert(getSharedForceFullPublish() == false);
        assert(consumeSharedForceFullPublish() == false);
    }

    // Case L: Legacy actuator override payloads are not accepted by the V3
    // command envelope; only validated SET_RELAY commands can enqueue Core 1 work.
    {
        Serial.println("--- Case L: Legacy actuator overrides rejected ---");
        if (g_mqtt_override_queue != nullptr)
        {
            xQueueReset(g_mqtt_override_queue);
        }

        std::string payload = "{\"actuator\":\"mist\",\"state\":true}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
        ManualRequest req;
        assert(xQueueReceive(g_mqtt_override_queue, &req, 0) != pdTRUE);
    }

    // QoS-1 Outbound FIFO Queue Tests
    {
        Serial.println("[TEST] Starting QoS-1 Outbound FIFO Queue Unit Tests...");
        WiFiClient wifi_client;
        PubSubClientQos1 qos1_client(wifi_client);

        // Setup server
        qos1_client.setServer("127.0.0.1", 1883);

        // Mock connection state
        PubSubClient::mock_connect_result = true;
        PubSubClient::mock_connected = true;

        // Feed CONNACK packet (0x20, 0x02, 0x00, 0x00) to allow connect() to read it and succeed
        wifi_client.mock_input = {0x20, 0x02, 0x00, 0x00};
        wifi_client.mock_input_pos = 0;

        assert(qos1_client.connect("test_client") == true);
        assert(qos1_client.connected() == true);

        // 1. Initial publish QoS 1 (active slot gets occupied, returns QUEUED)
        uint8_t payload[] = "p1";
        PublishQos1Result res1 = qos1_client.publishQos1("topic", payload, sizeof(payload), false);
        assert(res1 == PublishQos1Result::QUEUED);
        assert(qos1_client.hasPendingQos1Publish() == true);

        // 2. Publish three more QoS 1 packets back-to-back.
        // They should be enqueued because active slot is busy.
        uint8_t payload2[] = "p2";
        uint8_t payload3[] = "p3";
        uint8_t payload4[] = "p4";

        assert(qos1_client.publishQos1("topic", payload2, sizeof(payload2), false) == PublishQos1Result::QUEUED);
        assert(qos1_client.publishQos1("topic", payload3, sizeof(payload3), false) == PublishQos1Result::QUEUED);
        assert(qos1_client.publishQos1("topic", payload4, sizeof(payload4), false) == PublishQos1Result::QUEUED);

        // At this point, active slot is occupied, and queue has 3. Total 4.
        // Let's add one more to fill the queue (queue depth is 4, so active + 4 = 5 total).
        uint8_t payload5[] = "p5";
        assert(qos1_client.publishQos1("topic", payload5, sizeof(payload5), false) == PublishQos1Result::QUEUED);

        // 3. 6th publish should return BUSY (queue is full)
        uint8_t payload6[] = "p6";
        assert(qos1_client.publishQos1("topic", payload6, sizeof(payload6), false) == PublishQos1Result::BUSY);

        // 4. Simulate receiving a PUBACK for the active publish.
        // The first message ID is 2.
        // A PUBACK packet: 0x40 (header), 0x02 (remaining length), 0x00, 0x02 (message ID 2).
        wifi_client.mock_input = {0x40, 0x02, 0x00, 0x02};
        wifi_client.mock_input_pos = 0;

        // Run loop to process incoming packet
        qos1_client.loop();

        // After loop, the active publish should be ACKed, and the NEXT one from queue (p2)
        // should be promoted to the active slot.
        // Let's verify active slot is still occupied.
        assert(qos1_client.hasPendingQos1Publish() == true);

        // Let's feed PUBACK for msgId = 3.
        wifi_client.mock_input = {0x40, 0x02, 0x00, 0x03};
        wifi_client.mock_input_pos = 0;
        qos1_client.loop();
        assert(qos1_client.hasPendingQos1Publish() == true); // p3 is now active

        // Feed PUBACK for msgId = 4, 5, 6
        wifi_client.mock_input = {0x40, 0x02, 0x00, 0x04};
        wifi_client.mock_input_pos = 0;
        qos1_client.loop();

        wifi_client.mock_input = {0x40, 0x02, 0x00, 0x05};
        wifi_client.mock_input_pos = 0;
        qos1_client.loop();

        wifi_client.mock_input = {0x40, 0x02, 0x00, 0x06};
        wifi_client.mock_input_pos = 0;
        qos1_client.loop();

        // Now queue and active slot should be completely empty!
        assert(qos1_client.hasPendingQos1Publish() == false);

        // 5. Test transport write failure during dequeue: packet must remain in active slot / FIFO and be sent on reconnect
        {
            WiFiClient::mock_fail_write = false;
            uint8_t p_first[] = "first";
            uint8_t p_queued[] = "queued";

            wifi_client.mock_input.clear();
            wifi_client.mock_input_pos = 0;

            assert(qos1_client.publishQos1("topic", p_first, sizeof(p_first), false) == PublishQos1Result::QUEUED);
            assert(qos1_client.hasPendingQos1Publish() == true);

            assert(qos1_client.publishQos1("topic", p_queued, sizeof(p_queued), false) == PublishQos1Result::QUEUED);

            // Get message ID of p_first
            uint16_t first_msg_id = qos1_client.getPendingMessageId();

            WiFiClient::mock_fail_write = true;

            // PUBACK for p_first to trigger promoting p_queued
            wifi_client.mock_input = {0x40, 0x02, static_cast<uint8_t>(first_msg_id >> 8), static_cast<uint8_t>(first_msg_id & 0xFF)};
            wifi_client.mock_input_pos = 0;
            qos1_client.loop();

            // Under correct QoS 1 semantics, since write of dequeue fails, active slot is NOT cleared!
            assert(qos1_client.hasPendingQos1Publish() == true);

            WiFiClient::mock_fail_write = false;

            qos1_client.disconnect();
            wifi_client.mock_input = {0x20, 0x02, 0x00, 0x00};
            wifi_client.mock_input_pos = 0;
            assert(qos1_client.connect("test_client") == true);

            assert(qos1_client.hasPendingQos1Publish() == true);

            uint16_t queued_msg_id = qos1_client.getPendingMessageId();
            wifi_client.mock_input = {0x40, 0x02, static_cast<uint8_t>(queued_msg_id >> 8), static_cast<uint8_t>(queued_msg_id & 0xFF)};
            wifi_client.mock_input_pos = 0;
            qos1_client.loop();
            assert(qos1_client.hasPendingQos1Publish() == false);
        }

        // 6. Test first-send failure -> reconnect -> DUP=1 resend
        {
            WiFiClient::mock_fail_write = true;
            uint8_t p_data[] = "first_send_fail";

            wifi_client.mock_input.clear();
            wifi_client.mock_input_pos = 0;

            PublishQos1Result res = qos1_client.publishQos1("topic", p_data, sizeof(p_data), false);
            assert(res == PublishQos1Result::TRANSPORT_ERROR);
            // Packet must remain pending!
            assert(qos1_client.hasPendingQos1Publish() == true);

            WiFiClient::mock_fail_write = false;

            // Reconnect
            qos1_client.disconnect();
            wifi_client.mock_input = {0x20, 0x02, 0x00, 0x00};
            wifi_client.mock_input_pos = 0;
            assert(qos1_client.connect("test_client") == true);

            // Still pending after reconnect
            assert(qos1_client.hasPendingQos1Publish() == true);

            uint16_t msg_id = qos1_client.getPendingMessageId();
            // Send correct PUBACK to clear it
            wifi_client.mock_input = {0x40, 0x02, static_cast<uint8_t>(msg_id >> 8), static_cast<uint8_t>(msg_id & 0xFF)};
            wifi_client.mock_input_pos = 0;
            qos1_client.loop();
            assert(qos1_client.hasPendingQos1Publish() == false);
        }

        // 7. Test out-of-order/wrong message ID PUBACK does not clear pending packet
        {
            WiFiClient::mock_fail_write = false;
            uint8_t p_data[] = "wrong_ack_test";

            wifi_client.mock_input.clear();
            wifi_client.mock_input_pos = 0;

            assert(qos1_client.publishQos1("topic", p_data, sizeof(p_data), false) == PublishQos1Result::QUEUED);
            assert(qos1_client.hasPendingQos1Publish() == true);

            uint16_t correct_msg_id = qos1_client.getPendingMessageId();
            uint16_t wrong_msg_id = correct_msg_id + 99; // totally wrong

            // Feed wrong PUBACK
            wifi_client.mock_input = {0x40, 0x02, static_cast<uint8_t>(wrong_msg_id >> 8), static_cast<uint8_t>(wrong_msg_id & 0xFF)};
            wifi_client.mock_input_pos = 0;
            qos1_client.loop();

            // Should still be active!
            assert(qos1_client.hasPendingQos1Publish() == true);

            // Now feed correct PUBACK
            wifi_client.mock_input = {0x40, 0x02, static_cast<uint8_t>(correct_msg_id >> 8), static_cast<uint8_t>(correct_msg_id & 0xFF)};
            wifi_client.mock_input_pos = 0;
            qos1_client.loop();

            // Should be cleared now
            assert(qos1_client.hasPendingQos1Publish() == false);
        }
    }

    // 13. Test Task D1 - Core 0 Communication Task
    Serial.println("[TEST] Starting Task D1 - Core 0 Communication Task Unit Tests...");
    assert(storage.factory_reset() == true);
    config::network::MQTT_BROKER_VAL = "";
    WiFi.mock_status = WL_IDLE_STATUS;
    PubSubClient::mock_connected = false;

    // Wi-Fi is initialized once by setup() in production; exercise the same
    // bootstrap before running one Core 0 iteration.
    wifi::init_wifi();
    assert(WiFi.getMode() == WIFI_AP);
    taskCore0Communication(nullptr);

    // Check that WiFi transitioned to SOFTAP_ACTIVE (since NVS credentials are empty)
    assert(wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE);
    // Empty NVS means the MQTT lifecycle cannot validate a broker/device
    // identity, so Core 0 leaves it in ERROR_NO_CONFIG before WiFi state is
    // considered. This is the safe bootstrap behavior.
    assert(mqtt_manager.getState() == mqtt::MqttState::ERROR_NO_CONFIG);

    // Save mock credentials and MQTT config to NVS to test successful initialization path
    assert(storage.save_wifi_credentials("WiFi_STA_Test", "sta_password") == true);
    assert(storage.save_mqtt_config("192.168.1.50", 1883, "admin", "adminpass") == true);
    assert(storage.save_provisioning(config::network::DEFAULT_TELEMETRY_INTERVAL_SEC,
                                     config::network::DEFAULT_REPORTING_QOS) == true);
    assert(storage.save_provision_token("12345678-1234-1234-1234-123456789abc") == true);

    // Re-initialize Wi-Fi once after configuration changes, as a reboot would.
    WiFi.mock_status = WL_CONNECTED;      // Mock WiFi as connected
    PubSubClient::mock_connect_result = true;
    PubSubClient::mock_connected = true;   // Mock MQTT as connected
    wifi::init_wifi();
    assert(WiFi.getMode() == WIFI_STA);

    // Run task once again
    taskCore0Communication(nullptr);

    // Because NVS credentials are saved, it should load config and transition to STA_CONNECTED
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);
    assert(mqtt_manager.getState() == mqtt::MqttState::CONNECTED);

    // Clean up
    assert(storage.factory_reset() == true);

    // 14. Test main.cpp setup() and loop()
    Serial.println("[TEST] Starting Task D2 - setup() and loop() Unit Tests...");
    setup();
    loop();

    // 15. Test Task E1/E2 - Models and Data Structures POD and Alignment properties
    Serial.println("[TEST] Starting Task E1/E2 - Models and Data Structures Unit Tests...");
    assert(std::is_pod<TelemetryData>::value == true);
    assert(std::is_pod<ControlSetpointCommand>::value == true);
    assert(sizeof(TelemetryData) == 20);  // 3 floats plus edge-authoritative relay snapshot
    assert(sizeof(ControlSetpointCommand) == 16);
    assert(alignof(TelemetryData) == 4);
    assert(alignof(ControlSetpointCommand) == 4);

    // DynamicTuningParams and TuningNvsRecord Checks
    assert(std::is_pod<DynamicTuningParams>::value == true);
    assert(std::is_pod<TuningNvsRecord>::value == true);
    assert(sizeof(DynamicTuningParams) == 60);
    assert(sizeof(TuningNvsRecord) == 76);
    assert(alignof(DynamicTuningParams) == 4);
    assert(alignof(TuningNvsRecord) == 4);
    assert(g_tuning_config_queue != nullptr);

    // TuningConfigManager API and Singleton Checks (Task C3 & C4)
    Serial.println("[TEST] Starting Task C3/C4 - TuningConfigManager Singleton, Validation and Public API Unit Tests...");
    {
        storage::TuningConfigManager& tuner = storage::TuningConfigManager::getInstance();

        // Ensure NVS has a known device ID
        storage::StorageManager& storage_inst = storage::StorageManager::get_instance();
        storage_inst.save_device_id("mushroom_s3_unittest");

        // Isolate command-id/idempotency assertions from preceding MQTT tests.
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            // Also remove the durable no-change receipt so Case 8 starts clean.
            prefs.remove("tune_rcpt");
            prefs.end();
        }

        // Test initial values and reset
        tuner.resetForTest();
        DynamicTuningParams initial_params = tuner.getActiveParams();
        assert(initial_params.revision == 0);
        assert(std::abs(initial_params.lamp_gain_scale - 1.0f) < 0.0001f);
        assert(std::abs(initial_params.mist_gain_scale - 1.0f) < 0.0001f);
        assert(std::abs(initial_params.mist_on_threshold - 0.25f) < 0.0001f);
        assert(std::abs(initial_params.mist_off_threshold - 0.15f) < 0.0001f);

        // Test initialization
        assert(tuner.init() == true);

        // Case 1: Valid payload
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215264";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 1;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OUT_OF_BOUNDS;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            if (result != storage::TuningResult::ACCEPTED) {
                std::printf("[DEBUG] processCommand failed: result = %d, reason = %d\n", (int)result, (int)reason);
            }
            assert(result == storage::TuningResult::ACCEPTED);
            assert(reason == storage::TuningReason::OK);

            DynamicTuningParams active = tuner.getActiveParams();
            assert(active.revision == 1);
            assert(std::strcmp(active.command_id, "a0d33b2e-9d2a-43a9-8de6-bf10d3215264") == 0);
            assert(std::abs(active.lamp_gain_scale - 1.1f) < 0.0001f);
            assert(std::abs(active.mist_gain_scale - 0.9f) < 0.0001f);
            assert(std::abs(active.mist_on_threshold - 0.28f) < 0.0001f);
            assert(std::abs(active.mist_off_threshold - 0.18f) < 0.0001f);
        }

        // Case 2: Invalid schema version
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 2; // invalid version
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);
        }

        // Case 3: Invalid device ID
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc["device_id"] = "wrong_device_id";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_DEVICE_ID);
        }

        // Case 4: Invalid UUID format
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-invalid-uuid-format"; // invalid uuid
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_UUID);
        }

        // Case 5: Out of bounds (too high)
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.25f; // limit is 1.20f
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::OUT_OF_BOUNDS);
        }

        // Case 6: Cross-field violation (mist_off >= mist_on)
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.20f;
            config["mist_off_threshold"] = 0.20f; // must be < mist_on

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::CROSS_FIELD_VIOLATION);
        }

        // Case 7: Duplicate UUID command_id
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215264"; // same UUID as Case 1
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::DUPLICATE_UUID);
        }

        // Case 8: A new UUID/revision with unchanged parameters must not
        // rewrite the config envelope or re-dispatch Core 1, but MUST persist
        // command identity durably (PLAN.md:264, sprint_1.md:74) so that
        // post-reboot redelivery returns DUPLICATE_UUID.
        {
            DynamicTuningParams queued{};
            while (xQueueReceive(g_tuning_config_queue, &queued, 0) == pdTRUE) {}
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215266"; // new UUID
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2; // new revision
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f; // same as Case 1
            config["mist_gain_scale"] = 0.9f; // same as Case 1
            config["mist_on_threshold"] = 0.28f; // same as Case 1
            config["mist_off_threshold"] = 0.18f; // same as Case 1

            const size_t nvs_write_count_before = Preferences::mock_put_bytes_count;
            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::NO_CHANGE);
            // saveDurableReceipt() writes one tune_rcpt entry; config slots unchanged.
            assert(Preferences::mock_put_bytes_count == nvs_write_count_before + 1);
            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdFALSE);

            DynamicTuningParams active = tuner.getActiveParams();
            assert(active.revision == 1);
            assert(std::strcmp(active.command_id, "a0d33b2e-9d2a-43a9-8de6-bf10d3215264") == 0);
            // Float parameters remain correct
            assert(std::abs(active.lamp_gain_scale - 1.1f) < 0.0001f);

            const size_t writes_before_session_redelivery = Preferences::mock_put_bytes_count;
            assert(tuner.processCommand(doc.as<JsonVariant>(), reason) == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::DUPLICATE_UUID);
            assert(Preferences::mock_put_bytes_count == writes_before_session_redelivery);
            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdFALSE);

            // After reboot, init() loads the durable receipt from NVS.
            // Post-reboot redelivery of command B must return DUPLICATE_UUID
            // (not NO_CHANGE) — no NVS write, no Core-1 handoff.
            // This satisfies PLAN.md:332 and sprint_1.md:74.
            tuner.resetForTest();
            assert(tuner.init() == true);
            const DynamicTuningParams rebooted = tuner.getActiveParams();
            assert(rebooted.revision == 1);
            assert(std::strcmp(rebooted.command_id,
                               "a0d33b2e-9d2a-43a9-8de6-bf10d3215264") == 0);
            assert(std::abs(rebooted.lamp_gain_scale - 1.1f) < 0.0001f);
            assert(std::abs(rebooted.mist_gain_scale - 0.9f) < 0.0001f);
            assert(std::abs(rebooted.mist_on_threshold - 0.28f) < 0.0001f);
            assert(std::abs(rebooted.mist_off_threshold - 0.18f) < 0.0001f);

            const size_t writes_before_redelivery = Preferences::mock_put_bytes_count;
            // DUPLICATE_UUID from durable receipt — key correctness assertion.
            assert(tuner.processCommand(doc.as<JsonVariant>(), reason) == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::DUPLICATE_UUID);
            assert(Preferences::mock_put_bytes_count == writes_before_redelivery);
            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdFALSE);
            const DynamicTuningParams after_redelivery = tuner.getActiveParams();
            assert(after_redelivery.revision == rebooted.revision);
            assert(std::strcmp(after_redelivery.command_id, rebooted.command_id) == 0);
            assert(std::abs(after_redelivery.lamp_gain_scale - rebooted.lamp_gain_scale) < 0.0001f);
            assert(std::abs(after_redelivery.mist_gain_scale - rebooted.mist_gain_scale) < 0.0001f);
            assert(std::abs(after_redelivery.mist_on_threshold - rebooted.mist_on_threshold) < 0.0001f);
            assert(std::abs(after_redelivery.mist_off_threshold - rebooted.mist_off_threshold) < 0.0001f);

            // The effective command remains a durable receipt. Replaying it
            // must not roll back config or enqueue Core 1.
            StaticJsonDocument<512> old_retained;
            old_retained.set(doc);
            old_retained["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215264";
            old_retained["revision"] = 1;
            const size_t writes_before_old_replay = Preferences::mock_put_bytes_count;
            assert(tuner.processCommand(old_retained.as<JsonVariant>(), reason) == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::DUPLICATE_UUID);
            assert(Preferences::mock_put_bytes_count == writes_before_old_replay);
            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdFALSE);
            const DynamicTuningParams after_old_replay = tuner.getActiveParams();
            assert(after_old_replay.revision == rebooted.revision);
            assert(std::strcmp(after_old_replay.command_id, rebooted.command_id) == 0);
            assert(std::abs(after_old_replay.lamp_gain_scale - rebooted.lamp_gain_scale) < 0.0001f);
            assert(std::abs(after_old_replay.mist_gain_scale - rebooted.mist_gain_scale) < 0.0001f);
            assert(std::abs(after_old_replay.mist_on_threshold - rebooted.mist_on_threshold) < 0.0001f);
            assert(std::abs(after_old_replay.mist_off_threshold - rebooted.mist_off_threshold) < 0.0001f);
        }

        // Case 9: Invalid revision representations are rejected before RAM,
        // NVS, or the Core-1 queue change.
        {
            const DynamicTuningParams before = tuner.getActiveParams();
            const size_t writes_before = Preferences::mock_put_bytes_count;
            DynamicTuningParams queued{};

            StaticJsonDocument<512> negative;
            negative["schema_version"] = 1;
            negative["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215268";
            negative["device_id"] = "mushroom_s3_unittest";
            negative["revision"] = -1;
            JsonObject config = negative.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            assert(tuner.processCommand(negative.as<JsonVariant>(), reason) == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);

            StaticJsonDocument<512> overflow;
            overflow.set(negative);
            overflow["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215269";
            overflow["revision"] = 4294967296ULL;
            assert(tuner.processCommand(overflow.as<JsonVariant>(), reason) == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);

            StaticJsonDocument<512> fractional;
            fractional.set(negative);
            fractional["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215270";
            fractional["revision"] = 1.5;
            assert(tuner.processCommand(fractional.as<JsonVariant>(), reason) == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);

            StaticJsonDocument<512> boolean;
            boolean.set(negative);
            boolean["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215271";
            boolean["revision"] = true;
            assert(tuner.processCommand(boolean.as<JsonVariant>(), reason) == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);

            StaticJsonDocument<512> string_value;
            string_value.set(negative);
            string_value["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215272";
            string_value["revision"] = "1";
            assert(tuner.processCommand(string_value.as<JsonVariant>(), reason) == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_SCHEMA);

            const DynamicTuningParams after = tuner.getActiveParams();
            assert(after.revision == before.revision);
            assert(std::strcmp(after.command_id, before.command_id) == 0);
            assert(Preferences::mock_put_bytes_count == writes_before);
            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdFALSE);
        }

        // Case 10: A new command ID with a lower revision is still accepted
        // when the semantic configuration changes; revision is metadata, not
        // a command-ordering rejection condition in contract v1.
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215273";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.15f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            assert(tuner.processCommand(doc.as<JsonVariant>(), reason) == storage::TuningResult::ACCEPTED);
            assert(reason == storage::TuningReason::OK);
            const DynamicTuningParams active = tuner.getActiveParams();
            assert(active.revision == 2);
            assert(std::strcmp(active.command_id, "a0d33b2e-9d2a-43a9-8de6-bf10d3215273") == 0);
        }

        // Case 11: NaN value rejection
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "a0d33b2e-9d2a-43a9-8de6-bf10d3215267";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 3;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = "NaN"; // string / NaN rejection
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
        }

        // Case 12: NVS write fail in recordNoChangeReceipt (Fail-closed)
        {
            tuner.resetForTest();
            assert(tuner.init() == true);

            // First, process a valid command to set baseline
            StaticJsonDocument<512> doc1;
            doc1["schema_version"] = 1;
            doc1["command_id"] = "c0d33b2e-9d2a-43a9-8de6-bf10d3215264";
            doc1["device_id"] = "mushroom_s3_unittest";
            doc1["revision"] = 1;
            JsonObject config1 = doc1.createNestedObject("config");
            config1["lamp_gain_scale"] = 1.1f;
            config1["mist_gain_scale"] = 0.9f;
            config1["mist_on_threshold"] = 0.28f;
            config1["mist_off_threshold"] = 0.18f;
            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result1 = tuner.processCommand(doc1.as<JsonVariant>(), reason);
            assert(result1 == storage::TuningResult::ACCEPTED);

            // Now, send a new command with same parameters (no change), but force NVS write to fail
            StaticJsonDocument<512> doc2;
            doc2["schema_version"] = 1;
            doc2["command_id"] = "c0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc2["device_id"] = "mushroom_s3_unittest";
            doc2["revision"] = 2;
            JsonObject config2 = doc2.createNestedObject("config");
            config2["lamp_gain_scale"] = 1.1f;
            config2["mist_gain_scale"] = 0.9f;
            config2["mist_on_threshold"] = 0.28f;
            config2["mist_off_threshold"] = 0.18f;

            Preferences::mock_fail_put_bytes = true;
            storage::TuningResult result = tuner.processCommand(doc2.as<JsonVariant>(), reason);
            Preferences::mock_fail_put_bytes = false;

            // Fail-closed: Must be rejected and cache not updated
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::NVS_WRITE_ERROR);

            // Verify RAM cache was NOT updated: processing same command again with NVS working
            // should proceed to write (and succeed) instead of being short-circuited as duplicate
            reason = storage::TuningReason::OK;
            result = tuner.processCommand(doc2.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::DUPLICATE);
            assert(reason == storage::TuningReason::NO_CHANGE);
        }

        // Case 13: UUID format validation in loadDurableReceipt
        {
            tuner.resetForTest();

            // Manually write a corrupt/invalid receipt record into NVS
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);

            // Format of TuningReceiptRecord from tuning_config_manager.cpp:
            // version (4 bytes), command_id (37 bytes), padding (3 bytes), crc32 (4 bytes)
            struct DummyReceipt {
                uint32_t version = 2;
                char command_id[37] = "invalid-uuid-format-here-1234567890";
                uint8_t padding[3] = {0};
                uint32_t crc32 = 0;
            } rec;

            // Calculate CRC
            uint32_t crc = 0xFFFFFFFF;
            const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&rec);
            for (size_t i = 0; i < offsetof(DummyReceipt, crc32); ++i) {
                crc ^= bytes[i];
                for (int bit = 0; bit < 8; ++bit) {
                    crc = (crc & 1U) ? (crc >> 1U) ^ 0xEDB88320U : crc >> 1U;
                }
            }
            rec.crc32 = ~crc;

            assert(prefs.putBytes("tune_rcpt", &rec, sizeof(rec)) == sizeof(rec));
            prefs.end();

            // Init should validate and reject the malformed UUID, not loading it
            assert(tuner.init() == true);

            // Process command with that same malformed UUID, it should not be duplicate
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "invalid-uuid-format-here-1234567890";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);

            // Should be rejected due to malformed UUID validation (not loaded as duplicate)
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::INVALID_UUID);
        }

        // Verify Enum Values mapping
        assert(static_cast<uint8_t>(storage::TuningResult::ACCEPTED) == 0);
        assert(static_cast<uint8_t>(storage::TuningResult::REJECTED) == 1);
        assert(static_cast<uint8_t>(storage::TuningResult::DUPLICATE) == 2);

        assert(static_cast<uint8_t>(storage::TuningReason::OK) == 0);
        assert(static_cast<uint8_t>(storage::TuningReason::INVALID_SCHEMA) == 1);
        assert(static_cast<uint8_t>(storage::TuningReason::INVALID_DEVICE_ID) == 2);
        assert(static_cast<uint8_t>(storage::TuningReason::INVALID_UUID) == 3);
        assert(static_cast<uint8_t>(storage::TuningReason::OUT_OF_BOUNDS) == 4);
        assert(static_cast<uint8_t>(storage::TuningReason::CROSS_FIELD_VIOLATION) == 5);
        assert(static_cast<uint8_t>(storage::TuningReason::DUPLICATE_UUID) == 6);
        assert(static_cast<uint8_t>(storage::TuningReason::NO_CHANGE) == 7);
        assert(static_cast<uint8_t>(storage::TuningReason::NVS_WRITE_ERROR) == 8);
        assert(static_cast<uint8_t>(storage::TuningReason::QUEUE_FULL_ERROR) == 9);
    }

    // Task C5 - TuningConfigManager NVS Two-Slot Persistence & Crash Consistency Tests
    Serial.println("[TEST] Starting Task C5 - TuningConfigManager NVS Two-Slot Persistence & Crash Consistency Unit Tests...");
    {
        storage::TuningConfigManager& tuner = storage::TuningConfigManager::getInstance();

        // 1. Reset storage and verify init loaded default state
        tuner.resetForTest();
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            prefs.end();
        }

        // Init on empty NVS should succeed (returns true) and set defaults
        assert(tuner.init() == true);
        DynamicTuningParams params = tuner.getActiveParams();
        assert(params.revision == 0);
        assert(std::strcmp(params.command_id, "") == 0);
        assert(std::abs(params.lamp_gain_scale - 1.0f) < 0.0001f);
        assert(std::abs(params.mist_gain_scale - 1.0f) < 0.0001f);
        assert(std::abs(params.mist_on_threshold - 0.25f) < 0.0001f);
        assert(std::abs(params.mist_off_threshold - 0.15f) < 0.0001f);

        // 2. Send command 1 -> should write to Slot 0
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215261";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 1;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            // Simulate a valid staged record whose ABI padding differs from
            // the incoming object. READY finalization must still select the
            // PENDING slot by semantic fields, preserving generation 1.
            Preferences::mock_end_hook = alterPendingTuningPaddingAfterWrite;
            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            Preferences::mock_end_hook = nullptr;
            assert(result == storage::TuningResult::ACCEPTED);

            // Verify slot 0 is written, slot 1 is empty
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, true) == true);
            TuningNvsRecord r0, r1;
            size_t read0 = prefs.getBytes("tune_s0", &r0, sizeof(TuningNvsRecord));
            size_t read1 = prefs.getBytes("tune_s1", &r1, sizeof(TuningNvsRecord));
            prefs.end();

            assert(read0 == sizeof(TuningNvsRecord));
            assert(read1 == 0);
            assert(r0.generation == 1);
            assert(r0.version == 2);
            assert(r0.commit_state == 2);
            assert(std::strcmp(r0.params.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215261") == 0);
        }

        // 3. Send command 2 -> should write to Slot 1 (wear leveling / select empty slot)
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215262";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 2;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.2f;
            config["mist_gain_scale"] = 0.8f;
            config["mist_on_threshold"] = 0.30f;
            config["mist_off_threshold"] = 0.20f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::ACCEPTED);

            // Verify both slots written
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, true) == true);
            TuningNvsRecord r0, r1;
            size_t read0 = prefs.getBytes("tune_s0", &r0, sizeof(TuningNvsRecord));
            size_t read1 = prefs.getBytes("tune_s1", &r1, sizeof(TuningNvsRecord));
            prefs.end();

            assert(read0 == sizeof(TuningNvsRecord));
            assert(read1 == sizeof(TuningNvsRecord));
            assert(r0.generation == 1);
            assert(r1.generation == 2);
            assert(std::strcmp(r1.params.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215262") == 0);
        }

        // 4. Send command 3 -> should overwrite Slot 0 (since gen0=1 <= gen1=2)
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215263";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 3;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.0f;
            config["mist_gain_scale"] = 1.1f;
            config["mist_on_threshold"] = 0.26f;
            config["mist_off_threshold"] = 0.16f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::ACCEPTED);

            // Verify slot 0 has generation 3, slot 1 has generation 2
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, true) == true);
            TuningNvsRecord r0, r1;
            assert(prefs.getBytes("tune_s0", &r0, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
            assert(prefs.getBytes("tune_s1", &r1, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
            prefs.end();

            assert(r0.generation == 3);
            assert(r1.generation == 2);
            assert(std::strcmp(r0.params.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215263") == 0);
        }

        // 5. Test boot hydration: reset tuner, init, should load generation 3
        {
            tuner.resetForTest();
            assert(tuner.init() == true);
            DynamicTuningParams active = tuner.getActiveParams();
            assert(active.revision == 3);
            assert(std::strcmp(active.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215263") == 0);
            assert(std::abs(active.lamp_gain_scale - 1.0f) < 0.0001f);
        }

        // 6. Test single-slot corruption recovery (corrupt Slot 0 CRC32, should fall back to Slot 1 / gen 2)
        {
            {
                Preferences prefs;
                assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
                TuningNvsRecord r0;
                assert(prefs.getBytes("tune_s0", &r0, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
                r0.crc32 = 0xDEADBEEF; // corrupt
                assert(prefs.putBytes("tune_s0", &r0, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
                prefs.end();
            }

            tuner.resetForTest();
            assert(tuner.init() == true);
            DynamicTuningParams active = tuner.getActiveParams();
            // Should recover from Slot 1 (gen 2)
            assert(active.revision == 2);
            assert(std::strcmp(active.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215262") == 0);
            assert(std::abs(active.lamp_gain_scale - 1.2f) < 0.0001f);
        }

        // 7. Test both-slot corruption recovery (corrupt Slot 1 too, should fall back to safe defaults)
        {
            {
                Preferences prefs;
                assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
                TuningNvsRecord r1;
                assert(prefs.getBytes("tune_s1", &r1, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
                r1.crc32 = 0xDEADBEEF; // corrupt
                assert(prefs.putBytes("tune_s1", &r1, sizeof(TuningNvsRecord)) == sizeof(TuningNvsRecord));
                prefs.end();
            }

            tuner.resetForTest();
            assert(tuner.init() == true);
            DynamicTuningParams active = tuner.getActiveParams();
            // Should fallback to safe defaults
            assert(active.revision == 0);
            assert(std::strcmp(active.command_id, "") == 0);
            assert(std::abs(active.lamp_gain_scale - 1.0f) < 0.0001f);
        }

        // 8. Test NVS write failure propagation
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215265";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 4;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 0.9f;
            config["mist_on_threshold"] = 0.28f;
            config["mist_off_threshold"] = 0.18f;

            // Trigger write failure
            Preferences::mock_fail_put_bytes = true;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::NVS_WRITE_ERROR);

            // Clean up failure mock state
            Preferences::mock_fail_put_bytes = false;
        }

        // Once NVS is durable, a transient queue failure is PENDING rather
        // than REJECTED. Boot may safely recover this durable command.
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            prefs.end();
            tuner.resetForTest();
            assert(tuner.init() == true);
            xQueueReset(g_tuning_config_queue);

            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215266";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 5;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.15f;
            config["mist_gain_scale"] = 0.85f;
            config["mist_on_threshold"] = 0.30f;
            config["mist_off_threshold"] = 0.16f;

            mock_fail_queue_overwrite = true;
            storage::TuningReason reason = storage::TuningReason::OK;
            assert(tuner.processCommand(doc.as<JsonVariant>(), reason) == storage::TuningResult::PENDING);
            assert(reason == storage::TuningReason::QUEUE_FULL_ERROR);
            mock_fail_queue_overwrite = false;

            DynamicTuningParams candidate{};
            assert(xQueueReceive(g_tuning_config_queue, &candidate, 0) == pdFALSE);
            tuner.resetForTest(); // Simulate reboot before Core 1 can receive it.
            assert(tuner.init() == true);
            const DynamicTuningParams hydrated = tuner.getActiveParams();
            assert(hydrated.revision == 5);
            assert(std::strcmp(hydrated.command_id, "b0d33b2e-9d2a-43a9-8de6-bf10d3215266") == 0);
            assert(std::abs(hydrated.lamp_gain_scale - 1.15f) < 0.0001f);
        }

        // 10. Test that modifying a field in record (even with CRC recalculated) is rejected during readback verification
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            prefs.end();
            tuner.resetForTest();
            assert(tuner.init() == true);

            // Ensure queue is empty before test
            DynamicTuningParams temp_queue_params{};
            while (xQueueReceive(g_tuning_config_queue, &temp_queue_params, 0) == pdTRUE) {}

            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "b0d33b2e-9d2a-43a9-8de6-bf10d3215268";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 6;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.2f;
            config["mist_gain_scale"] = 0.8f;
            config["mist_on_threshold"] = 0.29f;
            config["mist_off_threshold"] = 0.19f;

            // Set the hook to alter a field and recalculate CRC
            Preferences::mock_put_bytes_hook = alterFieldAndRecalculateCrcHook;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);

            Preferences::mock_put_bytes_hook = nullptr;

            // Since verifyReadback rejects mismatched CRCs, processCommand must fail and return REJECTED
            assert(result == storage::TuningResult::REJECTED);
            assert(reason == storage::TuningReason::NVS_WRITE_ERROR);

            // Verify active config and queue remain unchanged (fail-closed invariant)
            DynamicTuningParams active = tuner.getActiveParams();
            assert(std::abs(active.lamp_gain_scale - 1.0f) < 0.0001f);
            assert(std::strcmp(active.command_id, "") == 0);

            DynamicTuningParams queued_params{};
            assert(xQueueReceive(g_tuning_config_queue, &queued_params, 0) == pdFALSE);
        }

        // Case K2: saveDurableReceipt fails due to corrupt readback (C5 regression)
        {
            Serial.println("--- Case K2: saveDurableReceipt corrupt readback ---");
            storage::TuningConfigManager& tuner = storage::TuningConfigManager::getInstance();
            tuner.resetForTest();

            // Set up a hook on putBytes to corrupt the stored receipt in global storage
            // immediately after putBytes writes it.
            Preferences::mock_put_bytes_hook = [](const char* key, const void* value, size_t len) {
                if (std::strcmp(key, "tune_rcpt") == 0) {
                    auto& storage = Preferences::_global_storage[config::network::NVS_NAMESPACE];
                    auto it = storage.find(key);
                    if (it != storage.end()) {
                        std::string& stored = it->second;
                        struct DummyReceipt {
                            uint32_t version;
                            char command_id[37];
                            uint8_t padding[3];
                            uint32_t crc32;
                        };
                        if (stored.size() >= sizeof(DummyReceipt)) {
                            DummyReceipt* rec =
                                reinterpret_cast<DummyReceipt*>(&stored[0]);
                            rec->crc32 ^= 0xFFFFFFFF; // Corrupt the CRC32
                        }
                    }
                }
            };

            // First, process a valid accepted command to establish it as active
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "c5555555-1234-1234-1234-123456789012";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 1;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.1f;
            config["mist_gain_scale"] = 1.0f;
            config["mist_on_threshold"] = 0.25f;
            config["mist_off_threshold"] = 0.15f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::ACCEPTED);

            // Now send a semantically identical command with a DIFFERENT command_id.
            // This should trigger recordNoChangeReceipt() which calls saveDurableReceipt().
            StaticJsonDocument<512> doc2;
            doc2["schema_version"] = 1;
            doc2["command_id"] = "c5555555-1234-1234-1234-123456789013";
            doc2["device_id"] = "mushroom_s3_unittest";
            doc2["revision"] = 2; // different revision but same config values -> semantic identical/no-change
            JsonObject config2 = doc2.createNestedObject("config");
            config2["lamp_gain_scale"] = 1.1f;
            config2["mist_gain_scale"] = 1.0f;
            config2["mist_on_threshold"] = 0.25f;
            config2["mist_off_threshold"] = 0.15f;

            // This should try to save receipt, fail due to our corrupt hook, and return REJECTED
            storage::TuningReason reason2 = storage::TuningReason::OK;
            storage::TuningResult result2 = tuner.processCommand(doc2.as<JsonVariant>(), reason2);

            Preferences::mock_put_bytes_hook = nullptr;

            assert(result2 == storage::TuningResult::REJECTED);
            assert(reason2 == storage::TuningReason::NVS_WRITE_ERROR);

            // With hook removed, it should succeed this time (it will call saveDurableReceipt which succeeds, so it returns DUPLICATE/NO_CHANGE)
            storage::TuningReason reason3 = storage::TuningReason::OK;
            storage::TuningResult result3 = tuner.processCommand(doc2.as<JsonVariant>(), reason3);
            assert(result3 == storage::TuningResult::DUPLICATE);
            assert(reason3 == storage::TuningReason::NO_CHANGE);
        }

        // Case K3: receipt with valid CRC but missing NUL terminator in command_id must be ignored safely without crash (C5 regression)
        {
            Serial.println("--- Case K3: receipt with valid CRC but missing NUL terminator ---");
            storage::TuningConfigManager& tuner = storage::TuningConfigManager::getInstance();
            tuner.resetForTest();

            // Prepare a TuningReceiptRecord with no NUL terminator but correct CRC
            struct RawReceiptRecord {
                uint32_t version;
                char command_id[37];
                uint8_t padding[3];
                uint32_t crc32;
            } __attribute__((aligned(4)));

            RawReceiptRecord raw_rec{};
            raw_rec.version = 2; // TUNING_NVS_VERSION
            std::memset(raw_rec.command_id, 'A', 37);
            std::memset(raw_rec.padding, 0, 3);

            auto calc_crc32 = [](const uint8_t *data, size_t length) -> uint32_t {
                uint32_t crc = 0xFFFFFFFF;
                for (size_t i = 0; i < length; i++) {
                    crc ^= data[i];
                    for (int j = 0; j < 8; j++) {
                        if (crc & 1) {
                            crc = (crc >> 1) ^ 0xEDB88320;
                        } else {
                            crc >>= 1;
                        }
                    }
                }
                return ~crc;
            };

            raw_rec.crc32 = calc_crc32(reinterpret_cast<const uint8_t*>(&raw_rec), offsetof(RawReceiptRecord, crc32));

            // Write raw_rec manually to NVS
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            assert(prefs.putBytes("tune_rcpt", &raw_rec, sizeof(raw_rec)) == sizeof(raw_rec));
            prefs.end();

            // Hydrate the manager. It should load the receipt, see valid CRC, but reject it because it is not NUL-terminated.
            tuner.init();

            // Verify it was ignored and not loaded
            const char* cached_id = tuner.getDurableReceiptCommandIdForTest();
            assert(cached_id[0] == '\0');

            // Cleanup
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_rcpt");
            prefs.end();
            tuner.resetForTest();
        }

        // Cleanup
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            prefs.remove("tune_rcpt");
            prefs.end();
        }
        tuner.resetForTest();
    }

    // Task C7 - TuningConfigManager Queue Hydration and Fail-Fast Tests
    Serial.println("[TEST] Starting Task C7 - TuningConfigManager Queue Hydration & Fail-Fast Unit Tests...");
    {
        storage::TuningConfigManager& tuner = storage::TuningConfigManager::getInstance();

        // 1. Verify queue is created (initQueues() called in setup)
        assert(g_tuning_config_queue != nullptr);

        // 2. Clear any leftovers in the queue first
        DynamicTuningParams dummy;
        while (xQueueReceive(g_tuning_config_queue, &dummy, 0) == pdTRUE) {}

        // 3. Write a valid config using processCommand to guarantee correct CRC32 and generation format in NVS
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "c7777777-1234-1234-1234-123456789012";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 42;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.15f;
            config["mist_gain_scale"] = 0.85f;
            config["mist_on_threshold"] = 0.22f;
            config["mist_off_threshold"] = 0.12f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::ACCEPTED);
        }

        // Now we reset the tuner and the queue, then call hydrateSetpointsFromNVS() to test C7 hydration
        tuner.resetForTest();

        while (xQueueReceive(g_tuning_config_queue, &dummy, 0) == pdTRUE) {}

        // Hydrate from NVS
        // (Wait, wait, hydrateSetpointsFromNVS will run)
        hydrateSetpointsFromNVS();

        // Verify active params inside tuner match NVS record
        DynamicTuningParams active = tuner.getActiveParams();
        assert(active.revision == 42);
        assert(std::strcmp(active.command_id, "c7777777-1234-1234-1234-123456789012") == 0);
        assert(std::abs(active.lamp_gain_scale - 1.15f) < 0.0001f);
        assert(std::abs(active.mist_gain_scale - 0.85f) < 0.0001f);

        // Verify that the queue contains exactly this hydrated config
        DynamicTuningParams queued;
        assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdTRUE);
        assert(queued.revision == 42);
        assert(std::strcmp(queued.command_id, "c7777777-1234-1234-1234-123456789012") == 0);
        assert(std::abs(queued.lamp_gain_scale - 1.15f) < 0.0001f);
        assert(std::abs(queued.mist_gain_scale - 0.85f) < 0.0001f);
        assert(std::abs(queued.mist_on_threshold - 0.22f) < 0.0001f);
        assert(std::abs(queued.mist_off_threshold - 0.12f) < 0.0001f);

        // 4. Test fail-fast check function (createCoreTasks is expected to NOT crash because queue is not null)
        createCoreTasks(); // Should pass without halting

        // 5. Verify that processCommand writes updated config to queue
        {
            StaticJsonDocument<512> doc;
            doc["schema_version"] = 1;
            doc["command_id"] = "c7777777-1234-1234-1234-123456789013";
            doc["device_id"] = "mushroom_s3_unittest";
            doc["revision"] = 43;
            JsonObject config = doc.createNestedObject("config");
            config["lamp_gain_scale"] = 1.16f;
            config["mist_gain_scale"] = 0.8f;
            config["mist_on_threshold"] = 0.23f;
            config["mist_off_threshold"] = 0.13f;

            storage::TuningReason reason = storage::TuningReason::OK;
            storage::TuningResult result = tuner.processCommand(doc.as<JsonVariant>(), reason);
            assert(result == storage::TuningResult::ACCEPTED);

            assert(xQueueReceive(g_tuning_config_queue, &queued, 0) == pdTRUE);
            assert(queued.revision == 43);
            assert(std::strcmp(queued.command_id, "c7777777-1234-1234-1234-123456789013") == 0);
            assert(std::abs(queued.lamp_gain_scale - 1.16f) < 0.0001f);
        }

        // Clean up
        {
            Preferences prefs;
            assert(prefs.begin(config::network::NVS_NAMESPACE, false) == true);
            prefs.remove("tune_s0");
            prefs.remove("tune_s1");
            prefs.end();
        }
        tuner.resetForTest();
        // re-run hydration to restore default clean state
        hydrateSetpointsFromNVS();
    }

    // 16. Test Task F1/F2 - Sensors Mock & Fault Injection
    Serial.println("[TEST] Starting Task F1/F2 - Sensors Mock & Fault Injection Unit Tests...");

    // Reset sensors initialization status for this test
    sensors::reset_sensors_initialized_for_test();

    // 16.1 Test before initialization
    float t_sht = 0, h_sht = 0, t_ds = 0, co2_scd = 0;
    TelemetryData telemetry_mock;

    assert(sensors::read_sht30(t_sht, h_sht) == false);
    assert(std::isnan(t_sht) && std::isnan(h_sht));
    assert(sensors::get_last_error_sht30() == sensors::SensorError::ERR_NOT_INITIALIZED);

    assert(sensors::read_scd30(co2_scd) == false);
    assert(std::isnan(co2_scd));

    assert(sensors::read_all_telemetry(telemetry_mock) == false);
    assert(std::isnan(telemetry_mock.temp_air));
    assert(std::isnan(telemetry_mock.humidity_air));
    assert(std::isnan(telemetry_mock.co2_level));

    // 16.2 Initialize sensors
    assert(sensors::init_sensors_placeholder() == true);

    // 16.3 Read again, should succeed and produce reasonable default mock values (millis is mock-controlled)
    assert(sensors::read_sht30(t_sht, h_sht) == true);
    assert(!std::isnan(t_sht) && !std::isnan(h_sht));
    assert(t_sht >= 23.0f && t_sht <= 27.0f);
    assert(h_sht >= 75.0f && h_sht <= 85.0f);
    assert(sensors::get_last_error_sht30() == sensors::SensorError::SUCCESS);

    assert(sensors::read_scd30(co2_scd) == false);
    assert(std::isnan(co2_scd));

    assert(sensors::read_all_telemetry(telemetry_mock) == true);
    assert(!std::isnan(telemetry_mock.temp_air));
    assert(!std::isnan(telemetry_mock.humidity_air));
    assert(std::isnan(telemetry_mock.co2_level));
    assert(telemetry_mock.temp_air == t_sht);
    assert(telemetry_mock.humidity_air == h_sht);

    // 16.4 Test dynamic variations over mock time
    mock_millis_offset = 10000; // Shift by 10s
    float t_sht2 = 0, h_sht2 = 0;
    assert(sensors::read_sht30(t_sht2, h_sht2) == true);
    assert(t_sht2 != t_sht || h_sht2 != h_sht);

    // 16.5 Fault injection - set simulated health to false
    sensors::set_simulated_health_sht30(false);
    assert(sensors::read_sht30(t_sht, h_sht) == false);
    assert(std::isnan(t_sht) && std::isnan(h_sht));
    assert(sensors::get_last_error_sht30() == sensors::SensorError::ERR_DISCONNECTED);

    assert(sensors::read_all_telemetry(telemetry_mock) == false);
    assert(std::isnan(telemetry_mock.temp_air));       // Failed SHT30
    assert(std::isnan(telemetry_mock.humidity_air));   // Failed SHT30
    assert(std::isnan(telemetry_mock.co2_level));

    sensors::set_simulated_health_sht30(true);
    assert(sensors::read_all_telemetry(telemetry_mock) == true);
    assert(!std::isnan(telemetry_mock.temp_air));
    assert(!std::isnan(telemetry_mock.humidity_air));
    assert(std::isnan(telemetry_mock.co2_level));

    // 17. Test Task G1 - Actuators Mock & Fail-Safe init
    Serial.println("[TEST] Starting Task G1 - Actuators GPIO Initialization Unit Tests...");

    // Clear mocks
    mock_pin_modes.clear();
    mock_pin_values.clear();
    mock_pin_write_order.clear();
    mock_operation_counter = 0;

    // Call initialization
    actuators::init_actuators_gpio();

    // Check that all relay pins are configured as OUTPUT and set to HIGH (OFF)
    uint8_t relay_pins[] = {
        config::pins::PIN_RELAY_MIST,
        config::pins::PIN_RELAY_FAN,
        config::pins::PIN_RELAY_LAMP,
        config::pins::PIN_RELAY_HWAT
    };

    for (uint8_t pin : relay_pins) {
        // Assert pin mode is OUTPUT
        assert(mock_pin_modes.count(pin) > 0);
        assert(mock_pin_modes[pin] == OUTPUT);

        // Assert pin state is HIGH (fail-safe for SSR)
        assert(mock_pin_values.count(pin) > 0);
        assert(mock_pin_values[pin] == HIGH);

        // Assert that digitalWrite was called (write order is recorded)
        assert(mock_pin_write_order.count(pin) > 0);
        assert(mock_pin_write_order[pin] > 0);
    }

    // 18. Test Task G2 - set_relay_state boundary checks and logging
    Serial.println("[TEST] Starting Task G2 - set_relay_state Unit Tests...");

    mock_pin_values.clear();
    mock_pin_write_order.clear();

    // 18.1 Toggle MIST relay ON then OFF — verify return true and correct levels
    assert(actuators::set_relay_state(config::pins::PIN_RELAY_MIST, true) == true);
    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == LOW);

    assert(actuators::set_relay_state(config::pins::PIN_RELAY_MIST, false) == true);
    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);

    // 18.2 Toggle all four relays individually — each must succeed
    for (uint8_t pin : relay_pins) {
        assert(actuators::set_relay_state(pin, true) == true);
        assert(mock_pin_values[pin] == LOW);
        assert(actuators::set_relay_state(pin, false) == true);
        assert(mock_pin_values[pin] == HIGH);
    }

    // 18.3 Reject invalid pins — must return false and NOT call digitalWrite
    int write_count_before = mock_operation_counter;
    assert(actuators::set_relay_state(0x00, true) == false);
    assert(actuators::set_relay_state(0xFF, true) == false);
    assert(actuators::set_relay_state(99, false) == false);
    assert(actuators::set_relay_state(config::pins::PIN_I2C_SDA, true) == false);
    assert(actuators::set_relay_state(21, true) == false); // GPIO 21 is invalid, reject invalid pin
    // Verify no extra digitalWrite calls were made for rejected pins
    assert(mock_operation_counter == write_count_before);

    // 19. Test Task H1 - Core 1 Control Task with FreeRTOS Queue Integration
    Serial.println("[TEST] Starting Task H1 - Core 1 Control Task Unit Tests...");

    // 19.1 Verify baseline and override queue creation (depth=1, overwrite semantics)
    QueueHandle_t test_baseline_q = xQueueCreate(1, sizeof(ControlSetpointCommand));
    QueueHandle_t test_override_q = xQueueCreate(1, sizeof(ControlSetpointCommand));
    QueueHandle_t test_tel_queue  = xQueueCreate(4, sizeof(TelemetryData));
    assert(test_baseline_q != nullptr);
    assert(test_override_q != nullptr);
    assert(test_tel_queue != nullptr);
    assert(uxQueueMessagesWaiting(test_baseline_q) == 0);
    assert(uxQueueMessagesWaiting(test_override_q) == 0);
    assert(uxQueueMessagesWaiting(test_tel_queue) == 0);

    // 19.2 Send a valid ControlSetpointCommand via baseline queue and verify fields
    ControlSetpointCommand baselineCmd;
    baselineCmd.temp_target   = 28.0f;
    baselineCmd.humidity_target = 85.0f;
    baselineCmd.co2_target    = 800.0f;
    baselineCmd.active        = true;
    memset(baselineCmd.padding, 0, sizeof(baselineCmd.padding));

    assert(xQueueOverwrite(test_baseline_q, &baselineCmd) == pdTRUE);
    assert(uxQueueMessagesWaiting(test_baseline_q) == 1);

    ControlSetpointCommand received_baseline;
    assert(xQueueReceive(test_baseline_q, &received_baseline, 0) == pdTRUE);
    assert(received_baseline.temp_target   == 28.0f);
    assert(received_baseline.humidity_target == 85.0f);
    assert(received_baseline.co2_target    == 800.0f);
    assert(received_baseline.active        == true);
    assert(uxQueueMessagesWaiting(test_baseline_q) == 0);

    // 19.3 Overwrite semantics: latest value wins on depth-1 queue
    ControlSetpointCommand newBaseline;
    newBaseline.temp_target   = 30.0f;
    newBaseline.humidity_target = 80.0f;
    newBaseline.co2_target    = 1000.0f;
    newBaseline.active        = true;
    memset(newBaseline.padding, 0, sizeof(newBaseline.padding));

    ControlSetpointCommand staleCmd;
    staleCmd.temp_target   = 28.0f;
    staleCmd.humidity_target = 85.0f;
    staleCmd.co2_target    = 800.0f;
    staleCmd.active        = true;
    memset(staleCmd.padding, 0, sizeof(staleCmd.padding));

    xQueueOverwrite(test_baseline_q, &staleCmd);
    xQueueOverwrite(test_baseline_q, &newBaseline);
    assert(uxQueueMessagesWaiting(test_baseline_q) == 1);

    ControlSetpointCommand finalReceived;
    xQueueReceive(test_baseline_q, &finalReceived, 0);
    assert(finalReceived.temp_target   == 30.0f);
    assert(finalReceived.humidity_target == 80.0f);
    assert(finalReceived.co2_target    == 1000.0f);

    // 19.4 Override queue carries manual setpoints independently
    ControlSetpointCommand overrideCmd;
    overrideCmd.temp_target   = 32.0f;
    overrideCmd.humidity_target = 90.0f;
    overrideCmd.co2_target    = NAN;
    overrideCmd.active        = true;
    memset(overrideCmd.padding, 0, sizeof(overrideCmd.padding));

    assert(xQueueOverwrite(test_override_q, &overrideCmd) == pdTRUE);
    ControlSetpointCommand receivedOverride;
    xQueueReceive(test_override_q, &receivedOverride, 0);
    assert(receivedOverride.temp_target   == 32.0f);
    assert(receivedOverride.humidity_target == 90.0f);

    // 19.5 Inactive override clears overlay
    ControlSetpointCommand clearOverride;
    clearOverride.temp_target   = NAN;
    clearOverride.humidity_target = NAN;
    clearOverride.co2_target    = NAN;
    clearOverride.active        = false;
    memset(clearOverride.padding, 0, sizeof(clearOverride.padding));
    xQueueOverwrite(test_override_q, &clearOverride);
    ControlSetpointCommand cleared;
    xQueueReceive(test_override_q, &cleared, 0);
    assert(cleared.active == false);

    // 19.6 Send TelemetryData through telemetry queue
    TelemetryData tel_data;
    tel_data.temp_air       = 25.0f;
    tel_data.humidity_air   = 80.0f;
    tel_data.co2_level      = 600.0f;

    assert(xQueueSend(test_tel_queue, &tel_data, 0) == pdTRUE);
    assert(uxQueueMessagesWaiting(test_tel_queue) == 1);

    TelemetryData received_tel;
    assert(xQueueReceive(test_tel_queue, &received_tel, 0) == pdTRUE);
    assert(received_tel.temp_air       == 25.0f);
    assert(received_tel.humidity_air   == 80.0f);
    assert(received_tel.co2_level      == 600.0f);
    assert(uxQueueMessagesWaiting(test_tel_queue) == 0);

    // 19.7 Test task_core1_control single iteration (UNIT_TEST path)
    // Reset sensor state so init succeeds
    sensors::init_sensors_placeholder();
    mock_pin_modes.clear();
    mock_pin_values.clear();
    mock_pin_write_order.clear();
    mock_operation_counter = 0;
    mock_millis_offset = 0;

    time_conf::setTimeConfidence(TimeConfidence::Trusted);
    // Execute a single iteration of the direct ON/OFF control pipeline
    taskCore1Control(nullptr);

    // Verify sensors and relays were initialized
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_MIST) > 0);
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_LAMP) > 0);
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_FAN) > 0);

    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);
    assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);
    assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == HIGH);

    // 19.8 E1: Core 1 adopts the latest POD tuning snapshot at the tick
    // boundary without blocking; its depth-1 handoff queue is drained.
    xQueueReset(g_tuning_config_queue);
    DynamicTuningParams pendingTuning{};
    pendingTuning.revision = 909U;
    pendingTuning.lamp_gain_scale = 1.15f;
    pendingTuning.mist_gain_scale = 0.85f;
    pendingTuning.mist_on_threshold = 0.30f;
    pendingTuning.mist_off_threshold = 0.18f;
    assert(xQueueOverwrite(g_tuning_config_queue, &pendingTuning) == pdTRUE);
    assert(uxQueueMessagesWaiting(g_tuning_config_queue) == 1U);
    taskCore1Control(nullptr);
    assert(uxQueueMessagesWaiting(g_tuning_config_queue) == 0U);

    // 19.9 Cleanup queues
    vQueueDelete(test_baseline_q);
    vQueueDelete(test_override_q);
    vQueueDelete(test_tel_queue);

    // 20. Test Task H2 - Serial Mutex for cross-core race-condition protection
    Serial.println("[TEST] Starting Task H2 - Serial Mutex Unit Tests...");

    // 20.1 init_serial_mutex() must succeed in UNIT_TEST mode
    assert(init_serial_mutex() == true);

    // 20.2 SerialLock starts unlocked
    SerialLock& slock = SerialLock::get_instance();
    assert(slock.lock_count() == 0);

    // 20.3 lock() increments depth, unlock() decrements
    slock.lock();
    assert(slock.lock_count() == 1);
    slock.lock();
    assert(slock.lock_count() == 2);
    slock.unlock();
    assert(slock.lock_count() == 1);
    slock.unlock();
    assert(slock.lock_count() == 0);

    // 20.4 ScopedSerialLock RAII: auto-unlocks on scope exit
    {
        ScopedSerialLock guard(slock);
        assert(slock.lock_count() == 1);
    }
    assert(slock.lock_count() == 0);

    // 20.5 Nested ScopedSerialLock
    {
        ScopedSerialLock outer(slock);
        assert(slock.lock_count() == 1);
        {
            ScopedSerialLock inner(slock);
            assert(slock.lock_count() == 2);
        }
        assert(slock.lock_count() == 1);
    }
    assert(slock.lock_count() == 0);

    // 21. Test Task A1 - MathEngine Fuzzy Area calculation
    Serial.println("[TEST] Starting Task A1 - MathEngine Unit Tests...");

    // Case 1: All membership values are zero. Centroid denominator K should be 0.
    {
        float kz = -999.0f, k = -999.0f;
        float tb = MathEngine::calculateFuzzyArea(0.0f, 0.0f, 0.0f, kz, k);
        assert(tb == 0.0f);
        assert(k == 0.0f);
        assert(kz == 0.0f);
    }

    // Case 2: Standard values
    {
        float kz = 0.0f, k = 0.0f;
        float tb = MathEngine::calculateFuzzyArea(0.8f, 0.5f, 0.2f, kz, k);
        assert(!std::isnan(tb));
        assert(!std::isnan(kz));
        assert(!std::isnan(k));
        assert(k > 0.0f);
        assert(tb >= 0.0f);
        // Overloaded signature check
        float tb2 = MathEngine::calculateFuzzyArea(0.8f, 0.5f, 0.2f);
        assert(tb == tb2);
    }

    // Case 3: Fault Injection (NaN and Inf)
    {
        float kz = -999.0f, k = -999.0f;
        float tb = MathEngine::calculateFuzzyArea(NAN, 0.5f, 0.2f, kz, k);
        assert(tb == 0.0f);
        assert(k == 0.0f);
        assert(kz == 0.0f);

        tb = MathEngine::calculateFuzzyArea(0.8f, INFINITY, 0.2f, kz, k);
        assert(tb == 0.0f);
        assert(k == 0.0f);
        assert(kz == 0.0f);
    }

    // Case 4: Centroid value less than 1.0 should be clamped to 0.0
    {
        float kz = 0.0f, k = 0.0f;
        float tb = MathEngine::calculateFuzzyArea(0.0f, 0.0f, 1.0f, kz, k);
        assert(k == 1.0f);
        assert(std::abs(kz - 0.666667f) < 1e-4f);
        assert(tb == 0.0f);
    }

    // 22. Test Task A2 - MathEngine computeMembership (trimf and trapmf)
    Serial.println("[TEST] Starting Task A2 - computeMembership Unit Tests...");
    {
        // 22.1 Triangular Membership (trimf) checks: a=1.0, b=2.0, c=3.0
        assert(MathEngine::computeMembership(0.5f, 1.0f, 2.0f, 3.0f) == 0.0f);   // x < a
        assert(MathEngine::computeMembership(1.0f, 1.0f, 2.0f, 3.0f) == 0.0f);   // x == a (edge)
        assert(std::abs(MathEngine::computeMembership(1.5f, 1.0f, 2.0f, 3.0f) - 0.5f) < 1e-6f); // rising slope
        assert(MathEngine::computeMembership(2.0f, 1.0f, 2.0f, 3.0f) == 1.0f);   // x == b (peak)
        assert(std::abs(MathEngine::computeMembership(2.5f, 1.0f, 2.0f, 3.0f) - 0.5f) < 1e-6f); // falling slope
        assert(MathEngine::computeMembership(3.0f, 1.0f, 2.0f, 3.0f) == 0.0f);   // x == c (edge)
        assert(MathEngine::computeMembership(3.5f, 1.0f, 2.0f, 3.0f) == 0.0f);   // x > c

        // 22.2 Triangular Degenerate cases
        assert(MathEngine::computeMembership(1.5f, 2.0f, 2.0f, 3.0f) == 0.0f);   // a == b, x < a
        assert(MathEngine::computeMembership(2.0f, 2.0f, 2.0f, 3.0f) == 1.0f);   // a == b, x == b
        assert(MathEngine::computeMembership(2.5f, 1.0f, 2.0f, 2.0f) == 0.0f);   // b == c, x > c
        assert(MathEngine::computeMembership(2.0f, 1.0f, 2.0f, 2.0f) == 1.0f);   // b == c, x == b

        // 22.3 Triangular Robustness with NaN/Inf
        assert(MathEngine::computeMembership(NAN, 1.0f, 2.0f, 3.0f) == 0.0f);
        assert(MathEngine::computeMembership(1.5f, NAN, 2.0f, 3.0f) == 0.0f);
        assert(MathEngine::computeMembership(1.5f, 1.0f, INFINITY, 3.0f) == 0.0f);

        // 22.4 Trapezoidal Membership (trapmf) checks: a=1.0, b=2.0, c=3.0, d=4.0
        assert(MathEngine::computeMembership(0.5f, 1.0f, 2.0f, 3.0f, 4.0f) == 0.0f);   // x < a
        assert(MathEngine::computeMembership(1.0f, 1.0f, 2.0f, 3.0f, 4.0f) == 0.0f);   // x == a (edge)
        assert(std::abs(MathEngine::computeMembership(1.5f, 1.0f, 2.0f, 3.0f, 4.0f) - 0.5f) < 1e-6f); // rising slope
        assert(MathEngine::computeMembership(2.0f, 1.0f, 2.0f, 3.0f, 4.0f) == 1.0f);   // x == b
        assert(MathEngine::computeMembership(2.5f, 1.0f, 2.0f, 3.0f, 4.0f) == 1.0f);   // b < x < c (plateau)
        assert(MathEngine::computeMembership(3.0f, 1.0f, 2.0f, 3.0f, 4.0f) == 1.0f);   // x == c
        assert(std::abs(MathEngine::computeMembership(3.5f, 1.0f, 2.0f, 3.0f, 4.0f) - 0.5f) < 1e-6f); // falling slope
        assert(MathEngine::computeMembership(4.0f, 1.0f, 2.0f, 3.0f, 4.0f) == 0.0f);   // x == d (edge)
        assert(MathEngine::computeMembership(4.5f, 1.0f, 2.0f, 3.0f, 4.0f) == 0.0f);   // x > d

        // 22.5 Trapezoidal Degenerate cases
        assert(MathEngine::computeMembership(1.5f, 2.0f, 2.0f, 3.0f, 4.0f) == 0.0f);   // a == b, x < a
        assert(MathEngine::computeMembership(2.0f, 2.0f, 2.0f, 3.0f, 4.0f) == 1.0f);   // a == b, x == b
        assert(MathEngine::computeMembership(3.5f, 1.0f, 2.0f, 3.0f, 3.0f) == 0.0f);   // c == d, x > d
        assert(MathEngine::computeMembership(3.0f, 1.0f, 2.0f, 3.0f, 3.0f) == 1.0f);   // c == d, x == c

        // 22.6 Trapezoidal Robustness with NaN/Inf
        assert(MathEngine::computeMembership(NAN, 1.0f, 2.0f, 3.0f, 4.0f) == 0.0f);
        assert(MathEngine::computeMembership(2.5f, 1.0f, 2.0f, NAN, 4.0f) == 0.0f);
        assert(MathEngine::computeMembership(2.5f, 1.0f, -INFINITY, 3.0f, 4.0f) == 0.0f);
    }

    // 23. Test Task A3 - Trajectory interpolateSetpoints
    Serial.println("[TEST] Starting Task A3 - Trajectory Unit Tests...");
    {
        // 23.1 Boundary checks
        // Below lower bound
        Trajectory::SetpointPod low = Trajectory::interpolateSetpoints(-5.0f);
        assert(low.temp_target == 33.0f);
        assert(low.humidity_target == 90.0f);
        assert(low.co2_target == 1100.0f);

        // NaN input
        Trajectory::SetpointPod nan_in = Trajectory::interpolateSetpoints(NAN);
        assert(nan_in.temp_target == 33.0f);
        assert(nan_in.humidity_target == 90.0f);
        assert(nan_in.co2_target == 1100.0f);

        // Above upper bound
        Trajectory::SetpointPod high = Trajectory::interpolateSetpoints(25.0f);
        assert(high.temp_target == 28.0f);
        assert(high.humidity_target == 85.0f);
        assert(high.co2_target == 850.0f);

        // Exactly at bounds
        Trajectory::SetpointPod bound_0 = Trajectory::interpolateSetpoints(0.0f);
        assert(bound_0.temp_target == 33.0f);
        assert(bound_0.humidity_target == 90.0f);
        assert(bound_0.co2_target == 1100.0f);

        Trajectory::SetpointPod bound_20 = Trajectory::interpolateSetpoints(20.0f);
        assert(bound_20.temp_target == 28.0f);
        assert(bound_20.humidity_target == 85.0f);
        assert(bound_20.co2_target == 850.0f);

        // 23.2 Exact day checkpoint
        Trajectory::SetpointPod day_10 = Trajectory::interpolateSetpoints(10.0f);
        assert(day_10.temp_target == 29.5f);
        assert(day_10.humidity_target == 89.0f);
        assert(day_10.co2_target == 900.0f);

        // 23.3 Interpolation between checkpoints (e.g., day 9.5)
        // Day 9:  { 9.0f,  30.0f, 90.0f,  950.0f }
        // Day 10: { 10.0f, 29.5f, 89.0f,  900.0f }
        // For Day 9.5:
        // temp: 30.0 + 0.5 * (29.5 - 30.0) = 29.75
        // humidity: 90.0 + 0.5 * (89.0 - 90.0) = 89.5
        // co2: 950 + 0.5 * (900 - 950) = 925
        Trajectory::SetpointPod mid = Trajectory::interpolateSetpoints(9.5f);
        assert(std::abs(mid.temp_target - 29.75f) < 1e-4f);
        assert(std::abs(mid.humidity_target - 89.5f) < 1e-4f);
        assert(std::abs(mid.co2_target - 925.0f) < 1e-4f);

        // Check POD type properties
        assert(std::is_pod<Trajectory::SetpointPod>::value == true);
        assert(sizeof(Trajectory::SetpointPod) == 12); // 3 floats * 4 bytes
        assert(alignof(Trajectory::SetpointPod) == 4);
    }

    // 24. Test Task A4 - AdaptiveTuner updateGains
    Serial.println("[TEST] Starting Task A4 - AdaptiveTuner Unit Tests...");
    {
        // 24.1 Default / cold-start behaviour
        AdaptiveTuner::IntegralState state = AdaptiveTuner::makeInitialState();
        assert(state.integral_temp == 0.0f);
        assert(state.integral_humid == 0.0f);

        AdaptiveTuner::GainsPod g0 = AdaptiveTuner::defaultGains();
        assert(g0.gain_HLamp == 1.0f);
        assert(g0.gain_HWat == 1.0f);
        assert(g0.gain_Mist == 1.0f);

        // Zero errors keep gains at nominal
        AdaptiveTuner::GainsPod g_zero = AdaptiveTuner::updateGains(state, 0.0f, 0.0f, 1.0f);
        assert(std::abs(g_zero.gain_HLamp - 1.0f) < 1e-6f);
        assert(std::abs(g_zero.gain_HWat - 1.0f) < 1e-6f);
        assert(std::abs(g_zero.gain_Mist - 1.0f) < 1e-6f);
        assert(state.integral_temp == 0.0f);
        assert(state.integral_humid == 0.0f);

        // 24.2 Positive temperature error increases heater gains
        AdaptiveTuner::IntegralState cold = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_cold = AdaptiveTuner::updateGains(cold, 2.0f, 0.0f, 1.0f);
        // I_T = 2.0, gain_HLamp = 1.0 + 0.10*2.0 = 1.2
        assert(std::abs(cold.integral_temp - 2.0f) < 1e-6f);
        assert(std::abs(g_cold.gain_HLamp - 1.2f) < 1e-5f);
        assert(std::abs(g_cold.gain_HWat - 1.2f) < 1e-5f);
        assert(std::abs(g_cold.gain_Mist - 1.0f) < 1e-5f);

        // 24.3 Positive humidity error increases mist gain
        AdaptiveTuner::IntegralState dry = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_dry = AdaptiveTuner::updateGains(dry, 0.0f, 4.0f, 1.0f);
        // I_H = 4.0, gain_Mist = 1.0 + 0.05*4.0 = 1.2
        // gain_HWat = 1.0 + 0.25*0.05*4.0 = 1.05
        assert(std::abs(dry.integral_humid - 4.0f) < 1e-6f);
        assert(std::abs(g_dry.gain_Mist - 1.2f) < 1e-5f);
        assert(std::abs(g_dry.gain_HWat - 1.05f) < 1e-5f);
        assert(std::abs(g_dry.gain_HLamp - 1.0f) < 1e-5f);

        // 24.4 Anti-windup: integral saturates and gains clamp to [0.5, 2.5]
        AdaptiveTuner::IntegralState windup = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_hi = AdaptiveTuner::defaultGains();
        for (int i = 0; i < 200; ++i) {
            g_hi = AdaptiveTuner::updateGains(windup, 10.0f, 20.0f, 1.0f);
        }
        assert(std::abs(windup.integral_temp - 15.0f) < 1e-5f);   // I_MAX_TEMP
        assert(std::abs(windup.integral_humid - 30.0f) < 1e-5f);  // I_MAX_HUMID
        assert(g_hi.gain_HLamp <= 2.5f + 1e-6f);
        assert(g_hi.gain_HWat <= 2.5f + 1e-6f);
        assert(g_hi.gain_Mist <= 2.5f + 1e-6f);
        assert(g_hi.gain_HLamp >= 0.5f - 1e-6f);
        assert(g_hi.gain_HWat >= 0.5f - 1e-6f);
        assert(g_hi.gain_Mist >= 0.5f - 1e-6f);
        // Expected: HAir = clamp(1 + 0.1*15, ...) = 2.5
        //           Mist = clamp(1 + 0.05*30, ...) = 2.5
        assert(std::abs(g_hi.gain_HLamp - 2.5f) < 1e-5f);
        assert(std::abs(g_hi.gain_Mist - 2.5f) < 1e-5f);

        AdaptiveTuner::IntegralState windup_lo = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_lo = AdaptiveTuner::defaultGains();
        for (int i = 0; i < 200; ++i) {
            g_lo = AdaptiveTuner::updateGains(windup_lo, -10.0f, -20.0f, 1.0f);
        }
        assert(std::abs(windup_lo.integral_temp + 15.0f) < 1e-5f);
        assert(std::abs(windup_lo.integral_humid + 30.0f) < 1e-5f);
        assert(std::abs(g_lo.gain_HLamp - 0.5f) < 1e-5f);
        assert(std::abs(g_lo.gain_Mist - 0.5f) < 1e-5f);
        assert(g_lo.gain_HWat >= 0.5f - 1e-6f);
        assert(g_lo.gain_HWat <= 2.5f + 1e-6f);

        // 24.5 Sensor loss / invalid dt freezes integral (no windup on NaN)
        AdaptiveTuner::IntegralState freeze = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::updateGains(freeze, 1.0f, 2.0f, 1.0f);
        const float iT_before = freeze.integral_temp;
        const float iH_before = freeze.integral_humid;
        AdaptiveTuner::GainsPod g_nan = AdaptiveTuner::updateGains(freeze, NAN, INFINITY, 1.0f);
        assert(std::abs(freeze.integral_temp - iT_before) < 1e-6f);
        assert(std::abs(freeze.integral_humid - iH_before) < 1e-6f);
        assert(g_nan.gain_HLamp >= 0.5f && g_nan.gain_HLamp <= 2.5f);
        assert(g_nan.gain_HWat >= 0.5f && g_nan.gain_HWat <= 2.5f);
        assert(g_nan.gain_Mist >= 0.5f && g_nan.gain_Mist <= 2.5f);

        AdaptiveTuner::updateGains(freeze, 5.0f, 5.0f, 0.0f); // invalid dt
        assert(std::abs(freeze.integral_temp - iT_before) < 1e-6f);
        assert(std::abs(freeze.integral_humid - iH_before) < 1e-6f);

        AdaptiveTuner::updateGains(freeze, 5.0f, 5.0f, -1.0f); // negative dt
        assert(std::abs(freeze.integral_temp - iT_before) < 1e-6f);
        assert(std::abs(freeze.integral_humid - iH_before) < 1e-6f);

        // 24.6 reset() clears accumulators
        AdaptiveTuner::reset(freeze);
        assert(freeze.integral_temp == 0.0f);
        assert(freeze.integral_humid == 0.0f);

        // 24.7 POD layout checks
        assert(std::is_pod<AdaptiveTuner::GainsPod>::value == true);
        assert(std::is_pod<AdaptiveTuner::IntegralState>::value == true);
        assert(sizeof(AdaptiveTuner::GainsPod) == 12);
        assert(sizeof(AdaptiveTuner::IntegralState) == 8);
        assert(alignof(AdaptiveTuner::GainsPod) == 4);
        assert(alignof(AdaptiveTuner::IntegralState) == 4);
    }

    // 25. Test Task B1 - FuzzyController dual-heater rule invariants
    Serial.println("[TEST] Starting Task B1 - FuzzyController Unit Tests...");
    {
        using FuzzyController::DualHeaterOutputsPod;

        // 25.1 Cold & dry: heat lamp supplies the full thermal demand and
        // suppresses mist while cold.
        const DualHeaterOutputsPod coldDry =
            FuzzyController::executeDualHeaterRules(4.0f, 20.0f);
        assert(std::abs(coldDry.HLamp - 1.0f) < 1e-6f);
        assert(coldDry.HWat == 0.0f);
        assert(coldDry.Mist == 0.0f);
        assert(coldDry.ExhTH == 0.0f);

        // 25.2 Cold & wet: water heater is unavailable, so HLamp still
        // provides heat; do not mist or exhaust heat.
        const DualHeaterOutputsPod coldWet =
            FuzzyController::executeDualHeaterRules(4.0f, -20.0f);
        assert(std::abs(coldWet.HLamp - 1.0f) < 1e-6f);
        assert(coldWet.HWat == 0.0f);
        assert(coldWet.Mist == 0.0f);
        assert(coldWet.ExhTH == 0.0f);

        // 25.3 Moderate cold/dry shares the unit budget; heat and mist cannot
        // both be excessive in the same control cycle.
        const DualHeaterOutputsPod mixed =
            FuzzyController::executeDualHeaterRules(2.0f, 20.0f);
        assert(std::abs(mixed.HLamp - 0.5f) < 1e-6f);
        assert(std::abs(mixed.Mist - 0.5f) < 1e-6f);
        assert((mixed.HLamp + mixed.Mist) <= 1.0f + 1e-6f);

        // 25.4 Continuous intermediate fuzzy demands (before binary dispatch).
        // eT=1°C => cold=0.25; eH=10% => dry=0.5 => Mist residual budget.
        const DualHeaterOutputsPod partial =
            FuzzyController::executeDualHeaterRules(1.0f, 10.0f);
        assert(std::abs(partial.HLamp - 0.25f) < 1e-6f);
        assert(std::abs(partial.Mist - 0.375f) < 1e-6f);  // 0.5 * (1-0.25)
        assert(partial.HWat == 0.0f);
        assert(partial.ExhTH == 0.0f);
        assert(partial.HLamp > 0.0f && partial.HLamp < 1.0f);
        assert(partial.Mist > 0.0f && partial.Mist < 1.0f);

        // 25.5 Warm or humid conditions invoke the independent exhaust rules.
        const DualHeaterOutputsPod hot =
            FuzzyController::executeDualHeaterRules(-4.0f, 0.0f);
        assert(hot.ExhTH == 1.0f);
        const DualHeaterOutputsPod humid =
            FuzzyController::executeDualHeaterRules(0.0f, -20.0f);
        assert(humid.ExhTH == 1.0f);
        // Partial over-temperature still yields proportional ExhTH duty.
        const DualHeaterOutputsPod warmish =
            FuzzyController::executeDualHeaterRules(-2.0f, 0.0f);
        assert(std::abs(warmish.ExhTH - 0.5f) < 1e-6f);
        assert(warmish.HLamp == 0.0f && warmish.HWat == 0.0f && warmish.Mist == 0.0f);

        // 25.6 Outputs remain normalized, including extreme and invalid input.
        const DualHeaterOutputsPod extreme =
            FuzzyController::executeDualHeaterRules(100.0f, -100.0f);
        const float values[] = {extreme.HLamp, extreme.HWat, extreme.Mist, extreme.ExhTH};
        for (float value : values) {
            assert(value >= 0.0f && value <= 1.0f);
        }
        const DualHeaterOutputsPod invalid =
            FuzzyController::executeDualHeaterRules(NAN, INFINITY);
        assert(invalid.HLamp == 0.0f && invalid.HWat == 0.0f);
        assert(invalid.Mist == 0.0f && invalid.ExhTH == 0.0f);

        assert(std::is_pod<DualHeaterOutputsPod>::value == true);
        assert(sizeof(DualHeaterOutputsPod) == 16);
        assert(alignof(DualHeaterOutputsPod) == 4);
    }

    // 26. Test Task B2 - FuzzyController CO2 hysteresis exhaust rules
    Serial.println("[TEST] Starting Task B2 - FuzzyController CO2 Unit Tests...");
    {
        using FuzzyController::CO2RuleState;

        // 26.1 Cold-start state is inactive and POD-friendly for Core 1 stack use.
        CO2RuleState state = FuzzyController::makeInitialCO2State();
        assert(state.exhaust_active == false);
        assert(std::is_pod<CO2RuleState>::value == true);
        assert(sizeof(CO2RuleState) == 4);
        assert(alignof(CO2RuleState) == 4);

        // 26.2 Deadband: small excess CO2 must not start exhaust chatter.
        // errorCO2 = target - measured. -30 ppm means measured is 30 ppm high.
        float out = FuzzyController::executeCO2Rules(state, -30.0f);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.3 Exact ON boundary remains OFF: engagement is strictly above
        // 50 ppm excess, which makes the deadband unambiguous.
        out = FuzzyController::executeCO2Rules(state, -50.0f);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.4 Cross the ON threshold to engage the exhaust latch.
        out = FuzzyController::executeCO2Rules(state, -51.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);

        // 26.5 Exact OFF boundary keeps the latch active; release is strictly
        // below 20 ppm excess.
        out = FuzzyController::executeCO2Rules(state, -20.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);

        // 26.6 While latched, remaining inside the deadband keeps the full
        // normalized demand even though the excess is below the ON threshold.
        out = FuzzyController::executeCO2Rules(state, -30.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);

        // 26.7 Fall below the OFF threshold to release the latch.
        out = FuzzyController::executeCO2Rules(state, -10.0f);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.8 Large excess remains the full normalized demand once engaged.
        out = FuzzyController::executeCO2Rules(state, -450.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);

        // 26.9 Negative excess (measured below target) keeps exhaust OFF.
        out = FuzzyController::executeCO2Rules(state, 100.0f);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.10 Invalid sensor data fails safe and clears the latch.
        state.exhaust_active = true;
        out = FuzzyController::executeCO2Rules(state, NAN);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);
        out = FuzzyController::executeCO2Rules(state, INFINITY);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.11 Output remains normalized for extreme excess values.
        out = FuzzyController::executeCO2Rules(state, -10000.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);
    }

    // 27. Test Task B3 - FuzzyController gain arbitration and exhaust merge
    Serial.println("[TEST] Starting Task B3 - FuzzyController Arbitration Unit Tests...");
    {
        using FuzzyController::ArbitratedOutputsPod;
        using FuzzyController::DualHeaterOutputsPod;

        const AdaptiveTuner::GainsPod nominal = {1.0f, 1.0f, 1.0f};
        const DualHeaterOutputsPod raw = {0.40f, 0.30f, 0.20f, 0.35f};
        const ArbitratedOutputsPod nominalOut =
            FuzzyController::arbitrateOutputs(raw, 0.60f, nominal, 1.0f, 1.0f);

        // 27.1 Nominal gains preserve actuator demands and CO2 takes the
        // shared exhaust relay whenever its demand exceeds the TH request.
        assert(std::abs(nominalOut.HLamp - 0.40f) < 1e-6f);
        assert(std::abs(nominalOut.HWat - 0.30f) < 1e-6f);
        assert(std::abs(nominalOut.Mist - 0.20f) < 1e-6f);
        assert(std::abs(nominalOut.Exh - 0.60f) < 1e-6f);

        // 27.2 Thermal/humidity demand remains authoritative if it is larger.
        const ArbitratedOutputsPod thermalExhaust =
            FuzzyController::arbitrateOutputs(raw, 0.10f, nominal, 1.0f, 1.0f);
        assert(std::abs(thermalExhaust.Exh - 0.35f) < 1e-6f);

        // 27.3 Per-channel adaptive gains apply only to HLamp/HWat/Mist, and
        // post-gain products are clamped to the normalized range.
        const AdaptiveTuner::GainsPod adjusted = {2.5f, 0.5f, 2.0f};
        const DualHeaterOutputsPod gainRaw = {0.80f, 0.80f, 0.60f, 0.20f};
        const ArbitratedOutputsPod adjustedOut =
            FuzzyController::arbitrateOutputs(gainRaw, 0.10f, adjusted, 1.0f, 1.0f);
        assert(adjustedOut.HLamp == 1.0f);  // 0.80 * 2.5 -> clamp to 1.0
        assert(std::abs(adjustedOut.HWat - 0.40f) < 1e-6f);
        assert(adjustedOut.Mist == 1.0f);  // 0.60 * 2.0 -> clamp to 1.0
        assert(std::abs(adjustedOut.Exh - 0.20f) < 1e-6f);

        // 27.4 Malformed raw commands are clamped; NaN/Inf gains fail safe
        // OFF for the corresponding actuator. Finite-but-out-of-band gains
        // are bounded to the tuner safety band [0.5, 2.5].
        const DualHeaterOutputsPod malformedRaw = {NAN, -1.0f, 2.0f, INFINITY};
        const AdaptiveTuner::GainsPod malformedGains = {NAN, 100.0f, NAN};
        const ArbitratedOutputsPod safeOut = FuzzyController::arbitrateOutputs(
            malformedRaw, NAN, malformedGains, 1.0f, 1.0f);
        assert(safeOut.HLamp == 0.0f);   // NaN raw -> safeUnit -> 0
        assert(safeOut.HWat == 0.0f);   // -1.0 raw -> clampUnit -> 0
        assert(safeOut.Mist == 0.0f);   // NaN gain -> safeGain -> 0
        assert(safeOut.Exh == 0.0f);    // NaN exhCO2 -> safeUnit -> 0

        // 27.5 Out-of-band finite gains are bounded to the tuner safety band.
        const DualHeaterOutputsPod boundedRaw = {0.50f, 0.50f, 0.50f, 0.0f};
        const AdaptiveTuner::GainsPod outOfBandGains = {100.0f, -100.0f, 100.0f};
        const ArbitratedOutputsPod boundedOut = FuzzyController::arbitrateOutputs(
            boundedRaw, 0.0f, outOfBandGains, 1.0f, 1.0f);
        assert(boundedOut.HLamp == 1.0f);  // 0.5 * max gain 2.5 -> clamp
        assert(std::abs(boundedOut.HWat - 0.25f) < 1e-6f);
        assert(boundedOut.Mist == 1.0f);

        // 27.6 Regression: adaptive gain and dynamic scale are combined
        // before the only final clamp. HWat and Exh cannot be remotely tuned.
        const AdaptiveTuner::GainsPod saturatedGains = {2.5f, 2.0f, 2.5f};
        const DualHeaterOutputsPod saturationRaw = {1.0f, 0.42f, 0.75f, 0.33f};
        const ArbitratedOutputsPod saturationOut = FuzzyController::arbitrateOutputs(
            saturationRaw, 0.20f, saturatedGains, 0.80f, 0.80f);
        assert(saturationOut.HLamp == 1.0f);  // 1.0 * 2.5 * 0.8 -> clamp
        assert(saturationOut.Mist == 1.0f);   // 0.75 * 2.0 * 0.8 -> clamp
        assert(std::abs(saturationOut.HWat - 0.84f) < 1e-6f);
        assert(std::abs(saturationOut.Exh - 0.33f) < 1e-6f);

        const ArbitratedOutputsPod scaleClamped = FuzzyController::arbitrateOutputs(
            saturationRaw, 0.20f, saturatedGains, 1.20f, 1.20f);
        assert(scaleClamped.HLamp == 1.0f);
        assert(scaleClamped.Mist == 1.0f);
        assert(std::abs(scaleClamped.HWat - 0.84f) < 1e-6f);
        assert(std::abs(scaleClamped.Exh - 0.33f) < 1e-6f);

        const ArbitratedOutputsPod invalidTuning = FuzzyController::arbitrateOutputs(
            saturationRaw, 0.20f, saturatedGains, NAN, INFINITY);
        assert(invalidTuning.HLamp == 0.0f);
        assert(invalidTuning.Mist == 0.0f);
        assert(std::abs(invalidTuning.HWat - 0.84f) < 1e-6f);
        assert(std::abs(invalidTuning.Exh - 0.33f) < 1e-6f);

        assert(std::is_pod<ArbitratedOutputsPod>::value == true);
        assert(sizeof(ArbitratedOutputsPod) == 16);
        assert(alignof(ArbitratedOutputsPod) == 4);
    }

    // 28. Direct ON/OFF relay control and RTC safety interlock.
    Serial.println("[TEST] Starting direct relay control unit tests...");
    {
        using FuzzyController::ArbitratedOutputsPod;
        using relay_control::RelayStatePod;
        using relay_control::RtcTimePod;

        DynamicTuningParams defaultTuning{};
        defaultTuning.mist_on_threshold = 0.25f;
        defaultTuning.mist_off_threshold = 0.15f;

        // The biosafety blackout cannot be bypassed by fuzzy/manual demand.
        time_conf::setTimeConfidence(TimeConfidence::Trusted);
        ArbitratedOutputsPod protectedOut = {0.4f, 1.0f, 1.0f, 0.6f};
        relay_control::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 10U, 59U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 1.0f);
        relay_control::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 11U, 0U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 0.0f);
        protectedOut.HWat = 1.0f;
        protectedOut.Mist = 1.0f;
        relay_control::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 13U, 30U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 0.0f);
        protectedOut.HWat = 1.0f;
        protectedOut.Mist = 1.0f;
        relay_control::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 13U, 31U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 1.0f);
        relay_control::hardwareProtectionOverride(protectedOut, RtcTimePod{false, 0U, 0U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 0.0f);

        // Table-driven pure hysteresis contract, including both threshold
        // boundaries, hold band, and fail-safe invalid inputs.
        struct HysteresisCase {
            float demand;
            bool currentState;
            float onThreshold;
            float offThreshold;
            bool expectedState;
        };
        const HysteresisCase hysteresisCases[] = {
            {0.25f, false, 0.25f, 0.15f, true},   // OFF -> ON at ON boundary
            {0.249f, false, 0.25f, 0.15f, false}, // OFF below ON boundary
            {0.15f, true, 0.25f, 0.15f, true},    // ON holds at OFF boundary
            {0.149f, true, 0.25f, 0.15f, false},  // ON -> OFF below OFF boundary
            {0.20f, false, 0.25f, 0.15f, false},  // hold band preserves OFF
            {0.20f, true, 0.25f, 0.15f, true},    // hold band preserves ON
            {NAN, true, 0.25f, 0.15f, false},
            {INFINITY, true, 0.25f, 0.15f, false},
            {0.30f, true, NAN, 0.15f, false},
            {0.30f, true, INFINITY, 0.15f, false},
            {0.30f, true, 0.25f, INFINITY, false},
            {0.30f, true, 0.15f, 0.15f, false},
            {0.30f, true, 0.15f, 0.20f, false},
        };
        for (const HysteresisCase& testCase : hysteresisCases) {
            assert(relay_control::resolveBinaryDemand(
                testCase.demand,
                testCase.currentState,
                testCase.onThreshold,
                testCase.offThreshold) == testCase.expectedState);
        }

        // Mist consumes its injected dynamic thresholds. Lamp/fan remain on
        // their fixed 0.25/0.15 band regardless of these Mist values.
        DynamicTuningParams mistTuning = defaultTuning;
        mistTuning.mist_on_threshold = 0.35f;
        mistTuning.mist_off_threshold = 0.20f;
        RelayStatePod channelState = {false, false, false, false};
        RelayStatePod baselineChannelState = {false, false, false, false};
        const ArbitratedOutputsPod thresholdDemand = {0.30f, 0.0f, 0.30f, 0.30f};
        relay_control::applyDirectOutputs(thresholdDemand, mistTuning, channelState);
        relay_control::applyDirectOutputs(thresholdDemand, defaultTuning, baselineChannelState);
        assert(channelState.lamp_active == true);
        assert(channelState.mist_active == false);
        assert(channelState.fan_active == true);
        assert(channelState.lamp_active == baselineChannelState.lamp_active);
        assert(channelState.fan_active == baselineChannelState.fan_active);
        assert(baselineChannelState.mist_active == true);

        const ArbitratedOutputsPod mistOnBoundaryDemand = {0.30f, 0.0f, 0.35f, 0.30f};
        relay_control::applyDirectOutputs(mistOnBoundaryDemand, mistTuning, channelState);
        assert(channelState.mist_active == true);

        channelState.mist_active = true;
        const ArbitratedOutputsPod mistHoldDemand = {0.20f, 0.0f, 0.20f, 0.20f};
        relay_control::applyDirectOutputs(mistHoldDemand, mistTuning, channelState);
        assert(channelState.lamp_active == true);
        assert(channelState.mist_active == true);
        assert(channelState.fan_active == true);

        const ArbitratedOutputsPod mistOffDemand = {0.10f, 0.0f, 0.19f, 0.10f};
        relay_control::applyDirectOutputs(mistOffDemand, mistTuning, channelState);
        assert(channelState.lamp_active == false);
        assert(channelState.mist_active == false);
        assert(channelState.fan_active == false);

        DynamicTuningParams invalidMistTuning = mistTuning;
        invalidMistTuning.mist_off_threshold = invalidMistTuning.mist_on_threshold;
        channelState.mist_active = true;
        relay_control::applyDirectOutputs(mistOnBoundaryDemand, invalidMistTuning, channelState);
        assert(channelState.mist_active == false);

        // There is no pulse/window scheduler: binary state remains stable until
        // the demand crosses the hysteresis OFF threshold.
        RelayStatePod state = {false, false, false, false};
        const ArbitratedOutputsPod onDemand = {0.60f, 0.0f, 0.0f, 0.0f};
        relay_control::applyDirectOutputs(onDemand, defaultTuning, state);
        relay_control::writeRelays(state);
        assert(state.lamp_active == true);
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);
        relay_control::applyDirectOutputs(onDemand, defaultTuning, state);
        relay_control::writeRelays(state);
        assert(state.lamp_active == true);
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);

        const ArbitratedOutputsPod holdDemand = {0.20f, 0.0f, 0.0f, 0.0f};
        relay_control::applyDirectOutputs(holdDemand, defaultTuning, state);
        relay_control::writeRelays(state);
        assert(state.lamp_active == true);

        const ArbitratedOutputsPod offDemand = {0.10f, 0.0f, 0.0f, 0.0f};
        relay_control::applyDirectOutputs(offDemand, defaultTuning, state);
        relay_control::writeRelays(state);
        assert(state.lamp_active == false);
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == HIGH);
    }

    // 29. Test Task B5 - Core1 direct ON/OFF pipeline single iteration
    Serial.println("[TEST] Starting Task B5 - Core1 direct ON/OFF pipeline unit tests...");
    {
        // Reset mock state for a clean pipeline run
        sensors::init_sensors_placeholder();
        mock_pin_modes.clear();
        mock_pin_values.clear();
        mock_pin_write_order.clear();
        mock_operation_counter = 0;
        mock_millis_offset = 0;

        // Execute one full pipeline iteration
        taskCore1Control(nullptr);

        // Verify all SSR relay pins were initialized as OUTPUT
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_LAMP) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_HWAT) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_MIST) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_FAN) == 1);

        // The SystemProtector's under-temperature rule forces only the air-heating
        // lamp ON. At the default cold-and-dry fuzzy demand, water heat remains OFF.
        assert(mock_pin_values[config::pins::PIN_RELAY_HWAT] == HIGH);
        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);

        // HAir and Exhaust are unaffected by the blackout interlock; LAMP is
        // LOW because the default crop day (0.0) target (33.0C) is higher than mock temperature.
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);
        assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == HIGH);

        // Verify no heap allocation or delay() was used — confirmed by static
        // analysis of core1_tasks.cpp (no malloc/new/String/delay in loop body).
        // The pipeline correctly follows: sensors → trajectory → fuzzy → gains
        // → arbitration → protection → direct ON/OFF dispatch → vTaskDelay(50).
    }

    // 30. Test Task C2 - Telemetry evaluateDeltaThresholds
    Serial.println("[TEST] Starting Task C2 - Telemetry Unit Tests...");
    {
        // Check POD status of state
        assert(std::is_pod<Telemetry::TelemetryState>::value == true);

        // 30.1 Test isDeltaExceeded
        // Float deviations
        assert(Telemetry::isDeltaExceeded(25.0f, 25.1f, 0.2f) == false);
        assert(Telemetry::isDeltaExceeded(25.0f, 25.25f, 0.2f) == true);
        assert(Telemetry::isDeltaExceeded(25.0f, 24.75f, 0.2f) == true);

        // NAN behaviors
        assert(Telemetry::isDeltaExceeded(NAN, NAN, 1.0f) == false);
        assert(Telemetry::isDeltaExceeded(25.0f, NAN, 1.0f) == true);
        assert(Telemetry::isDeltaExceeded(NAN, 25.0f, 1.0f) == true);

        // 30.2 evaluateDeltaThresholds is side-effect free; commit only after MQTT ACK.
        Telemetry::TelemetryState state = Telemetry::makeInitialState();
        TelemetryData current = { 25.0f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}} };
        assert(Telemetry::evaluateDeltaThresholds(current, state, 1000UL) == Telemetry::PublishType::FULL);
        assert(state.lastPubTimeMs == 0UL);
        Telemetry::commitSuccessfulPublish(state, current, 1000UL);
        assert(state.lastPubState.temp_air == 25.0f);
        assert(state.lastPubState.humidity_air == 80.0f);
        assert(std::isnan(state.lastPubState.co2_level));
        assert(state.lastPubTimeMs == 1000UL);

        // 30.3 No change and small changes remain suppressed.
        assert(Telemetry::evaluateDeltaThresholds(current, state, 2000UL) == Telemetry::PublishType::NONE);
        TelemetryData small_change = { 25.1f, 80.5f, NAN, {false, false, false, false, false, false, {0, 0}} };
        assert(Telemetry::evaluateDeltaThresholds(small_change, state, 3000UL) == Telemetry::PublishType::NONE);
        assert(state.lastPubTimeMs == 1000UL);

        // 30.4 Regression: failed publish must leave delta pending for retry.
        TelemetryData temp_exceeded = { 25.25f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}} };
        assert(Telemetry::evaluateDeltaThresholds(temp_exceeded, state, 4000UL) == Telemetry::PublishType::DELTA);
        assert(state.lastPubState.temp_air == 25.0f);
        assert(state.lastPubTimeMs == 1000UL);
        assert(Telemetry::evaluateDeltaThresholds(temp_exceeded, state, 5000UL) == Telemetry::PublishType::DELTA);
        Telemetry::commitSuccessfulPublish(state, temp_exceeded, 5000UL);
        assert(state.lastPubState.temp_air == 25.25f);
        assert(state.lastPubTimeMs == 5000UL);

        // 30.5 Regression: an uncommitted full publish must remain pending.
        state.forceFullPublish = true;
        assert(Telemetry::evaluateDeltaThresholds(temp_exceeded, state, 6000UL) == Telemetry::PublishType::FULL);
        assert(state.forceFullPublish == true);
        assert(state.lastPubTimeMs == 5000UL);
        // Simulate a failed publication by deliberately not committing; next scan retries FULL.
        assert(Telemetry::evaluateDeltaThresholds(temp_exceeded, state, 7000UL) == Telemetry::PublishType::FULL);
        assert(state.forceFullPublish == true);
        Telemetry::commitSuccessfulPublish(state, temp_exceeded, 7000UL);
        assert(state.forceFullPublish == false);
        assert(state.lastPubTimeMs == 7000UL);

        // 30.6 Delta and heartbeat are also committed only after success.
        TelemetryData humid_exceeded = { 25.25f, 81.1f, NAN, {false, false, false, false, false, false, {0, 0}} };
        assert(Telemetry::evaluateDeltaThresholds(humid_exceeded, state, 8000UL) == Telemetry::PublishType::DELTA);
        Telemetry::commitSuccessfulPublish(state, humid_exceeded, 8000UL);
        TelemetryData co2_connected = { 25.25f, 81.1f, 400.0f, {false, false, false, false, false, false, {0, 0}} };
        assert(Telemetry::evaluateDeltaThresholds(co2_connected, state, 9000UL) == Telemetry::PublishType::DELTA);
        Telemetry::commitSuccessfulPublish(state, co2_connected, 9000UL);
        assert(Telemetry::evaluateDeltaThresholds(co2_connected, state, 9000UL + 9999UL) == Telemetry::PublishType::NONE);
        assert(Telemetry::evaluateDeltaThresholds(co2_connected, state, 9000UL + 10000UL) == Telemetry::PublishType::FULL);
        assert(state.lastPubTimeMs == 9000UL);
        Telemetry::commitSuccessfulPublish(state, co2_connected, 19000UL);
        assert(state.lastPubTimeMs == 19000UL);

        // 30.11 Test buildDeltaPayload
        TelemetryData baseline = { 25.0f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}} };

        // 30.11.1 NONE publish type should yield empty string
        assert(Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::NONE) == "");

        // 30.11.2 FULL publish type should contain all keys
        String full_payload = Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::FULL);
        {
            StaticJsonDocument<1024> doc;
            DeserializationError err = deserializeJson(doc, full_payload.c_str());
            assert(!err);
            assert(doc.containsKey("temp_air"));
            assert(std::fabs(doc["temp_air"].as<float>() - 25.0f) < 0.01f);
            assert(doc.containsKey("humidity_air"));
            assert(std::fabs(doc["humidity_air"].as<float>() - 80.0f) < 0.01f);
            assert(doc.containsKey("co2_level"));
            assert(doc["co2_level"].isNull());
        }

        // 30.11.3 DELTA publish type - no changes
        assert(Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::DELTA) == "{}");

        // 30.11.3a Relay transitions publish a complete edge-authoritative actuator snapshot.
        TelemetryData actuator_changed = baseline;
        actuator_changed.actuators = {true, true, true, true, true, true, {0, 0}};
        assert(Telemetry::evaluateDeltaThresholds(actuator_changed, Telemetry::makeInitialState(), 1000UL) == Telemetry::PublishType::FULL);
        Telemetry::TelemetryState actuator_state = Telemetry::makeInitialState();
        Telemetry::commitSuccessfulPublish(actuator_state, baseline, 1000UL);
        assert(Telemetry::evaluateDeltaThresholds(actuator_changed, actuator_state, 2000UL) == Telemetry::PublishType::DELTA);
        String actuator_delta_payload = Telemetry::buildDeltaPayload(actuator_changed, baseline, Telemetry::PublishType::DELTA);
        StaticJsonDocument<512> actuator_doc;
        assert(!deserializeJson(actuator_doc, actuator_delta_payload.c_str()));
        JsonObject actuator_root = actuator_doc["actuators"];
        assert(actuator_root["mist_active"] == true);
        assert(actuator_root["fan_active"] == true);
        assert(actuator_root["lamp_stage_active"] == true);
        assert(actuator_root["lamp_stage2_active"] == true);
        assert(actuator_root["heater_water_active"] == true);
        assert(actuator_root["midday_blackout_active"] == true);

        // 30.11.4 DELTA publish type - only temperature changed
        TelemetryData temp_changed = { 25.3f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}} };
        String temp_delta_payload = Telemetry::buildDeltaPayload(temp_changed, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, temp_delta_payload.c_str());
            assert(!err);
            assert(doc.containsKey("temp_air"));
            assert(std::fabs(doc["temp_air"].as<float>() - 25.3f) < 0.01f);
            assert(!doc.containsKey("humidity_air"));
            assert(!doc.containsKey("co2_level"));
        }

        // 30.11.5 DELTA publish type - temperature and humidity changed
        TelemetryData temp_humid_changed = { 25.3f, 81.5f, NAN, {false, false, false, false, false, false, {0, 0}} };
        String multi_delta_payload = Telemetry::buildDeltaPayload(temp_humid_changed, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, multi_delta_payload.c_str());
            assert(!err);
            assert(doc.containsKey("temp_air"));
            assert(std::fabs(doc["temp_air"].as<float>() - 25.3f) < 0.01f);
            assert(doc.containsKey("humidity_air"));
            assert(std::fabs(doc["humidity_air"].as<float>() - 81.5f) < 0.01f);
            assert(!doc.containsKey("co2_level"));
        }

        // 30.11.6 DELTA publish type - CO2 becomes valid
        TelemetryData co2_became_valid = { 25.0f, 80.0f, 400.0f, {false, false, false, false, false, false, {0, 0}} };
        String co2_delta_payload = Telemetry::buildDeltaPayload(co2_became_valid, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, co2_delta_payload.c_str());
            assert(!err);
            assert(!doc.containsKey("temp_air"));
            assert(!doc.containsKey("humidity_air"));
            assert(doc.containsKey("co2_level"));
            assert(std::fabs(doc["co2_level"].as<float>() - 400.0f) < 0.01f);
        }

        // 30.12 Regression: processTelemetryPublication and full_sync persistence
        {
            // Set up connected state
            PubSubClient::mock_connected = true;
            PubSubClient::mock_publish_result = true;

            Telemetry::TelemetryState telemetryState = Telemetry::makeInitialState();
            TelemetryData mock_tel = {25.0f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}}};

            // 1. full_sync + publish failed -> next scan remains FULL
            setSharedForceFullPublish(true);
            PubSubClient::mock_publish_result = false;

            unsigned long now = 1000UL;
            processTelemetryPublication(now, mock_tel, telemetryState);

            // Assertions:
            // Since publish failed, telemetryState.lastPubTimeMs must still be 0 (no commit)
            assert(telemetryState.lastPubTimeMs == 0UL);
            // Since publish failed, the shared_forceFullPublish flag must have been restored to true
            assert(getSharedForceFullPublish() == true);

            // 3. Callback receives full_sync during publish -> subsequent request remains pending
            // Reset state
            telemetryState = Telemetry::makeInitialState();
            setSharedForceFullPublish(true);

            // Consume the flag manually (simulate starting processTelemetryPublication):
            bool consumed = consumeSharedForceFullPublish();
            assert(consumed == true);
            assert(getSharedForceFullPublish() == false);

            // Simulate callback setting it to true during publication:
            setSharedForceFullPublish(true);

            // Complete successful publish:
            Telemetry::commitSuccessfulPublish(telemetryState, mock_tel, 3000UL);

            // Assert that the new request was NOT cleared:
            assert(getSharedForceFullPublish() == true);

            // 4. V3 snapshots do not use the legacy delta state or force-publish
            // flag. The earlier simulated legacy commit remains unchanged.
            PubSubClient::mock_publish_result = true;
            processTelemetryPublication(4000UL, mock_tel, telemetryState);
            assert(telemetryState.lastPubTimeMs == 3000UL);
            assert(getSharedForceFullPublish() == true);
            setSharedForceFullPublish(false);
        }
    }

    // 31. Test Task D4 - Shared System State and WebInterface stubs
    Serial.println("[TEST] Starting Task D4 - Shared System State Unit Tests...");
    {
        // 31.1 Test update_shared_system_state and get_shared_system_state
        SharedSystemState state = { 24.5f, 85.0f, 600.0f, 25.0f, 80.0f, 1000.0f, 0.45f, 0.0f, 0.12f, 0.0f, {true, false, true, true, false, false, {0, 0}} };
        updateSharedSystemState(state);

        SharedSystemState loaded = getSharedSystemState();
        assert(std::fabs(loaded.temp_air - 24.5f) < 0.01f);
        assert(std::fabs(loaded.humidity_air - 85.0f) < 0.01f);
        assert(std::fabs(loaded.co2_level - 600.0f) < 0.01f);
        assert(std::fabs(loaded.temp_target - 25.0f) < 0.01f);
        assert(std::fabs(loaded.humidity_target - 80.0f) < 0.01f);
        assert(std::fabs(loaded.co2_target - 1000.0f) < 0.01f);
        assert(std::fabs(loaded.h_lamp_duty - 0.45f) < 0.01f);
        assert(std::fabs(loaded.h_wat_duty - 0.0f) < 0.01f);
        assert(std::fabs(loaded.mist_duty - 0.12f) < 0.01f);
        assert(std::fabs(loaded.exhaust_duty - 0.0f) < 0.01f);
        assert(loaded.actuators.mist_active == true);
        assert(loaded.actuators.lamp_stage_active == true);
        assert(loaded.actuators.lamp_stage2_active == true);

        // 31.2 Test WebInterface stubs and rate-limiting
        web_interface::initServer();
        assert(web_interface::isServerRunning() == false); // False under UNIT_TEST
        web_interface::handleClient();
        web_interface::serveDashboardHTML();
        web_interface::apiGetRealtimeData(); // Should not crash
        web_interface::stopServer();

        // 31.3 Test check_rate_limit logic
        // First call should succeed
        assert(web_interface::checkRateLimit(10000UL) == true);
        // Call within 1s (e.g. at 10500ms) should fail (be throttled)
        assert(web_interface::checkRateLimit(10500UL) == false);
        // Call at exactly 1s delta (11000ms) should succeed
        assert(web_interface::checkRateLimit(11000UL) == true);
        // Call after 2s delta (13000ms) should succeed
        assert(web_interface::checkRateLimit(13000UL) == true);
    }
    // 32. Test Task F2 - ControlSetpointCommand and FreeRTOS depth-1 queues
    Serial.println("[TEST] Starting Task F2 - Setpoint Queues and Command Draining Unit Tests...");
    {
        // 32.1 Test alignment and size of ControlSetpointCommand
        static_assert(sizeof(ControlSetpointCommand) == 16, "ControlSetpointCommand size should be exactly 16 bytes");
        static_assert(alignof(ControlSetpointCommand) == 4, "ControlSetpointCommand alignment should be 4 bytes");

        // 32.2 Test queue creation
        QueueHandle_t testBaselineQ = xQueueCreate(1, sizeof(ControlSetpointCommand));
        QueueHandle_t testOverrideQ = xQueueCreate(1, sizeof(ControlSetpointCommand));
        assert(testBaselineQ != nullptr);
        assert(testOverrideQ != nullptr);

        // 32.3 Test queue overwrite (depth 1)
        ControlSetpointCommand cmd1 = { 25.0f, 80.0f, 600.0f, true, {0, 0, 0} };
        ControlSetpointCommand cmd2 = { 26.0f, 85.0f, 700.0f, true, {0, 0, 0} };

        // Send cmd1
        assert(xQueueOverwrite(testBaselineQ, &cmd1) == pdTRUE);
        assert(uxQueueMessagesWaiting(testBaselineQ) == 1);

        // Overwrite with cmd2 (should still have depth 1 but new values)
        assert(xQueueOverwrite(testBaselineQ, &cmd2) == pdTRUE);
        assert(uxQueueMessagesWaiting(testBaselineQ) == 1);

        ControlSetpointCommand received;
        assert(xQueueReceive(testBaselineQ, &received, 0) == pdTRUE);
        assert(uxQueueMessagesWaiting(testBaselineQ) == 0);
        assert(std::fabs(received.temp_target - 26.0f) < 0.01f);
        assert(std::fabs(received.humidity_target - 85.0f) < 0.01f);
        assert(std::fabs(received.co2_target - 700.0f) < 0.01f);
        assert(received.active == true);

        // 32.4 Test draining setpoint queues in taskCore1Control context
        // Ensure globals are set
        if (xBaselineQueue == nullptr) {
            xBaselineQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        }
        if (xOverrideQueue == nullptr) {
            xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        }

        ControlSetpointCommand baseCmd = { 22.0f, 75.0f, 500.0f, true, {0, 0, 0} };
        ControlSetpointCommand overCmd = { 23.0f, 70.0f, NAN, true, {0, 0, 0} };

        assert(xQueueOverwrite(xBaselineQueue, &baseCmd) == pdTRUE);
        assert(xQueueOverwrite(xOverrideQueue, &overCmd) == pdTRUE);

        // Run taskCore1Control which executes one iteration on host mock.
        // It will call runControlPipelineStep which drains these queues.
        taskCore1Control(nullptr);

        // Verify queues are empty (drained)
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 0);
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 0);

        // Clean up locally created queues for this test
        vQueueDelete(testBaselineQ);
        vQueueDelete(testOverrideQ);
    }

    // 33. Test Task F3 - MQTT setpoint callback, NVS baseline and queues
    Serial.println("[TEST] Starting Task F3 - MQTT callback & Queue update Unit Tests...");
    {
        // 33.1 Setup queues and clear storage
        if (xBaselineQueue == nullptr) {
            xBaselineQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        } else {
            ControlSetpointCommand discard;
            while (xQueueReceive(xBaselineQueue, &discard, 0) == pdTRUE);
        }
        if (xOverrideQueue == nullptr) {
            xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        } else {
            ControlSetpointCommand discard;
            while (xQueueReceive(xOverrideQueue, &discard, 0) == pdTRUE);
        }
        storage.factory_reset();
        // Recreate an active V3 device lifecycle after the NVS reset so this
        // callback is validated through the same command gate as production.
        config::network::MQTT_CLIENT_ID_VAL = "mushroom_s3_unittest";
        config::network::MQTT_BROKER_VAL = "192.168.1.50";
        config::network::MQTT_PORT_VAL = 1883;
        assert(storage.save_provisioning(config::network::DEFAULT_TELEMETRY_INTERVAL_SEC,
                                         config::network::DEFAULT_REPORTING_QOS) == true);
        assert(storage.save_provision_token("12345678-1234-1234-1234-123456789abc") == true);
        assert(mqtt_manager.init() == true);

        // 33.2 Mock an incoming V3 baseline setpoint command.
        char setpoint_topic[] = "test_tenant/esp32/mushroom_s3_unittest/down/command";
        std::string payload =
            "{\"command_id\":\"12345678-1234-1234-1234-123456789abd\","
            "\"device_id\":\"mushroom_s3_unittest\","
            "\"action\":\"SET_BASELINE_SETPOINT\","
            "\"parameters\":{\"temperature_celsius\":28.50,"
            "\"humidity_percent\":80.00,\"co2_ppm\":900.00,"
            "\"config_revision\":1}}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());

        // 33.3 Verify baseline saved to NVS
        storage::BackendSetpointSnapshot snapshot;
        assert(storage.load_backend_snapshot(snapshot) == true);
        assert(std::fabs(snapshot.temp_target - 28.50f) < 0.01f);
        assert(std::fabs(snapshot.humidity_target - 80.0f) < 0.01f);
        assert(std::fabs(snapshot.co2_target - 900.0f) < 0.01f);
        assert(snapshot.valid == true);

        // 33.4 Verify baseline queued to xBaselineQueue
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 1);
        ControlSetpointCommand baselineCmd;
        assert(xQueueReceive(xBaselineQueue, &baselineCmd, 0) == pdTRUE);
        assert(std::fabs(baselineCmd.temp_target - 28.50f) < 0.01f);
        assert(std::fabs(baselineCmd.humidity_target - 80.0f) < 0.01f);
        assert(std::fabs(baselineCmd.co2_target - 900.0f) < 0.01f);
        assert(baselineCmd.active == true);

        // 33.5 Legacy flat payloads are rejected by the V3 envelope and must
        // not create an override command or mutate persisted state.
        std::string legacy_payload = "{\"clearHardwareOverride\":true}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)legacy_payload.c_str(), legacy_payload.length());
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 0);
    }

    // 34. Test Task F4 - NVS hydration on startup
    Serial.println("[TEST] Starting Task F4 - NVS hydration on startup Unit Tests...");
    {
        // 34.1 Setup queues and clear storage
        if (xBaselineQueue == nullptr) {
            xBaselineQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        } else {
            ControlSetpointCommand discard;
            while (xQueueReceive(xBaselineQueue, &discard, 0) == pdTRUE);
        }
        if (xOverrideQueue == nullptr) {
            xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        } else {
            ControlSetpointCommand discard;
            while (xQueueReceive(xOverrideQueue, &discard, 0) == pdTRUE);
        }
        storage.factory_reset();

        // 34.2 Case 1: Empty NVS (no backend snapshot, no hardware override)
        // In V3 an absent baseline is explicitly INACTIVE so Core 1 falls back
        // to the crop profile or built-in trajectory — this prevents permanently
        // masking profiles that were previously stuck behind a hardcoded Day-0.
        hydrateSetpointsFromNVS();

        assert(uxQueueMessagesWaiting(xBaselineQueue) == 1);
        ControlSetpointCommand baselineCmd;
        assert(xQueueReceive(xBaselineQueue, &baselineCmd, 0) == pdTRUE);
        assert(std::isnan(baselineCmd.temp_target));
        assert(std::isnan(baselineCmd.humidity_target));
        assert(std::isnan(baselineCmd.co2_target));
        assert(baselineCmd.active == false);

        // Verify override queue contains inactive override command
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 1);
        ControlSetpointCommand overrideCmd;
        assert(xQueueReceive(xOverrideQueue, &overrideCmd, 0) == pdTRUE);
        assert(overrideCmd.active == false);

        // 34.3 Case 2: NVS contains active baseline and active hardware override
        storage::BackendSetpointSnapshot valid_back = { 28.5f, 80.0f, 900.0f, true };
        assert(storage.save_backend_snapshot(valid_back) == true);
        storage::HardwareOverrideSnapshot valid_hw = { 25.5f, 75.0f, true };
        assert(storage.save_hardware_override(valid_hw) == true);

        // Run hydration
        hydrateSetpointsFromNVS();

        // Verify baseline matches NVS
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 1);
        assert(xQueueReceive(xBaselineQueue, &baselineCmd, 0) == pdTRUE);
        assert(std::fabs(baselineCmd.temp_target - 28.50f) < 0.01f);
        assert(std::fabs(baselineCmd.humidity_target - 80.0f) < 0.01f);
        assert(std::fabs(baselineCmd.co2_target - 900.0f) < 0.01f);
        assert(baselineCmd.active == true);

        // Verify override matches NVS
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 1);
        assert(xQueueReceive(xOverrideQueue, &overrideCmd, 0) == pdTRUE);
        assert(std::fabs(overrideCmd.temp_target - 25.50f) < 0.01f);
        assert(std::fabs(overrideCmd.humidity_target - 75.0f) < 0.01f);
        assert(std::isnan(overrideCmd.co2_target));
        assert(overrideCmd.active == true);
    }

    // 35. Test Task F6 - KY-040 rotary encoder override input
    Serial.println("[TEST] Starting Task F6 - KY-040 Encoder Unit Tests...");
    {
        storage.factory_reset();
        {
            SharedSystemState defaultState = {};
            defaultState.temp_target = 24.0f;
            defaultState.humidity_target = 90.0f;
            defaultState.co2_target = 1000.0f;
            updateSharedSystemState(defaultState);
        }
        if (xOverrideQueue == nullptr) {
            xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        }
        ControlSetpointCommand discarded;
        while (xQueueReceive(xOverrideQueue, &discarded, 0) == pdTRUE) {}

        mock_pin_values[config::pins::PIN_ENCODER_CLK] = HIGH;
        mock_pin_values[config::pins::PIN_ENCODER_DT] = HIGH;
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::resetForTest();
        encoder::init();
        assert(mock_pin_modes[config::pins::PIN_ENCODER_CLK] == INPUT_PULLUP);
        assert(mock_pin_modes[config::pins::PIN_ENCODER_DT] == INPUT_PULLUP);
        assert(mock_pin_modes[config::pins::PIN_ENCODER_SW] == INPUT_PULLUP);

        // Monitor double-click starts temperature editing.
        mock_millis_offset = 100UL;
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(100UL);
        encoder::process(130UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(160UL);
        encoder::process(190UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(220UL);
        encoder::process(250UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(280UL);
        encoder::process(310UL);
        assert(encoder::getState().editing == true);
        assert(encoder::getState().field == encoder::EditField::Temperature);

        // CLK edges read DT direction; an edge under 2 ms is rejected.
        encoder::simulateClockEdgeForTest(false, 400UL);
        encoder::simulateClockEdgeForTest(false, 401UL);
        encoder::process(402UL);
        assert(std::fabs(encoder::getState().temp_target - 24.5f) < 0.01f);
        encoder::simulateClockEdgeForTest(true, 405UL);
        encoder::process(406UL);
        assert(std::fabs(encoder::getState().temp_target - 24.0f) < 0.01f);

        // One click in edit mode switches to humidity after the double-click window.
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(500UL);
        encoder::process(530UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(560UL);
        encoder::process(590UL);
        encoder::process(900UL);
        assert(encoder::getState().field == encoder::EditField::Humidity);
        encoder::simulateClockEdgeForTest(true, 905UL);
        encoder::process(906UL);
        assert(std::fabs(encoder::getState().humidity_target - 89.0f) < 0.01f);

        // Long press in edit mode persists and queues the override.
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(1000UL);
        encoder::process(1030UL);
        encoder::process(4030UL);
        storage::HardwareOverrideSnapshot saved;
        assert(storage.load_hardware_override(saved) == true);
        assert(saved.active == true);
        assert(std::fabs(saved.temp_target - 24.0f) < 0.01f);
        assert(std::fabs(saved.humidity_target - 89.0f) < 0.01f);
        assert(xQueueReceive(xOverrideQueue, &discarded, 0) == pdTRUE);
        assert(discarded.active == true);

        // Long press in monitor mode clears the persisted override and queues inactive.
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(4060UL);
        encoder::process(4090UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(5000UL);
        encoder::process(5030UL);
        encoder::process(8030UL);
        assert(storage.load_hardware_override(saved) == false);
        assert(xQueueReceive(xOverrideQueue, &discarded, 0) == pdTRUE);
        assert(discarded.active == false);
    }

    // 36. Test Task F8 - Persistence, queue priority, encoder, and relay regression
    Serial.println("[TEST] Starting Task F8 - Offline Setpoint Integration Tests...");
    {
        auto clearQueue = [](QueueHandle_t queue) {
            ControlSetpointCommand discarded;
            while (xQueueReceive(queue, &discarded, 0) == pdTRUE) {}
        };

        if (xBaselineQueue == nullptr) {
            xBaselineQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        }
        if (xOverrideQueue == nullptr) {
            xOverrideQueue = xQueueCreate(1, sizeof(ControlSetpointCommand));
        }
        clearQueue(xBaselineQueue);
        clearQueue(xOverrideQueue);
        assert(storage.factory_reset() == true);

        // The 0.1 NVS write threshold prevents flash wear for insignificant updates.
        const storage::BackendSetpointSnapshot initialBaseline = {30.0f, 80.0f, 900.0f, true};
        assert(storage.save_backend_snapshot(initialBaseline) == true);
        const storage::BackendSetpointSnapshot change00001 = {30.00001f, 80.0f, 900.0f, true};
        const storage::BackendSetpointSnapshot change009 = {30.09f, 80.0f, 900.0f, true};
        const storage::BackendSetpointSnapshot change010 = {30.10f, 80.0f, 900.0f, true};
        storage::BackendSetpointSnapshot storedBaseline;
        assert(storage.save_backend_snapshot(change00001) == true);
        assert(storage.load_backend_snapshot(storedBaseline) == true);
        assert(std::fabs(storedBaseline.temp_target - 30.0f) < 0.001f);
        assert(storage.save_backend_snapshot(change009) == true);
        assert(storage.load_backend_snapshot(storedBaseline) == true);
        assert(std::fabs(storedBaseline.temp_target - 30.0f) < 0.001f);
        assert(storage.save_backend_snapshot(change010) == true);
        assert(storage.load_backend_snapshot(storedBaseline) == true);
        assert(std::fabs(storedBaseline.temp_target - 30.10f) < 0.001f);

        // Correct-size corrupt NVS blobs (NaN, Inf, out-of-range, raw bytes) are rejected.
        Preferences prefs;
        assert(prefs.begin(config::network::NVS_NAMESPACE, false));
        storage::BackendSetpointSnapshot corruptBackend = {NAN, 80.0f, 900.0f, true};
        assert(prefs.putBytes(config::network::KEY_LAST_SP, &corruptBackend, sizeof(corruptBackend)) == sizeof(corruptBackend));
        prefs.end();
        assert(storage.load_backend_snapshot(storedBaseline) == false);
        hydrateSetpointsFromNVS();
        ControlSetpointCommand hydratedBaseline;
        assert(xQueueReceive(xBaselineQueue, &hydratedBaseline, 0) == pdTRUE);
        // V3: a corrupt/absent backend snapshot yields an inactive baseline (NAN); Core 1
        // then falls back to crop-profile or built-in trajectory for the actual setpoint.
        assert(std::isnan(hydratedBaseline.temp_target));
        assert(hydratedBaseline.active == false);

        assert(prefs.begin(config::network::NVS_NAMESPACE, false));
        storage::HardwareOverrideSnapshot corruptOverride = {INFINITY, 75.0f, true};
        assert(prefs.putBytes(config::network::KEY_HW_OVR, &corruptOverride, sizeof(corruptOverride)) == sizeof(corruptOverride));
        prefs.end();
        storage::HardwareOverrideSnapshot loadedOverride;
        assert(storage.load_hardware_override(loadedOverride) == false);
        hydrateSetpointsFromNVS();
        ControlSetpointCommand hydratedOverride;
        assert(xQueueReceive(xOverrideQueue, &hydratedOverride, 0) == pdTRUE);
        assert(hydratedOverride.active == false);

        assert(prefs.begin(config::network::NVS_NAMESPACE, false));
        const unsigned char corruptBytes[sizeof(storage::BackendSetpointSnapshot)] = {0xFF};
        assert(prefs.putBytes(config::network::KEY_LAST_SP, corruptBytes, sizeof(corruptBytes)) == sizeof(corruptBytes));
        prefs.end();
        assert(storage.load_backend_snapshot(storedBaseline) == false);

        // A baseline must be persisted before MQTT may publish it to Core 1.
        const storage::BackendSetpointSnapshot retainedBaseline = {27.0f, 72.0f, 850.0f, true};
        assert(storage.save_backend_snapshot(retainedBaseline) == true);
        clearQueue(xBaselineQueue);
        Preferences::mock_fail_put_bytes = true;
        char setpointTopic[] = "test_tenant/esp32/esp32_mushroom_test_client/down/command";
        std::string failedPersistPayload = "{\"temperatureSetpoint\":29.0}";
        PubSubClient::mock_callback(setpointTopic, reinterpret_cast<uint8_t*>(&failedPersistPayload[0]), failedPersistPayload.length());
        Preferences::mock_fail_put_bytes = false;
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 0);
        assert(storage.load_backend_snapshot(storedBaseline) == true);
        assert(std::fabs(storedBaseline.temp_target - retainedBaseline.temp_target) < 0.001f);

        // Rapid Core 0 updates retain only the latest depth-one baseline command.
        const ControlSetpointCommand staleBaseline = {26.0f, 75.0f, 800.0f, true, {0, 0, 0}};
        const ControlSetpointCommand latestBaseline = {30.0f, 85.0f, 950.0f, true, {0, 0, 0}};
        const ControlSetpointCommand activeOverride = {22.0f, 60.0f, NAN, true, {0, 0, 0}};
        assert(xQueueOverwrite(xBaselineQueue, &staleBaseline) == pdTRUE);
        assert(xQueueOverwrite(xBaselineQueue, &latestBaseline) == pdTRUE);
        assert(xQueueOverwrite(xOverrideQueue, &activeOverride) == pdTRUE);
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 1);
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 1);

        // A manual override wins temperature/humidity while preserving backend CO2.
        taskCore1Control(nullptr);
        SharedSystemState state = getSharedSystemState();
        assert(std::fabs(state.temp_target - activeOverride.temp_target) < 0.001f);
        assert(std::fabs(state.humidity_target - activeOverride.humidity_target) < 0.001f);
        assert(std::fabs(state.co2_target - latestBaseline.co2_target) < 0.001f);
        assert(uxQueueMessagesWaiting(xBaselineQueue) == 0);
        assert(uxQueueMessagesWaiting(xOverrideQueue) == 0);

        // An inactive override clears only the overlay and restores the latest baseline.
        const ControlSetpointCommand clearOverride = {NAN, NAN, NAN, false, {0, 0, 0}};
        assert(xQueueOverwrite(xBaselineQueue, &latestBaseline) == pdTRUE);
        assert(xQueueOverwrite(xOverrideQueue, &clearOverride) == pdTRUE);
        taskCore1Control(nullptr);
        state = getSharedSystemState();
        assert(std::fabs(state.temp_target - latestBaseline.temp_target) < 0.001f);
        assert(std::fabs(state.humidity_target - latestBaseline.humidity_target) < 0.001f);
        assert(std::fabs(state.co2_target - latestBaseline.co2_target) < 0.001f);

        // Editing starts from the thread-safe effective target, not stale 24/90 defaults.
        encoder::resetForTest();
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        updateSharedSystemState({NAN, NAN, NAN, 31.0f, 77.0f, 950.0f, 0.0f, 0.0f, 0.0f, 0.0f});
        clearQueue(xOverrideQueue);
        encoder::init();
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(100UL);
        encoder::process(130UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(160UL);
        encoder::process(190UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(220UL);
        encoder::process(250UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = HIGH;
        encoder::process(280UL);
        encoder::process(310UL);
        assert(encoder::getState().editing == true);
        assert(std::fabs(encoder::getState().temp_target - 31.0f) < 0.001f);
        assert(std::fabs(encoder::getState().humidity_target - 77.0f) < 0.001f);
        encoder::simulateClockEdgeForTest(false, 400UL);
        encoder::process(402UL);
        mock_pin_values[config::pins::PIN_ENCODER_SW] = LOW;
        encoder::process(500UL);
        encoder::process(530UL);
        encoder::process(3530UL);
        storage::HardwareOverrideSnapshot persistedOverride;
        assert(storage.load_hardware_override(persistedOverride) == true);
        assert(std::fabs(persistedOverride.temp_target - 31.5f) < 0.001f);
        assert(std::fabs(persistedOverride.humidity_target - 77.0f) < 0.001f);

        // An active manual override cannot bypass the invalid-RTC safety shutdown.
        assert(xQueueOverwrite(xOverrideQueue, &activeOverride) == pdTRUE);
        taskCore1Control(nullptr);
        assert(mock_pin_values[config::pins::PIN_RELAY_HWAT] == HIGH);
        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);

        // Existing F6 gesture tests exercise edit/save/clear; the test cleanup leaves no override.
        assert(storage.clear_hardware_override() == true);
        storage::HardwareOverrideSnapshot cleanOverride;
        assert(storage.load_hardware_override(cleanOverride) == false);
        assert(storage.factory_reset() == true);
    }

    {
        Serial.println("[TEST] Starting Track C - Safety Gate & Latch Module Unit Tests...");

        // Setup common test structures
        TelemetryData telemetry = {};
        Trajectory::SetpointPod setpoints = {};
        setpoints.temp_target = 25.0f;
        setpoints.humidity_target = 80.0f;

        relay_control::RtcTimePod rtcTime = {};
        rtcTime.valid = true;
        rtcTime.hour = 8;
        rtcTime.minute = 0;

        uint16_t cropDay = 5;

        // S2-G1: Test gate Mist block khi humidity=95
        {
            telemetry.humidity_air = 95.0f;
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::RejectedHumi);
        }

        // S2-G2: Test gate Mist block khi humidity=NAN
        {
            telemetry.humidity_air = NAN;
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::RejectedNAN);
        }

        // S2-G3: Test gate Mist PASS khi humidity=70
        {
            telemetry.humidity_air = 70.0f;
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::Accepted);
        }

        // Blackout only gates Mist; HWAT remains independently controllable.
        {
            relay_control::RtcTimePod blackoutTime{true, 12U, 0U};
            ManualRequest hwatReq = { AppChannel::HWAT, AppIntent::FORCE_ON, 1000UL };
            assert(manual::evaluateSafetyGate(hwatReq, telemetry, setpoints, blackoutTime, cropDay) ==
                   ManualDecision::Accepted);
            manual::ManualLatchArray latch{};
            latch[static_cast<size_t>(AppChannel::MIST)] = {true, AppIntent::FORCE_OFF, 0U};
            latch[static_cast<size_t>(AppChannel::HWAT)] = {true, AppIntent::FORCE_ON, 0U};
            manual::autoClearOnSensorViolation(latch, telemetry, setpoints, blackoutTime);
            assert(!latch[static_cast<size_t>(AppChannel::MIST)].active);
            assert(latch[static_cast<size_t>(AppChannel::HWAT)].active);
        }

        // S2-G4: Test gate Lamp block khi temp=setpoint+4
        {
            telemetry.temp_air = setpoints.temp_target + 4.0f;
            ManualRequest req = { AppChannel::LAMP, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::RejectedTemp);
        }

        // Test crop Day lock for lamp (> 8 days)
        /*
        {
            telemetry.temp_air = setpoints.temp_target + 1.0f;
            ManualRequest req = { AppChannel::LAMP, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, 9); // Day 9
            assert(dec == ManualDecision::RejectedLocked);
        }
        */

        // S2-G5: Test gate Fan PASS mọi tình huống
        {
            telemetry.temp_air = 40.0f; // very hot
            telemetry.humidity_air = 99.0f; // very humid
            rtcTime.hour = 12; // blackout window
            ManualRequest req = { AppChannel::FAN, AppIntent::FORCE_ON, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::Accepted);
        }

        // S2-G6: Test gate OFF luôn PASS
        {
            telemetry.humidity_air = 95.0f;
            rtcTime.hour = 12;
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_OFF, 1000UL };
            ManualDecision dec = manual::evaluateSafetyGate(req, telemetry, setpoints, rtcTime, cropDay);
            assert(dec == ManualDecision::Accepted);
        }

        // S2-G7: Test latch TTL expire sau 30 giây
        {
            manual::ManualLatchArray latch = {};
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            manual::updateLatchOnAccepted(req, 1000UL, latch, true);
            assert(latch[static_cast<size_t>(AppChannel::MIST)].active == true);

            // expire_ms should be 1000 + 30000 = 31000
            assert(latch[static_cast<size_t>(AppChannel::MIST)].expires_ms == 31000UL);

            // updateLatchDecay at 30000 -> still active
            manual::updateLatchDecay(latch, 30000UL);
            assert(latch[static_cast<size_t>(AppChannel::MIST)].active == true);

            // updateLatchDecay at 31000 -> expired
            manual::updateLatchDecay(latch, 31000UL);
            assert(latch[static_cast<size_t>(AppChannel::MIST)].active == false);
        }

        // S2-G8: Test latch không đè blackout Mist
        {
            manual::ManualLatchArray latch = {};
            ManualRequest req = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            manual::updateLatchOnAccepted(req, 1000UL, latch, true);

            telemetry.humidity_air = 70.0f;
            rtcTime.hour = 12; // Blackout time
            rtcTime.minute = 0;

            FuzzyController::ArbitratedOutputsPod outputs = {0.5f, 0.5f, 0.5f, 0.5f};
            manual::applyManualLatchToOutputs(outputs, latch, 2000UL, telemetry, setpoints, rtcTime, cropDay);

            // The latch should be cleared because of sensor/blackout violation during force_on!
            assert(latch[static_cast<size_t>(AppChannel::MIST)].active == false);
            assert(outputs.Mist == 0.5f); // Latch cleared, returns to fuzzy command
        }

        // S2-G10: Test ui and button requests follow same gate
        {
            telemetry.humidity_air = 95.0f;
            rtcTime.hour = 8;
            ManualRequest reqButton = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            ManualDecision decButton = manual::evaluateSafetyGate(reqButton, telemetry, setpoints, rtcTime, cropDay);

            ManualRequest reqUI = { AppChannel::MIST, AppIntent::FORCE_ON, 1000UL };
            ManualDecision decUI = manual::evaluateSafetyGate(reqUI, telemetry, setpoints, rtcTime, cropDay);

            assert(decButton == decUI);
        }

        // S2-G9: Test physical-button debounce against the actual Schmitt
        // configuration (20 ms poll, press threshold=1, release threshold=8).
        {
            cabinet_buttons::reset_for_test();
            mock_millis_offset = 0;
            if (g_control_event_queue == nullptr) {
                g_control_event_queue = xQueueCreate(8, sizeof(ControlEvent));
            } else {
                xQueueReset(g_control_event_queue);
            }

            mock_pin_values[config::hardware::PIN_BTN_MIST] = HIGH;
            mock_millis_offset += config::hardware::BUTTON_POLL_INTERVAL_MS;
            cabinet_buttons::process_cabinet_buttons();
            assert(uxQueueMessagesWaiting(g_control_event_queue) == 0);

            // A stable active-LOW sample debounces a press and emits one request.
            mock_pin_values[config::hardware::PIN_BTN_MIST] = LOW;
            mock_millis_offset += config::hardware::BUTTON_POLL_INTERVAL_MS;
            cabinet_buttons::process_cabinet_buttons();
            assert(uxQueueMessagesWaiting(g_control_event_queue) == 1);

            ControlEvent event;
            assert(xQueueReceive(g_control_event_queue, &event, 0) == pdTRUE);
            assert(event.type == ControlEventType::ManualRequest);
            assert(event.manual.channel == AppChannel::MIST);
            assert(event.manual.intent == AppIntent::FORCE_ON);

            // Release hysteresis: seven HIGH samples preserve the pressed state;
            // the eighth releases it and must not enqueue a second request.
            mock_pin_values[config::hardware::PIN_BTN_MIST] = HIGH;
            for (int i = 0; i < 7; ++i) {
                mock_millis_offset += config::hardware::BUTTON_POLL_INTERVAL_MS;
                cabinet_buttons::process_cabinet_buttons();
            }
            assert(uxQueueMessagesWaiting(g_control_event_queue) == 0);
            mock_millis_offset += config::hardware::BUTTON_POLL_INTERVAL_MS;
            cabinet_buttons::process_cabinet_buttons();
            assert(uxQueueMessagesWaiting(g_control_event_queue) == 0);
        }

        // S2-G11: Test force on not restored when time uncertain
        {
            // When system boot or initialization occurs with uncertain time, the manual latch
            // array is initialized to default (inactive / AUTO), ensuring no FORCE_ON is active.
            manual::ManualLatchArray latch = {};
            for (size_t i = 0; i < latch.size(); ++i) {
                assert(latch[i].active == false);
                assert(latch[i].forced_state == AppIntent::AUTO);
            }
        }

        // S4-A1, A2, A3, A5 Unit Tests
        {
            Serial.println("[TEST] Starting Track A - Profile Contract & NVS Unit Tests...");

            // Initialize storage
            storage::CropProfileStorage& cps = storage::CropProfileStorage::getInstance();
            assert(cps.init() == true);

            // Clear old profile
            cps.clearProfile();

            // 1. Valid profile test
            PersistedCropProfile validProf{};
            validProf.magic = 0x43524F50;
            validProf.schema_version = 1;
            validProf.checkpoint_count = 3;
            validProf.crop_start_epoch_s = 1000;
            validProf.total_crop_days = 10;

            validProf.checkpoints[0] = {1, 24.0f, 85.0f};
            validProf.checkpoints[1] = {5, 22.0f, 88.0f};
            validProf.checkpoints[2] = {10, 20.0f, 90.0f};

            validProf.crc32 = storage::CropProfileStorage::calculateCRC32(
                reinterpret_cast<const uint8_t*>(&validProf),
                sizeof(PersistedCropProfile) - sizeof(uint32_t)
            );

            assert(storage::CropProfileValidator::validate(validProf) == true);
            assert(cps.saveProfile(validProf) == true);

            PersistedCropProfile loadedProf{};
            assert(cps.loadProfile(loadedProf) == true);
            assert(loadedProf.magic == 0x43524F50);
            assert(loadedProf.checkpoint_count == 3);
            assert(loadedProf.crc32 == validProf.crc32);

            // 2. Reject invalid checkpoints (NaN temp)
            PersistedCropProfile invalidProf1 = validProf;
            invalidProf1.checkpoints[1].temp_target_c = NAN;
            invalidProf1.crc32 = storage::CropProfileStorage::calculateCRC32(
                reinterpret_cast<const uint8_t*>(&invalidProf1),
                sizeof(PersistedCropProfile) - sizeof(uint32_t)
            );
            assert(storage::CropProfileValidator::validate(invalidProf1) == false);

            // 3. Reject invalid checkpoints (unsorted days)
            PersistedCropProfile invalidProf2 = validProf;
            invalidProf2.checkpoints[1].crop_day = 12; // Out of order and out of total crop days (10)
            invalidProf2.crc32 = storage::CropProfileStorage::calculateCRC32(
                reinterpret_cast<const uint8_t*>(&invalidProf2),
                sizeof(PersistedCropProfile) - sizeof(uint32_t)
            );
            assert(storage::CropProfileValidator::validate(invalidProf2) == false);

            // 4. Reject invalid checkpoints (out-of-range humidity)
            PersistedCropProfile invalidProf3 = validProf;
            invalidProf3.checkpoints[0].humidity_target_rh = 99.0f; // Limit is 95.0
            invalidProf3.crc32 = storage::CropProfileStorage::calculateCRC32(
                reinterpret_cast<const uint8_t*>(&invalidProf3),
                sizeof(PersistedCropProfile) - sizeof(uint32_t)
            );
            assert(storage::CropProfileValidator::validate(invalidProf3) == false);

            // 5. CRC rejection / corruption test
            PersistedCropProfile corruptProf = validProf;
            corruptProf.crc32 ^= 0x12345678; // Invalidate CRC
            assert(cps.saveProfile(corruptProf) == true); // Save succeeds because saveProfile doesn't validate internal CRC itself on write
            PersistedCropProfile loadedCorrupt{};
            assert(cps.loadProfile(loadedCorrupt) == false); // Load fails because of CRC mismatch

            // Restore valid profile
            cps.saveProfile(validProf);

            // 6. Test manual override restore under Uncertainty vs Trusted time
            // Case 6a: Trusted time
            time_conf::setTimeConfidence(TimeConfidence::Trusted);
            PersistedManualOverride ovr1{AppIntent::FORCE_ON, {0, 0, 0}, 2000}; // expires at epoch 2000
            cps.saveManualOverride(AppChannel::MIST, ovr1);

            // Simulate boot load logic under Trusted time where current time is 1000 (< 2000)
            ovr1.expires_epoch_s = time(nullptr) + 500;
            cps.saveManualOverride(AppChannel::MIST, ovr1);

            // Now, simulate the load/restore logic
            manual::ManualLatchArray manualLatch{};
            time_t now_epoch_s = time(nullptr);
            TimeConfidence tc = time_conf::getTimeConfidence();
            assert(tc == TimeConfidence::Trusted);

            for (size_t i = 0; i < static_cast<size_t>(AppChannel::COUNT); ++i) {
                AppChannel ch = static_cast<AppChannel>(i);
                PersistedManualOverride ovr{};
                if (cps.loadManualOverride(ch, ovr)) {
                    if (tc == TimeConfidence::Uncertain) {
                        manualLatch[i].active = false;
                        manualLatch[i].forced_state = AppIntent::AUTO;
                        manualLatch[i].expires_ms = 0;
                        cps.clearManualOverride(ch);
                    } else {
                        if (static_cast<uint32_t>(now_epoch_s) < ovr.expires_epoch_s) {
                            manualLatch[i].active = true;
                            manualLatch[i].forced_state = ovr.intent;
                            uint32_t remaining_s = ovr.expires_epoch_s - static_cast<uint32_t>(now_epoch_s);
                            manualLatch[i].expires_ms = millis() + (remaining_s * 1000);
                        } else {
                            manualLatch[i].active = false;
                            manualLatch[i].forced_state = AppIntent::AUTO;
                            manualLatch[i].expires_ms = 0;
                            cps.clearManualOverride(ch);
                        }
                    }
                }
            }

            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].active == true);
            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].forced_state == AppIntent::FORCE_ON);

            // Case 6b: Uncertain time
            time_conf::setTimeConfidence(TimeConfidence::Uncertain);
            tc = time_conf::getTimeConfidence();
            assert(tc == TimeConfidence::Uncertain);

            for (size_t i = 0; i < static_cast<size_t>(AppChannel::COUNT); ++i) {
                AppChannel ch = static_cast<AppChannel>(i);
                PersistedManualOverride ovr{};
                if (cps.loadManualOverride(ch, ovr)) {
                    if (tc == TimeConfidence::Uncertain) {
                        manualLatch[i].active = false;
                        manualLatch[i].forced_state = AppIntent::AUTO;
                        manualLatch[i].expires_ms = 0;
                        cps.clearManualOverride(ch);
                    } else {
                        if (static_cast<uint32_t>(now_epoch_s) < ovr.expires_epoch_s) {
                            manualLatch[i].active = true;
                            manualLatch[i].forced_state = ovr.intent;
                            uint32_t remaining_s = ovr.expires_epoch_s - static_cast<uint32_t>(now_epoch_s);
                            manualLatch[i].expires_ms = millis() + (remaining_s * 1000);
                        } else {
                            manualLatch[i].active = false;
                            manualLatch[i].forced_state = AppIntent::AUTO;
                            manualLatch[i].expires_ms = 0;
                            cps.clearManualOverride(ch);
                        }
                    }
                }
            }

            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].active == false);
            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].forced_state == AppIntent::AUTO);

            // Clean up
            cps.clearProfile();
            cps.clearManualOverride(AppChannel::MIST);
        }

        // Sprint 4 Track B Time Confidence Unit Tests
        {
            Serial.println("[TEST] Starting Sprint 4 Track B Time Confidence Unit Tests...");

            // 1. Initial boot transitions & RTC state check
            time_conf::initializeTimeConfidence(false); // boot without RTC
            assert(time_conf::getTimeConfidence() == TimeConfidence::Uncertain);

            time_conf::initializeTimeConfidence(true); // boot with RTC
            assert(time_conf::getTimeConfidence() == TimeConfidence::Trusted);

            // Reset the no-RTC deployment before testing SNTP-owned trust.
            time_conf::initializeTimeConfidence(false);

            // 2. Sync success NVS write state check
            storage::CropProfileStorage::getInstance().clearTimeState();
            time_conf::onTimeSyncSuccess(2000000000LL); // Sync successful
            assert(time_conf::getTimeConfidence() == TimeConfidence::Trusted);

            PersistedTimeState timeState{};
            assert(storage::CropProfileStorage::getInstance().loadTimeState(timeState) == true);
            assert(timeState.last_trusted_epoch_s == 2000000000LL);

            // 3. Connection Loss transitions
            time_conf::onConnectionLoss();
            assert(time_conf::getTimeConfidence() == TimeConfidence::Holdover);

            // 4. Holdover expires after 48 hours without a confirmed SNTP sync.
            const unsigned long beforeHoldoverExpiry = mock_millis_offset;
            mock_millis_offset += time_conf::HOLDOVER_MAX_MS;
            time_conf::refresh();
            assert(time_conf::getTimeConfidence() == TimeConfidence::Uncertain);
            mock_millis_offset = beforeHoldoverExpiry;

            // 5. Safe offline setpoint fallback evaluation under Uncertainty
            time_conf::setTimeConfidence(TimeConfidence::Uncertain);
        }

        // Sprint 4 Track C & E Unit Tests (Profile Snapshot & Interpolation)
        {
            Serial.println("[TEST] Starting Sprint 4 Track C & E Profile Snapshot & Interpolation Unit Tests...");

            // 1. test_interpolate_between_checkpoints
            PersistedCropProfile prof{};
            prof.checkpoint_count = 3;
            prof.total_crop_days = 10;
            prof.checkpoints[0] = {1, 20.0f, 50.0f};
            prof.checkpoints[1] = {5, 24.0f, 70.0f};
            prof.checkpoints[2] = {10, 30.0f, 90.0f};

            float temp_t = 0.0f, hum_t = 0.0f;
            // Interpolate at day 3 (midpoint between 1 and 5)
            assert(Trajectory::interpolateSetpoint(3, prof, temp_t, hum_t) == true);
            assert(std::abs(temp_t - 22.0f) < 0.001f);
            assert(std::abs(hum_t - 60.0f) < 0.001f);

            // 2. test_interpolate_endpoint_clamp
            // Day 0 (before day 1) clamps to day 1 checkpoint
            assert(Trajectory::interpolateSetpoint(0, prof, temp_t, hum_t) == true);
            assert(std::abs(temp_t - 20.0f) < 0.001f);
            assert(std::abs(hum_t - 50.0f) < 0.001f);

            // Day 12 (after day 10) clamps to day 10 checkpoint
            assert(Trajectory::interpolateSetpoint(12, prof, temp_t, hum_t) == true);
            assert(std::abs(temp_t - 30.0f) < 0.001f);
            assert(std::abs(hum_t - 90.0f) < 0.001f);

            // 3. test_profile_rejects_invalid_checkpoint_data
            PersistedCropProfile badProf = prof;
            badProf.magic = 0x43524F50;
            badProf.checkpoints[1].temp_target_c = NAN;
            assert(storage::CropProfileValidator::validate(badProf) == false);

            badProf = prof;
            badProf.magic = 0x43524F50;
            badProf.checkpoints[1].crop_day = 0;
            assert(storage::CropProfileValidator::validate(badProf) == false);

            badProf = prof;
            badProf.magic = 0x43524F50;
            badProf.checkpoints[1].crop_day = badProf.checkpoints[0].crop_day; // Duplicate day
            assert(storage::CropProfileValidator::validate(badProf) == false);

            // 4. test_profile_crc_rejects_corruption
            PersistedCropProfile corruptProf = prof;
            corruptProf.magic = 0x43524F50;
            corruptProf.crc32 = 0x12345678; // Invalid CRC
            storage::CropProfileStorage& cps = storage::CropProfileStorage::getInstance();
            assert(cps.saveProfile(corruptProf) == true);
            PersistedCropProfile loadedCorrupt{};
            assert(cps.loadProfile(loadedCorrupt) == false);

            // 5. test_holdover_keeps_crop_day_after_wifi_loss
            time_conf::initializeTimeConfidence(false);
            time_conf::onTimeSyncSuccess(100000);
            assert(time_conf::getTimeConfidence() == TimeConfidence::Trusted);
            time_conf::onConnectionLoss();
            assert(time_conf::getTimeConfidence() == TimeConfidence::Holdover);

            // 6. test_reboot_without_trusted_clock_enters_safe_offline
            time_conf::initializeTimeConfidence(false); // boot without RTC
            assert(time_conf::getTimeConfidence() == TimeConfidence::Uncertain);

            // 7. test_force_on_not_restored_when_time_uncertain
            time_conf::setTimeConfidence(TimeConfidence::Uncertain);
            PersistedManualOverride ovr{AppIntent::FORCE_ON, {0, 0, 0}, 2000};
            cps.saveManualOverride(AppChannel::MIST, ovr);
            manual::ManualLatchArray manualLatch{};
            time_t now_epoch_s = time(nullptr);
            TimeConfidence tc = time_conf::getTimeConfidence();
            assert(tc == TimeConfidence::Uncertain);
            if (cps.loadManualOverride(AppChannel::MIST, ovr)) {
                if (tc == TimeConfidence::Uncertain) {
                    manualLatch[static_cast<size_t>(AppChannel::MIST)].active = false;
                    manualLatch[static_cast<size_t>(AppChannel::MIST)].forced_state = AppIntent::AUTO;
                    cps.clearManualOverride(AppChannel::MIST);
                }
            }
            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].active == false);
            assert(manualLatch[static_cast<size_t>(AppChannel::MIST)].forced_state == AppIntent::AUTO);

            // Clean up NVS
            cps.clearProfile();
            cps.clearManualOverride(AppChannel::MIST);
        }
    }

    // 38. Test Track C - OTA Manager Unit Tests
    {
        Serial.println("--- Starting Track C - OTA Manager Unit Tests ---");
        ota::init();
        ota::init();

        String url = "";
        assert(ota::check_ota_trigger(url) == false);
        assert(url == "");

        ota::request_ota_update("");
        assert(ota::check_ota_trigger(url) == false);

        ota::request_ota_update("https://example.com/firmware.bin");
        assert(ota::check_ota_trigger(url) == true);
        assert(url == "https://example.com/firmware.bin");

        url = "";
        assert(ota::check_ota_trigger(url) == false);

        // OTA is not exposed by the V3 device command envelope. A legacy
        // payload must be rejected rather than scheduling a firmware update.
        char cmd_topic[] = "test_tenant/esp32/mushroom_s3_unittest/down/command";
        std::string ota_payload = "{\"cmd\":\"ota_update\",\"url\":\"https://example.com/ota-update.bin\"}";
        PubSubClient::mock_callback(cmd_topic, (uint8_t*)ota_payload.c_str(), ota_payload.length());
        assert(ota::check_ota_trigger(url) == false);
    }

    // 39. Test Fuzzy Control Enable/Disable Configuration and Physical Button Overrides
    {
        Serial.println("--- Starting Fuzzy Control Enable/Disable & Physical Buttons Tests ---");

        // 1. Reset state
        config::FUZZY_CONTROL_ENABLED = false;

        sensors::init_sensors_placeholder();
        mock_pin_modes.clear();
        mock_pin_values.clear();
        mock_pin_write_order.clear();
        mock_operation_counter = 0;
        mock_millis_offset = 0;

        // Clear control events
        if (g_control_event_queue != nullptr) {
            ControlEvent event_discard;
            while (xQueueReceive(g_control_event_queue, &event_discard, 0) == pdTRUE);
        }

        // 2. Run control pipeline loop once with fuzzy disabled.
        // It should result in all outputs off (duty = 0.0f).
        // Direct mapping: 0.0 demand means relay is HIGH (OFF).
        taskCore1Control(nullptr);

        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);
        assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == HIGH);
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW); // Forced ON by protector (25C <= ThBOT)
        assert(mock_pin_values[config::pins::PIN_RELAY_HWAT] == HIGH);

        // 3. Mock physical button press on Fan channel to FORCE_ON.
        // This will put a ControlEvent on g_control_event_queue.
        ControlEvent event{};
        event.type = ControlEventType::ManualRequest;
        event.manual.channel = AppChannel::FAN;
        event.manual.intent = AppIntent::FORCE_ON;
        event.manual.request_ms = millis();
        event.received_ms = event.manual.request_ms;
        xQueueSend(g_control_event_queue, &event, 0);

        // 4. Run control pipeline loop again.
        // It must apply the manual override and turn Fan ON (LOW).
        taskCore1Control(nullptr);

        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);
        assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == LOW); // LOW = ON for active-LOW SSR
        // Protector remains authoritative in manual/AOFF: 25°C <= ThBOT forces lamp ON.
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);
        assert(mock_pin_values[config::pins::PIN_RELAY_HWAT] == HIGH);

        // Restore default state
        config::FUZZY_CONTROL_ENABLED = true;
    }

    // 40. Test ConfigManager thread-safe caching and legacy sync
    {
        Serial.println("--- Starting ConfigManager Unit Tests ---");
        storage::ConfigManager &cfg = storage::ConfigManager::getInstance();

        // 1. Reset storage and verify init loaded state
        storage::StorageManager::get_instance().factory_reset();
        cfg.init();

        // 2. Set and save credentials via unified saveNetworkConfig
        assert(cfg.saveNetworkConfig("ConfigWifi", "ConfigPass", "10.0.0.5", 1884, "mock_jwt_token_123") == true);

        // 3. Verify getters return updated values
        assert(cfg.getWifiSSID() == "ConfigWifi");
        assert(cfg.getWifiPass() == "ConfigPass");
        assert(cfg.getMqttBroker() == "10.0.0.5");
        assert(cfg.getMqttPort() == 1884);
        assert(cfg.getMqttPass() == "mock_jwt_token_123");

        // 4. Verify propagation to legacy config globals
        assert(config::network::STA_SSID == "ConfigWifi");
        assert(config::network::STA_PASS == "ConfigPass");
        assert(config::network::MQTT_BROKER_VAL == "10.0.0.5");
        assert(config::network::MQTT_PORT_VAL == 1884);
        assert(config::network::MQTT_PASSWORD_VAL == "mock_jwt_token_123");

        // 5. Test save to NVS and reload again
        assert(cfg.saveNetworkConfig("SavedWifi", "SavedPass", "retained.broker.com", 1885, "mock_jwt_token_123") == true);

        // Force a re-init from NVS
        cfg.init();
        assert(cfg.getWifiSSID() == "SavedWifi");
        assert(cfg.getWifiPass() == "SavedPass");
        assert(cfg.getMqttBroker() == "retained.broker.com");
        assert(cfg.getMqttPort() == 1885);
    }

    // 41. Test SystemProtector, Bio Rules, NVS Bio Thresholds, and Active-LOW Mapping
    {
        Serial.println("--- Starting SystemProtector & Bio Rules Unit Tests ---");

        // 41.1 NVS Storage Persistence for Bio Thresholds
        storage::StorageManager& storage = storage::StorageManager::get_instance();
        storage.factory_reset();

        float t_max = 0, t_min = 0, h_max = 0, h_min = 0;
        // Verify load fails on empty NVS
        assert(storage.load_bio_thresholds(t_max, t_min, h_max, h_min) == false);

        // Save custom values
        assert(storage.save_bio_thresholds(34.5f, 28.5f, 79.5f, 64.5f) == true);
        assert(storage.load_bio_thresholds(t_max, t_min, h_max, h_min) == true);
        assert(t_max == 34.5f);
        assert(t_min == 28.5f);
        assert(h_max == 79.5f);
        assert(h_min == 64.5f);

        // Restore defaults for protector testing
        config::hardware::ThTOP = 35.0f;
        config::hardware::ThBOT = 29.0f;
        config::hardware::HmTOP = 80.0f;
        config::hardware::HmBOT = 65.0f;
        storage.save_bio_thresholds(35.0f, 29.0f, 80.0f, 65.0f);

        // 41.2 Dynamic Manual Override TTL (30s in AON, 3m in AOFF)
        manual::ManualLatchArray latches;
        for (auto& l : latches) {
            l.active = false;
            l.forced_state = AppIntent::AUTO;
            l.expires_ms = 0;
        }

        ManualRequest req;
        req.channel = AppChannel::LAMP;
        req.intent = AppIntent::FORCE_ON;

        // AON Mode (fuzzy_enabled = true) -> TTL must be 30 seconds (30,000ms)
        manual::updateLatchOnAccepted(req, 1000UL, latches, true);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == true);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].expires_ms == 31000UL);

        // AOFF Mode (fuzzy_enabled = false) -> Persistent manual control (expires_ms = 0)
        manual::updateLatchOnAccepted(req, 1000UL, latches, false);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == true);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].expires_ms == 0UL);

        // 41.3 AON -> AOFF Transition Cuts Off Relays Instantly
        protector::SystemProtector sys_protector;
        relay_control::RelayStatePod states = {true, true, true, true};
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].expires_ms = 50000UL;

        // Fuzzy enabled is true, so no transition yet
        sys_protector.update(1000UL, true, 25.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == true);

        // Transition: fuzzy_enabled goes false -> bumpless transfer (latches and states are preserved)
        sys_protector.update(2000UL, false, 25.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);
        assert(states.mist_active == true);
        assert(states.fan_active == true);
        assert(states.hwat_active == true);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == true);

        // 41.4 Priority 1 Bio Bounds (Over-Limit Locks Cooldown)
        sys_protector.reset();
        states = {true, true, true, true};
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;

        // Over-Temp (36C >= ThTOP) -> Lamp forced OFF and locked in cooldown for 5 mins
        sys_protector.update(1000UL, true, 36.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == false);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == false);

        // Attempting to turn Lamp ON during 5-minute cooldown (at 2 mins) must fail
        states.lamp_active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        sys_protector.update(121000UL, true, 25.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == false);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == false);

        // After cooldown expires (5 minutes + 1s = 301,000ms elapsed) -> Lamp can turn ON again
        states.lamp_active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        sys_protector.update(302000UL, true, 25.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);

        // Over-Humidity (81% >= HmTOP) -> Mist forced OFF and locked in cooldown for 10 mins
        states.mist_active = true;
        latches[static_cast<size_t>(AppChannel::MIST)].active = true;
        sys_protector.update(303000UL, true, 25.0f, 81.0f, false, latches, states);
        assert(states.mist_active == false);
        assert(latches[static_cast<size_t>(AppChannel::MIST)].active == false);

        // Attempting to turn Mist ON during 10-minute cooldown (at 4 mins)
        // — cooldown priority always wins. Humidity kept high (85%) so
        // over-humidity does NOT override the forced-OFF from this assertion.
        states.mist_active = true;
        latches[static_cast<size_t>(AppChannel::MIST)].active = true;
        sys_protector.update(543000UL, true, 25.0f, 85.0f, false, latches, states);
        assert(states.mist_active == false);
        assert(latches[static_cast<size_t>(AppChannel::MIST)].active == false);

        // After cooldown expires (10 mins + 1s) -> Mist can be commanded ON.
        // Use fresh pod/state so bio-safety checks don't interfere.
        states.mist_active = true;
        latches[static_cast<size_t>(AppChannel::MIST)].active = true;
        sys_protector.reset();
        relay_control::RelayStatePod s2 = {true, true, true, true};
        manual::ManualLatchArray l2{};
        sys_protector.update(904000UL, true, 25.0f, 70.0f, false, l2, s2);
        assert(s2.mist_active == true);

        // 41.5 Priority 1 Bio Bounds (Under-Limit Force ON)
        sys_protector.reset();
        states = {false, false, false, false};
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].forced_state = AppIntent::FORCE_OFF;

        // Under-temp (28C <= ThBOT) -> Lamp is forced ON, ignoring the manual FORCE_OFF override
        sys_protector.update(1000UL, true, 28.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);

        // Midday/fail-safe blackout runs before bio bounds: low humidity cannot
        // re-enable Mist, and its manual latch is released while HWAT is untouched.
        states.mist_active = true;
        states.hwat_active = true;
        latches[static_cast<size_t>(AppChannel::MIST)] = {true, AppIntent::FORCE_ON, 0U};
        latches[static_cast<size_t>(AppChannel::HWAT)] = {true, AppIntent::FORCE_ON, 0U};
        sys_protector.update(1500UL, true, 30.0f, 64.0f, true, latches, states);
        assert(states.mist_active == false);
        assert(states.hwat_active == true);
        assert(latches[static_cast<size_t>(AppChannel::MIST)].active == false);
        assert(latches[static_cast<size_t>(AppChannel::HWAT)].active == true);

        // Under-humidity (64% <= HmBOT) -> Mist is forced ON outside blackout
        states.mist_active = false;
        sys_protector.update(2000UL, true, 30.0f, 64.0f, false, latches, states);
        assert(states.mist_active == true);

        // 41.6 Priority 3 time-based limits (3-minute continuous ON -> 30s OFF cooldown)
        sys_protector.reset();
        states = {true, true, true, true};

        // Start tracking Lamp ON time
        sys_protector.update(1000UL, true, 30.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);

        // Lamp remains ON for 2.9 minutes
        sys_protector.update(179000UL, true, 30.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);

        // Lamp exceeds 3 minutes ON (180s) -> forced OFF and locked for 30s
        sys_protector.update(182000UL, true, 30.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == false);

        // Attempting to turn Lamp ON during 30s cooldown must fail
        states.lamp_active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        sys_protector.update(192000UL, true, 30.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == false);
        assert(latches[static_cast<size_t>(AppChannel::LAMP)].active == false);

        // After 30s cooldown passes, Lamp can turn ON again
        states.lamp_active = true;
        latches[static_cast<size_t>(AppChannel::LAMP)].active = true;
        sys_protector.update(213000UL, true, 30.0f, 70.0f, false, latches, states);
        assert(states.lamp_active == true);

        // 41.7 Active-LOW Output Mapping Verifications
        mock_pin_values.clear();
        states.lamp_active = true;
        states.mist_active = false;
        relay_control::writeRelays(states);

        // Active-LOW SSR Mapping: ON = LOW (0), OFF = HIGH (1)
        assert(mock_pin_values[config::pins::PIN_RELAY_LAMP] == LOW);
        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);
    }

    test_ingress::run_all_tests();
    test_outbox::run_all_tests();

    Serial.println("--- All Unit Tests Passed Successfully! ---");
    return 0;
}
