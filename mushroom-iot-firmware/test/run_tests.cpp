#include "Arduino.h"
#include "Preferences.h"
#include "storage.h"
#include "config.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "definitions.h"
#include "models.h"
#include "sensors.h"
#include "actuators.h"
#include "serial_mutex.h"
#include "MathEngine.h"
#include "Trajectory.h"
#include "AdaptiveTuner.h"
#include <cassert>
#include <type_traits>
#include <cmath>

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
uint16_t PubSubClient::mock_buffer_size = 0;
uint16_t PubSubClient::mock_keep_alive = 0;
int PubSubClient::mock_state = 0;
std::string PubSubClient::mock_server_host = "";
uint16_t PubSubClient::mock_server_port = 0;
bool PubSubClient::mock_connect_result = true;
PubSubClient::MQTT_CALLBACK_SIGNATURE PubSubClient::mock_callback = nullptr;
EventBits_t mock_event_group_bits = 0;

std::map<uint8_t, uint8_t> mock_pin_modes;
std::map<uint8_t, uint8_t> mock_pin_values;
std::map<uint8_t, int> mock_pin_write_order;
int mock_operation_counter = 0;


void setup();
void loop();

// Symbols exported from core1_tasks.cpp for test visibility
extern const uint8_t DEMO_RELAY_PINS[];
extern const size_t  DEMO_RELAY_COUNT;

