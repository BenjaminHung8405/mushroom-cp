#include "Arduino.h"
#include "Preferences.h"
#include "storage.h"
#include "config.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "definitions.h"
#include "models.h"
#include <cassert>
#include <type_traits>

HardwareSerial Serial;
std::map<std::string, std::map<std::string, std::string>> Preferences::_global_storage;

wl_status_t WiFiClass::mock_status = WL_IDLE_STATUS;
wifi_mode_t WiFiClass::mock_mode = WIFI_OFF;
std::string WiFiClass::mock_ssid = "";
std::string WiFiClass::mock_pass = "";
bool WiFiClass::disconnect_called = false;
WiFiClass WiFi;
unsigned long mock_millis_offset = 0;
bool PubSubClient::mock_connected = false;
PubSubClient::MQTT_CALLBACK_SIGNATURE PubSubClient::mock_callback = nullptr;

void setup();
void loop();

int main() {
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

    // 8. Clear WiFi credentials
    assert(storage.clear_wifi_credentials() == true);
    assert(storage.has_wifi_credentials() == false);
    assert(storage.load_wifi_credentials(loaded_ssid, loaded_pass) == false);

    // MQTT should still exist
    assert(storage.has_mqtt_config() == true);

    // 9. Factory Reset
    assert(storage.factory_reset() == true);
    assert(storage.has_mqtt_config() == false);

    // 10. Test dynamic configuration loading
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
    assert(config::network::MQTT_USER_VAL == "dynamic_user");
    assert(config::network::MQTT_PASSWORD_VAL == "dynamic_pass");

    // Clean up
    assert(storage.factory_reset() == true);

    // 11. Test WiFi Manager Connection Logic
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
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);
    assert(WiFi.disconnect_called == true);

    // Clean up
    assert(storage.factory_reset() == true);

    // 12. Test MQTT Client Initialization and Topic Resolution
    Serial.println("[TEST] Starting MQTT Client Unit Tests...");
    mqtt::MqttClient& mqtt_client = mqtt::MqttClient::get_instance();

    // 12.1 Test initialization failure when MQTT broker is empty
    config::network::MQTT_BROKER_VAL = "";
    assert(mqtt_client.init() == false);
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_CONFIG);

    // 12.2 Test successful initialization and dynamic topic resolution
    config::network::MQTT_BROKER_VAL = "192.168.1.50";
    config::network::MQTT_PORT_VAL = 1883;
    config::network::MQTT_CLIENT_ID_VAL = "esp32_mushroom_test_client";
    
    assert(mqtt_client.init() == true);
    assert(mqtt_client.get_state() == mqtt::MqttState::IDLE);
    
    {
        const mqtt::MqttTopics& topics = mqtt_client.get_resolved_topics();
        assert(topics.status == "mushroom/device/esp32_mushroom_test_client/status");
        assert(topics.telemetry == "mushroom/device/esp32_mushroom_test_client/telemetry");
        assert(topics.setpoint == "mushroom/device/esp32_mushroom_test_client/setpoint");
    }

    // 12.3 Test loop behavior when WiFi is disconnected (no connection)
    // WiFiManager is currently in STA_DISCONNECTED (from step 11)
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_WIFI);

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
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::CONNECTED);
    assert(mqtt_client.is_connected() == true);

    // 12.5 Test publish functions return value under connected state
    assert(mqtt_client.publish_status(true) == true);
    assert(mqtt_client.publish_telemetry("{\"temp\":25.5}") == true);

    // 12.6 Test incoming message parsing (Task C3)
    Serial.println("[TEST] Testing Task C3 - MQTT message parsing...");
    assert(PubSubClient::mock_callback != nullptr);

    const mqtt::MqttTopics& topics = mqtt_client.get_resolved_topics();
    char setpoint_topic[100];
    strcpy(setpoint_topic, topics.setpoint.c_str());

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

    // 13. Test Task D1 - Core 0 Communication Task
    Serial.println("[TEST] Starting Task D1 - Core 0 Communication Task Unit Tests...");
    assert(storage.factory_reset() == true);
    config::network::MQTT_BROKER_VAL = "";
    WiFi.mock_status = WL_IDLE_STATUS;
    PubSubClient::mock_connected = false;

    // Run task once
    task_core0_communication(nullptr);

    // Check that WiFi transitioned to SOFTAP_ACTIVE (since NVS credentials are empty)
    assert(wifi::get_wifi_state() == wifi::WifiState::SOFTAP_ACTIVE);
    // Check that MQTT client is in ERROR_NO_WIFI (since WiFi is not connected STA_CONNECTED)
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_WIFI);

    // Save mock credentials and MQTT config to NVS to test successful initialization path
    assert(storage.save_wifi_credentials("WiFi_STA_Test", "sta_password") == true);
    assert(storage.save_mqtt_config("192.168.1.50", 1883, "admin", "adminpass") == true);

    // Re-initialize WiFi & MQTT via next task invocation
    WiFi.mock_status = WL_CONNECTED;      // Mock WiFi as connected
    PubSubClient::mock_connected = true;   // Mock MQTT as connected

    // Run task once again
    task_core0_communication(nullptr);

    // Because NVS credentials are saved, it should load config and transition to STA_CONNECTED
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);
    assert(mqtt_client.get_state() == mqtt::MqttState::CONNECTED);

    // Clean up
    assert(storage.factory_reset() == true);

    // 14. Test main.cpp setup() and loop()
    Serial.println("[TEST] Starting Task D2 - setup() and loop() Unit Tests...");
    setup();
    loop();

    // 15. Test Task E1/E2 - Models and Data Structures POD and Alignment properties
    Serial.println("[TEST] Starting Task E1 - Models and Data Structures Unit Tests...");
    assert(std::is_pod<TelemetryData>::value == true);
    assert(std::is_pod<ActuatorCommand>::value == true);
    assert(sizeof(TelemetryData) == 12);
    assert(sizeof(ActuatorCommand) == 4);
    assert(alignof(TelemetryData) == 4);
    assert(alignof(ActuatorCommand) == 4);

    Serial.println("--- All Unit Tests Passed Successfully! ---");
    return 0;
}