int main() {
    xWifiEventGroup = xEventGroupCreate();
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

    // 8. Backend API URL check when empty, then save/load
    assert(storage.has_backend_config() == false);
    String backend_url;
    assert(storage.load_backend_config(backend_url) == false);
    assert(storage.save_backend_config("http://192.168.1.10:3001") == true);
    assert(storage.has_backend_config() == true);
    String loaded_backend_url;
    assert(storage.load_backend_config(loaded_backend_url) == true);
    assert(loaded_backend_url == "http://192.168.1.10:3001");

    // 9. Clear WiFi credentials
    assert(storage.clear_wifi_credentials() == true);
    assert(storage.has_wifi_credentials() == false);
    assert(storage.load_wifi_credentials(loaded_ssid, loaded_pass) == false);

    // MQTT and Backend API URL should still exist
    assert(storage.has_mqtt_config() == true);
    assert(storage.has_backend_config() == true);

    // 10. Factory Reset
    assert(storage.factory_reset() == true);
    assert(storage.has_mqtt_config() == false);
    assert(storage.has_backend_config() == false);

    // 11. Test dynamic configuration loading
    // Initial status should be empty
    assert(config::network::STA_SSID == "");
    assert(config::network::STA_PASS == "");
    assert(config::network::BACKEND_API_URL == config::network::DEFAULT_BACKEND_URL);

    // Save new values
    assert(storage.save_wifi_credentials("DynamicWiFi", "dynamicpass123") == true);
    assert(storage.save_mqtt_config("192.168.1.99", 1884, "dynamic_user", "dynamic_pass") == true);
    assert(storage.save_backend_config("http://farm.local:3001") == true);

    // Load config
    assert(config::network::load_runtime_config() == true);

    // Verify updated variables
    assert(config::network::STA_SSID == "DynamicWiFi");
    assert(config::network::STA_PASS == "dynamicpass123");
    assert(config::network::MQTT_BROKER_VAL == "192.168.1.99");
    assert(config::network::MQTT_PORT_VAL == 1884);
    assert(config::network::MQTT_USER_VAL == "mushroom_s3_unittest");
    assert(config::network::MQTT_PASSWORD_VAL == "dynamic_pass");
    assert(config::network::BACKEND_API_URL == "http://farm.local:3001");

    // Clean up
    assert(storage.factory_reset() == true);

    // 11b. Verify compiled MQTT default host port and init diagnostics settings
    assert(config::network::DEFAULT_MQTT_PORT == 18883);
    config::network::MQTT_BROKER_VAL = "192.168.1.164";
    config::network::MQTT_PORT_VAL = config::network::DEFAULT_MQTT_PORT;
    config::network::MQTT_CLIENT_ID_VAL = "esp32";
    PubSubClient::mock_buffer_size = 0;
    PubSubClient::mock_keep_alive = 0;
    PubSubClient::mock_server_host = "";
    PubSubClient::mock_server_port = 0;
    {
        mqtt::MqttClient& mqtt_client = mqtt::MqttClient::get_instance();
        assert(mqtt_client.init() == true);
        assert(PubSubClient::mock_buffer_size == 1024);
        assert(PubSubClient::mock_keep_alive == 60);
        assert(PubSubClient::mock_server_host == "192.168.1.164");
        assert(PubSubClient::mock_server_port == 18883);
        assert(mqtt_client.get_state() == mqtt::MqttState::IDLE);
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
    mqtt::MqttClient& mqtt_client = mqtt::MqttClient::get_instance();

    // 12.1 Test initialization failure when MQTT broker is empty
    config::network::MQTT_BROKER_VAL = "";
    assert(mqtt_client.init() == false);
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_CONFIG);

    // 12.2 Test successful initialization and dynamic topic resolution
    config::network::MQTT_BROKER_VAL = "192.168.1.50";
    config::network::MQTT_PORT_VAL = 1883;
    config::network::MQTT_CLIENT_ID_VAL = "esp32_mushroom_test_client";
    config::network::MQTT_USER_VAL = "esp32_mushroom_test_client";
    config::network::MQTT_PASSWORD_VAL = "test_pass";
    
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

    // 12.4b Test connection failure path and state diagnostics
    PubSubClient::mock_connected = false;
    PubSubClient::mock_connect_result = false;
    PubSubClient::mock_state = 4;  // MQTT_CONNECT_UNAUTHORIZED
    config::network::AUTH_JWT_TOKEN = "test_jwt_token";
    mock_millis_offset += 5000;
    mqtt_client.loop();  // detects connection loss -> DISCONNECTED
    mock_millis_offset += 5000;
    mqtt_client.loop();  // attempts reconnect, fails with state=4
    assert(mqtt_client.get_state() == mqtt::MqttState::DISCONNECTED);
    assert(PubSubClient::mock_state == 4);
    PubSubClient::mock_connect_result = true;
    mock_millis_offset += 5000;
    mqtt_client.loop();  // reconnect succeeds
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

    // Case I: Valid JSON with actuator controls (Should be ignored by design)
    {
        Serial.println("--- Case I: Valid JSON with actuator controls ---");
        bool created_temp_queue = false;
        if (xActuatorQueue == nullptr) {
            xActuatorQueue = xQueueCreate(8, sizeof(ActuatorCommand));
            created_temp_queue = true;
        } else {
            ActuatorCommand discard;
            while (xQueueReceive(xActuatorQueue, &discard, 0) == pdTRUE);
        }

        std::string payload = "{\"mist_generator_active\":true,\"convection_fan_active\":false,\"heating_lamp_active\":true}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
        
        assert(xActuatorQueue != nullptr);
        assert(uxQueueMessagesWaiting(xActuatorQueue) == 0); // Ignored - edge hysteresis safety controller owns relays.

        if (created_temp_queue) {
            vQueueDelete(xActuatorQueue);
            xActuatorQueue = nullptr;
        }
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
    Serial.println("[TEST] Starting Task E1/E2 - Models and Data Structures Unit Tests...");
    assert(std::is_pod<TelemetryData>::value == true);
    assert(std::is_pod<ActuatorCommand>::value == true);
    assert(sizeof(TelemetryData) == 12);  // 3 floats × 4 bytes (temp_air, humidity_air, co2_level)
    assert(sizeof(ActuatorCommand) == 4);
    assert(alignof(TelemetryData) == 4);
    assert(alignof(ActuatorCommand) == 4);

    // 16. Test Task F1/F2 - Sensors Mock & Fault Injection
    Serial.println("[TEST] Starting Task F1/F2 - Sensors Mock & Fault Injection Unit Tests...");
    
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

    // Check that all relay pins are configured as OUTPUT and set to LOW
    uint8_t relay_pins[] = {
        config::pins::PIN_RELAY_MIST,
        config::pins::PIN_RELAY_FAN,
        config::pins::PIN_RELAY_HEATER_1,
        config::pins::PIN_RELAY_HEATER_2
    };

    for (uint8_t pin : relay_pins) {
        // Assert pin mode is OUTPUT
        assert(mock_pin_modes.count(pin) > 0);
        assert(mock_pin_modes[pin] == OUTPUT);

        // Assert pin state is LOW (fail-safe)
        assert(mock_pin_values.count(pin) > 0);
        assert(mock_pin_values[pin] == LOW);

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
    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == HIGH);

    assert(actuators::set_relay_state(config::pins::PIN_RELAY_MIST, false) == true);
    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == LOW);

    // 18.2 Toggle all four relays individually — each must succeed
    for (uint8_t pin : relay_pins) {
        assert(actuators::set_relay_state(pin, true) == true);
        assert(mock_pin_values[pin] == HIGH);
        assert(actuators::set_relay_state(pin, false) == true);
        assert(mock_pin_values[pin] == LOW);
    }

    // 18.3 Reject invalid pins — must return false and NOT call digitalWrite
    int write_count_before = mock_operation_counter;
    assert(actuators::set_relay_state(0x00, true) == false);
    assert(actuators::set_relay_state(0xFF, true) == false);
    assert(actuators::set_relay_state(99, false) == false);
    assert(actuators::set_relay_state(config::pins::PIN_I2C_SDA, true) == false);
    assert(actuators::set_relay_state(config::pins::PIN_ONE_WIRE, true) == false);
    // Verify no extra digitalWrite calls were made for rejected pins
    assert(mock_operation_counter == write_count_before);

    // 19. Test Task H1 - Core 1 Control Task with FreeRTOS Queue Integration
    Serial.println("[TEST] Starting Task H1 - Core 1 Control Task Unit Tests...");

    // 19.1 Verify queue creation
    QueueHandle_t test_act_queue = xQueueCreate(8, sizeof(ActuatorCommand));
    QueueHandle_t test_tel_queue = xQueueCreate(4, sizeof(TelemetryData));
    assert(test_act_queue != nullptr);
    assert(test_tel_queue != nullptr);
    assert(uxQueueMessagesWaiting(test_act_queue) == 0);
    assert(uxQueueMessagesWaiting(test_tel_queue) == 0);

    // 19.2 Send an ActuatorCommand through the queue and verify it arrives intact
    ActuatorCommand cmd;
    cmd.relay_id = config::pins::PIN_RELAY_MIST;
    cmd.state    = true;
    memset(cmd.padding, 0, sizeof(cmd.padding));

    assert(xQueueSend(test_act_queue, &cmd, 0) == pdTRUE);
    assert(uxQueueMessagesWaiting(test_act_queue) == 1);

    ActuatorCommand received_cmd;
    assert(xQueueReceive(test_act_queue, &received_cmd, 0) == pdTRUE);
    assert(received_cmd.relay_id == config::pins::PIN_RELAY_MIST);
    assert(received_cmd.state == true);
    assert(uxQueueMessagesWaiting(test_act_queue) == 0);

    // 19.3 Send a second command (different relay) to verify FIFO ordering
    cmd.relay_id = config::pins::PIN_RELAY_HEATER_1;
    cmd.state    = false;
    memset(cmd.padding, 0, sizeof(cmd.padding));
    assert(xQueueSend(test_act_queue, &cmd, 0) == pdTRUE);

    ActuatorCommand received_cmd2;
    assert(xQueueReceive(test_act_queue, &received_cmd2, 0) == pdTRUE);
    assert(received_cmd2.relay_id == config::pins::PIN_RELAY_HEATER_1);
    assert(received_cmd2.state == false);

    // 19.4 Overflow guard: fill queue to capacity, then verify rejection
    for (UBaseType_t i = 0; i < 8; ++i)
    {
        ActuatorCommand overflow_cmd;
        overflow_cmd.relay_id = static_cast<uint8_t>(10 + i);
        overflow_cmd.state    = true;
        memset(overflow_cmd.padding, 0, sizeof(overflow_cmd.padding));
        assert(xQueueSend(test_act_queue, &overflow_cmd, 0) == pdTRUE);
    }
    // Queue is now full — next send must fail
    ActuatorCommand overflow_cmd;
    overflow_cmd.relay_id = 99;
    overflow_cmd.state    = true;
    memset(overflow_cmd.padding, 0, sizeof(overflow_cmd.padding));
    assert(xQueueSend(test_act_queue, &overflow_cmd, 0) == pdFALSE);
    assert(uxQueueMessagesWaiting(test_act_queue) == 8);

    // Drain all items
    ActuatorCommand drain_cmd;
    for (int i = 0; i < 8; ++i)
    {
        assert(xQueueReceive(test_act_queue, &drain_cmd, 0) == pdTRUE);
    }
    assert(uxQueueMessagesWaiting(test_act_queue) == 0);

    // 19.5 Send TelemetryData through telemetry queue
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

    // 19.6 Test task_core1_control single iteration (UNIT_TEST path)
    // Reset sensor state so init succeeds
    sensors::init_sensors_placeholder();
    mock_pin_modes.clear();
    mock_pin_values.clear();
    mock_pin_write_order.clear();
    mock_operation_counter = 0;

    // Call the task once — it will read sensors, toggle a relay, and return
    task_core1_control(nullptr);

    // Verify that at least one relay was toggled by the demo cycle
    bool any_relay_toggled = false;
    for (size_t i = 0; i < DEMO_RELAY_COUNT; ++i)
    {
        if (mock_pin_values.count(DEMO_RELAY_PINS[i]) > 0)
        {
            any_relay_toggled = true;
            break;
        }
    }
    assert(any_relay_toggled == true);

    // Verify sensors were initialized (pin modes recorded)
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_MIST) > 0);

    // 19.7 Cleanup queues
    vQueueDelete(test_act_queue);
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
        assert(low.temp_target == 24.0f);
        assert(low.humidity_target == 90.0f);
        assert(low.co2_target == 1000.0f);

        // NaN input
        Trajectory::SetpointPod nan_in = Trajectory::interpolateSetpoints(NAN);
        assert(nan_in.temp_target == 24.0f);
        assert(nan_in.humidity_target == 90.0f);
        assert(nan_in.co2_target == 1000.0f);

        // Above upper bound
        Trajectory::SetpointPod high = Trajectory::interpolateSetpoints(25.0f);
        assert(high.temp_target == 28.0f);
        assert(high.humidity_target == 80.0f);
        assert(high.co2_target == 600.0f);

        // Exactly at bounds
        Trajectory::SetpointPod bound_0 = Trajectory::interpolateSetpoints(0.0f);
        assert(bound_0.temp_target == 24.0f);
        assert(bound_0.humidity_target == 90.0f);
        assert(bound_0.co2_target == 1000.0f);

        Trajectory::SetpointPod bound_20 = Trajectory::interpolateSetpoints(20.0f);
        assert(bound_20.temp_target == 28.0f);
        assert(bound_20.humidity_target == 80.0f);
        assert(bound_20.co2_target == 600.0f);

        // 23.2 Exact day checkpoint
        Trajectory::SetpointPod day_10 = Trajectory::interpolateSetpoints(10.0f);
        assert(day_10.temp_target == 26.0f);
        assert(day_10.humidity_target == 85.0f);
        assert(day_10.co2_target == 800.0f);

        // 23.3 Interpolation between checkpoints (e.g., day 5.5)
        // Day 5: { 5.0f,  25.0f, 87.5f,  920.0f }
        // Day 6: { 6.0f,  25.2f, 87.0f,  900.0f }
        // For Day 5.5:
        // temp: 25.0 + 0.5 * (25.2 - 25.0) = 25.1
        // humidity: 87.5 + 0.5 * (87.0 - 87.5) = 87.25
        // co2: 920 + 0.5 * (900 - 920) = 910
        Trajectory::SetpointPod mid = Trajectory::interpolateSetpoints(5.5f);
        assert(std::abs(mid.temp_target - 25.1f) < 1e-4f);
        assert(std::abs(mid.humidity_target - 87.25f) < 1e-4f);
        assert(std::abs(mid.co2_target - 910.0f) < 1e-4f);
        
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
        assert(g0.gain_HAir == 1.0f);
        assert(g0.gain_HWat == 1.0f);
        assert(g0.gain_Mist == 1.0f);

        // Zero errors keep gains at nominal
        AdaptiveTuner::GainsPod g_zero = AdaptiveTuner::updateGains(state, 0.0f, 0.0f, 1.0f);
        assert(std::abs(g_zero.gain_HAir - 1.0f) < 1e-6f);
        assert(std::abs(g_zero.gain_HWat - 1.0f) < 1e-6f);
        assert(std::abs(g_zero.gain_Mist - 1.0f) < 1e-6f);
        assert(state.integral_temp == 0.0f);
        assert(state.integral_humid == 0.0f);

        // 24.2 Positive temperature error increases heater gains
        AdaptiveTuner::IntegralState cold = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_cold = AdaptiveTuner::updateGains(cold, 2.0f, 0.0f, 1.0f);
        // I_T = 2.0, gain_HAir = 1.0 + 0.10*2.0 = 1.2
        assert(std::abs(cold.integral_temp - 2.0f) < 1e-6f);
        assert(std::abs(g_cold.gain_HAir - 1.2f) < 1e-5f);
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
        assert(std::abs(g_dry.gain_HAir - 1.0f) < 1e-5f);

        // 24.4 Anti-windup: integral saturates and gains clamp to [0.5, 2.5]
        AdaptiveTuner::IntegralState windup = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_hi = AdaptiveTuner::defaultGains();
        for (int i = 0; i < 200; ++i) {
            g_hi = AdaptiveTuner::updateGains(windup, 10.0f, 20.0f, 1.0f);
        }
        assert(std::abs(windup.integral_temp - 15.0f) < 1e-5f);   // I_MAX_TEMP
        assert(std::abs(windup.integral_humid - 30.0f) < 1e-5f);  // I_MAX_HUMID
        assert(g_hi.gain_HAir <= 2.5f + 1e-6f);
        assert(g_hi.gain_HWat <= 2.5f + 1e-6f);
        assert(g_hi.gain_Mist <= 2.5f + 1e-6f);
        assert(g_hi.gain_HAir >= 0.5f - 1e-6f);
        assert(g_hi.gain_HWat >= 0.5f - 1e-6f);
        assert(g_hi.gain_Mist >= 0.5f - 1e-6f);
        // Expected: HAir = clamp(1 + 0.1*15, ...) = 2.5
        //           Mist = clamp(1 + 0.05*30, ...) = 2.5
        assert(std::abs(g_hi.gain_HAir - 2.5f) < 1e-5f);
        assert(std::abs(g_hi.gain_Mist - 2.5f) < 1e-5f);

        AdaptiveTuner::IntegralState windup_lo = AdaptiveTuner::makeInitialState();
        AdaptiveTuner::GainsPod g_lo = AdaptiveTuner::defaultGains();
        for (int i = 0; i < 200; ++i) {
            g_lo = AdaptiveTuner::updateGains(windup_lo, -10.0f, -20.0f, 1.0f);
        }
        assert(std::abs(windup_lo.integral_temp + 15.0f) < 1e-5f);
        assert(std::abs(windup_lo.integral_humid + 30.0f) < 1e-5f);
        assert(std::abs(g_lo.gain_HAir - 0.5f) < 1e-5f);
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
        assert(g_nan.gain_HAir >= 0.5f && g_nan.gain_HAir <= 2.5f);
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

    Serial.println("--- All Unit Tests Passed Successfully! ---");
    return 0;
}

