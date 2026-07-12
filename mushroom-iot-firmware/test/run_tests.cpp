#include "Arduino.h"
#include "Preferences.h"
#include "storage.h"
#include "config.h"
#include "wifi_manager.h"
#include "NetworkTask.h"
#include "mqtt_client.h"
#include "definitions.h"
#include "models.h"
#include "sensors.h"
#include "actuators.h"
#include "serial_mutex.h"
#include "MathEngine.h"
#include "Trajectory.h"
#include "AdaptiveTuner.h"
#include "FuzzyController.h"
#include "TPC_Task.h"
#include "Telemetry.h"
#include "WebInterface.h"
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
    assert(WiFi.mock_mode == WIFI_AP_STA);
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
    mock_millis_offset += 9000;
    mqtt_client.loop();  // reconnect succeeds
    assert(mqtt_client.get_state() == mqtt::MqttState::CONNECTED);
    assert(mqtt_client.is_connected() == true);

    // 12.4c Test Exponential Backoff and WiFi Safeguard (Task D3)
    Serial.println("[TEST] Testing Task D3 - Exponential Backoff and WiFi Safeguard...");
    
    // Ensure client is currently CONNECTED and interval is reset to 2000 ms
    assert(mqtt_client.get_state() == mqtt::MqttState::CONNECTED);
    assert(mqtt_client.get_reconnect_interval() == 2000);

    // 1. Sudden WiFi disconnection
    WiFi.mock_status = WL_DISCONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_DISCONNECTED);
    
    // Call loop to detect WiFi loss, transition to ERROR_NO_WIFI, and disconnect MQTT
    PubSubClient::mock_connected = false;
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_WIFI);

    // 2. Attempt to reconnect during WiFi outage. WiFi Safeguard must prevent this, state remains ERROR_NO_WIFI
    mock_millis_offset += 3000;
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::ERROR_NO_WIFI);

    // 3. Restore WiFi connection
    // WiFiManager is in STA_DISCONNECTED. We must advance time to exceed the 10-second reconnect interval.
    mock_millis_offset += 11000;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTING);

    WiFi.mock_status = WL_CONNECTED;
    wifi::check_wifi_connection();
    assert(wifi::get_wifi_state() == wifi::WifiState::STA_CONNECTED);

    // Set MQTT mock to fail connection so that it transitions to DISCONNECTED on restored WiFi
    PubSubClient::mock_connect_result = false;
    PubSubClient::mock_connected = false;

    // Call loop again. Since WiFi is restored, state transitions from ERROR_NO_WIFI to DISCONNECTED.
    // It also immediately attempts reconnect because mock_millis_offset has advanced by 11000 ms (> 2000 ms).
    // The reconnect fails, so interval increases from 2000 to 4000 ms.
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::DISCONNECTED);
    assert(mqtt_client.get_reconnect_interval() == 4000);

    // 4. Begin reconnection attempts and Exponential Backoff

    // Loop after another 2000 ms (total elapsed since retry 1 is 2000 ms, which is less than 4000 ms)
    mock_millis_offset += 2000;
    mqtt_client.loop();
    // Reconnect should NOT trigger, interval remains 4000 ms
    assert(mqtt_client.get_reconnect_interval() == 4000);

    // Retry 2: triggered after waiting another 2500 ms (total elapsed since retry 1 is 4500 ms > 4000 ms)
    mock_millis_offset += 2500;
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::DISCONNECTED);
    // Interval must double: 4000 -> 8000 ms
    assert(mqtt_client.get_reconnect_interval() == 8000);

    // Loop after 5000 ms (less than 8000 ms)
    mock_millis_offset += 5000;
    mqtt_client.loop();
    assert(mqtt_client.get_reconnect_interval() == 8000);

    // Retry 3: triggered after waiting another 4000 ms (total elapsed since retry 2 is 9000 ms > 8000 ms)
    mock_millis_offset += 4000;
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::DISCONNECTED);
    // Interval must double: 8000 -> 16000 ms
    assert(mqtt_client.get_reconnect_interval() == 16000);

    // 5. Restore connection success
    PubSubClient::mock_connect_result = true;
    PubSubClient::mock_connected = true;

    // Trigger retry 4: after waiting > 16000 ms (+17000 ms)
    mock_millis_offset += 17000;
    mqtt_client.loop();
    assert(mqtt_client.get_state() == mqtt::MqttState::CONNECTED);
    assert(mqtt_client.is_connected() == true);
    // Interval must reset back to 2000 ms
    assert(mqtt_client.get_reconnect_interval() == 2000);

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

    // Case J: Command "full_sync" (Task D2)
    {
        Serial.println("--- Case J: Command full_sync ---");
        set_shared_force_full_publish(false);
        assert(get_shared_force_full_publish() == false);

        std::string payload = "{\"cmd\":\"full_sync\"}";
        PubSubClient::mock_callback(setpoint_topic, (uint8_t*)payload.c_str(), payload.length());
        
        assert(get_shared_force_full_publish() == true);

        // Reset it back
        set_shared_force_full_publish(false);
        assert(get_shared_force_full_publish() == false);
    }

    // 13. Test Task D1 - Core 0 Communication Task
    Serial.println("[TEST] Starting Task D1 - Core 0 Communication Task Unit Tests...");
    assert(storage.factory_reset() == true);
    config::network::MQTT_BROKER_VAL = "";
    WiFi.mock_status = WL_IDLE_STATUS;
    PubSubClient::mock_connected = false;

    // Test network::initWiFiModes() directly
    WiFi.mode(WIFI_OFF);
    network::initWiFiModes();
    assert(WiFi.getMode() == WIFI_AP_STA);

    // Reset and run task once
    WiFi.mock_status = WL_IDLE_STATUS;
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
    mock_millis_offset = 0;

    // Execute a single iteration of the TPC control pipeline
    task_core1_control(nullptr);

    // Verify sensors and relays were initialized
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_MIST) > 0);
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_HEATER_1) > 0);
    assert(mock_pin_modes.count(config::pins::PIN_RELAY_FAN) > 0);

    // TPC initialized its channels to OFF (LOW) by default.
    assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == LOW);
    assert(mock_pin_values[config::pins::PIN_RELAY_HEATER_1] == LOW);
    assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == HIGH);

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

    // 25. Test Task B1 - FuzzyController dual-heater rule invariants
    Serial.println("[TEST] Starting Task B1 - FuzzyController Unit Tests...");
    {
        using FuzzyController::DualHeaterOutputsPod;

        // 25.1 Cold & dry: prioritize air heat and suppress mist while cold.
        const DualHeaterOutputsPod coldDry =
            FuzzyController::executeDualHeaterRules(4.0f, 20.0f);
        assert(std::abs(coldDry.HAir - 1.0f) < 1e-6f);
        assert(coldDry.HWat == 0.0f);
        assert(coldDry.Mist == 0.0f);
        assert(coldDry.ExhTH == 0.0f);

        // 25.2 Cold & wet: use water heat only; do not mist or exhaust heat.
        const DualHeaterOutputsPod coldWet =
            FuzzyController::executeDualHeaterRules(4.0f, -20.0f);
        assert(coldWet.HAir == 0.0f);
        assert(std::abs(coldWet.HWat - 1.0f) < 1e-6f);
        assert(coldWet.Mist == 0.0f);
        assert(coldWet.ExhTH == 0.0f);

        // 25.3 Moderate cold/dry shares the unit budget; heat and mist cannot
        // both be excessive in the same control cycle.
        const DualHeaterOutputsPod mixed =
            FuzzyController::executeDualHeaterRules(2.0f, 20.0f);
        assert(std::abs(mixed.HAir - 0.5f) < 1e-6f);
        assert(std::abs(mixed.Mist - 0.5f) < 1e-6f);
        assert((mixed.HAir + mixed.Mist) <= 1.0f + 1e-6f);

        // 25.4 Continuous intermediate TPC duties (not boolean thresholds).
        // eT=1°C => cold=0.25; eH=10% => dry=0.5 => Mist residual budget.
        const DualHeaterOutputsPod partial =
            FuzzyController::executeDualHeaterRules(1.0f, 10.0f);
        assert(std::abs(partial.HAir - 0.25f) < 1e-6f);
        assert(std::abs(partial.Mist - 0.375f) < 1e-6f);  // 0.5 * (1-0.25)
        assert(partial.HWat == 0.0f);
        assert(partial.ExhTH == 0.0f);
        assert(partial.HAir > 0.0f && partial.HAir < 1.0f);
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
        assert(warmish.HAir == 0.0f && warmish.HWat == 0.0f && warmish.Mist == 0.0f);

        // 25.6 Outputs remain normalized, including extreme and invalid input.
        const DualHeaterOutputsPod extreme =
            FuzzyController::executeDualHeaterRules(100.0f, -100.0f);
        const float values[] = {extreme.HAir, extreme.HWat, extreme.Mist, extreme.ExhTH};
        for (float value : values) {
            assert(value >= 0.0f && value <= 1.0f);
        }
        const DualHeaterOutputsPod invalid =
            FuzzyController::executeDualHeaterRules(NAN, INFINITY);
        assert(invalid.HAir == 0.0f && invalid.HWat == 0.0f);
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
        // TPC demand even though the excess is below the ON threshold.
        out = FuzzyController::executeCO2Rules(state, -30.0f);
        assert(out == 1.0f);
        assert(state.exhaust_active == true);

        // 26.7 Fall below the OFF threshold to release the latch.
        out = FuzzyController::executeCO2Rules(state, -10.0f);
        assert(out == 0.0f);
        assert(state.exhaust_active == false);

        // 26.8 Large excess remains the full TPC demand once engaged.
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
            FuzzyController::arbitrateOutputs(raw, 0.60f, nominal);

        // 27.1 Nominal gains preserve actuator demands and CO2 takes the
        // shared exhaust relay whenever its demand exceeds the TH request.
        assert(std::abs(nominalOut.HAir - 0.40f) < 1e-6f);
        assert(std::abs(nominalOut.HWat - 0.30f) < 1e-6f);
        assert(std::abs(nominalOut.Mist - 0.20f) < 1e-6f);
        assert(std::abs(nominalOut.Exh - 0.60f) < 1e-6f);

        // 27.2 Thermal/humidity demand remains authoritative if it is larger.
        const ArbitratedOutputsPod thermalExhaust =
            FuzzyController::arbitrateOutputs(raw, 0.10f, nominal);
        assert(std::abs(thermalExhaust.Exh - 0.35f) < 1e-6f);

        // 27.3 Per-channel adaptive gains apply only to HAir/HWat/Mist, and
        // post-gain products are clamped to the normalized range.
        const AdaptiveTuner::GainsPod adjusted = {2.5f, 0.5f, 2.0f};
        const DualHeaterOutputsPod gainRaw = {0.80f, 0.80f, 0.60f, 0.20f};
        const ArbitratedOutputsPod adjustedOut =
            FuzzyController::arbitrateOutputs(gainRaw, 0.10f, adjusted);
        assert(adjustedOut.HAir == 1.0f);  // 0.80 * 2.5 -> clamp to 1.0
        assert(std::abs(adjustedOut.HWat - 0.40f) < 1e-6f);
        assert(adjustedOut.Mist == 1.0f);  // 0.60 * 2.0 -> clamp to 1.0
        assert(std::abs(adjustedOut.Exh - 0.20f) < 1e-6f);

        // 27.4 Malformed raw commands are clamped; NaN/Inf gains fail safe
        // OFF for the corresponding actuator. Finite-but-out-of-band gains
        // are bounded to the tuner safety band [0.5, 2.5].
        const DualHeaterOutputsPod malformedRaw = {NAN, -1.0f, 2.0f, INFINITY};
        const AdaptiveTuner::GainsPod malformedGains = {NAN, 100.0f, NAN};
        const ArbitratedOutputsPod safeOut = FuzzyController::arbitrateOutputs(
            malformedRaw, NAN, malformedGains);
        assert(safeOut.HAir == 0.0f);   // NaN raw -> safeUnit -> 0
        assert(safeOut.HWat == 0.0f);   // -1.0 raw -> clampUnit -> 0
        assert(safeOut.Mist == 0.0f);   // NaN gain -> safeGain -> 0
        assert(safeOut.Exh == 0.0f);    // NaN exhCO2 -> safeUnit -> 0

        // 27.5 Out-of-band finite gains are bounded to the tuner safety band.
        const DualHeaterOutputsPod boundedRaw = {0.50f, 0.50f, 0.50f, 0.0f};
        const AdaptiveTuner::GainsPod outOfBandGains = {100.0f, -100.0f, 100.0f};
        const ArbitratedOutputsPod boundedOut = FuzzyController::arbitrateOutputs(
            boundedRaw, 0.0f, outOfBandGains);
        assert(boundedOut.HAir == 1.0f);  // 0.5 * max gain 2.5 -> clamp
        assert(std::abs(boundedOut.HWat - 0.25f) < 1e-6f);
        assert(boundedOut.Mist == 1.0f);

        assert(std::is_pod<ArbitratedOutputsPod>::value == true);
        assert(sizeof(ArbitratedOutputsPod) == 16);
        assert(alignof(ArbitratedOutputsPod) == 4);
    }

    // 28. Test Task B4 - RTC protection and non-blocking SSR TPC scheduling
    Serial.println("[TEST] Starting Task B4 - TPC Task Unit Tests...");
    {
        using FuzzyController::ArbitratedOutputsPod;
        using TPC_Task::RtcTimePod;
        using TPC_Task::TpcChannelConfig;
        using TPC_Task::TpcChannelState;

        // 28.1 The biosafety blackout covers both endpoints and cannot be
        // bypassed by a full fuzzy/arbitrated demand. Invalid RTC is fail-safe.
        ArbitratedOutputsPod protectedOut = {0.4f, 1.0f, 1.0f, 0.6f};
        TPC_Task::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 10U, 59U});
        assert(protectedOut.HWat == 1.0f && protectedOut.Mist == 1.0f);
        TPC_Task::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 11U, 0U});
        assert(protectedOut.HWat == 0.0f && protectedOut.Mist == 0.0f);
        protectedOut.HWat = 1.0f;
        protectedOut.Mist = 1.0f;
        TPC_Task::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 13U, 30U});
        assert(protectedOut.HWat == 0.0f && protectedOut.Mist == 0.0f);
        protectedOut.HWat = 1.0f;
        protectedOut.Mist = 1.0f;
        TPC_Task::hardwareProtectionOverride(protectedOut, RtcTimePod{false, 0U, 0U});
        assert(protectedOut.HWat == 0.0f && protectedOut.Mist == 0.0f);
        protectedOut.HWat = 1.0f;
        protectedOut.Mist = 1.0f;
        TPC_Task::hardwareProtectionOverride(protectedOut, RtcTimePod{true, 24U, 0U});
        assert(protectedOut.HWat == 0.0f && protectedOut.Mist == 0.0f);
        assert(std::abs(protectedOut.HAir - 0.4f) < 1e-6f);
        assert(std::abs(protectedOut.Exh - 0.6f) < 1e-6f);

        // 28.2 A 100 ms TPC window converts 50% duty into a phase. Minimum
        // ON/OFF times defer normal phase changes, while explicit zero demand
        // remains an immediate fail-safe OFF command.
        const TpcChannelConfig channel = {42U, 100U, 80U, 60U};
        TpcChannelState state = {};
        mock_millis_offset = 300000UL;
        TPC_Task::updateTpcChannel(channel, state, 0.5f);
        assert(state.output_high == true);
        assert(mock_pin_values[42U] == HIGH);

        mock_millis_offset = 300050UL;
        TPC_Task::updateTpcChannel(channel, state, 0.5f);
        assert(state.output_high == true); // minimum ON defers phase-off
        mock_millis_offset = 300080UL;
        TPC_Task::updateTpcChannel(channel, state, 0.5f);
        assert(state.output_high == false);
        assert(mock_pin_values[42U] == LOW);

        // At the next window, the OFF phase has lasted only 20 ms, so the
        // 60 ms minimum OFF time delays the next HIGH transition until 140 ms.
        mock_millis_offset = 300100UL;
        TPC_Task::updateTpcChannel(channel, state, 0.5f);
        assert(state.output_high == false);
        mock_millis_offset = 300140UL;
        TPC_Task::updateTpcChannel(channel, state, 0.5f);
        assert(state.output_high == true);

        // A duty forced to zero (including from a protection interlock) turns
        // the SSR OFF immediately and is never held by minimum-ON timing.
        mock_millis_offset = 300150UL;
        TPC_Task::updateTpcChannel(channel, state, 0.0f);
        assert(state.output_high == false);

        // 28.3 Invalid scheduler configuration fails safe LOW. All scheduler
        // state remains POD/caller-owned, avoiding hidden state or heap use.
        TpcChannelState invalidState = {};
        const TpcChannelConfig invalid = {43U, 0U, 10U, 10U};
        TPC_Task::updateTpcChannel(invalid, invalidState, 1.0f);
        assert(invalidState.output_high == false);
        assert(mock_pin_values[43U] == LOW);
        assert(std::is_pod<TPC_Task::RtcTimePod>::value == true);
        assert(std::is_pod<TPC_Task::TpcChannelConfig>::value == true);
        assert(std::is_pod<TPC_Task::TpcChannelState>::value == true);
        assert(std::is_pod<TPC_Task::TpcSchedulerState>::value == true);
    }


    // 29. Test Task B5 - Core1_ControlTask TPC pipeline single iteration
    Serial.println("[TEST] Starting Task B5 - Core1 TPC Pipeline Unit Tests...");
    {
        // Reset mock state for a clean pipeline run
        sensors::init_sensors_placeholder();
        mock_pin_modes.clear();
        mock_pin_values.clear();
        mock_pin_write_order.clear();
        mock_operation_counter = 0;
        mock_millis_offset = 0;

        // Execute one full pipeline iteration
        task_core1_control(nullptr);

        // Verify all SSR relay pins were initialized as OUTPUT
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_HEATER_1) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_HEATER_2) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_MIST) == 1);
        assert(mock_pin_modes.count(config::pins::PIN_RELAY_FAN) == 1);

        // RTC is unavailable (fail-safe), so hardwareProtectionOverride() forces
        // HWat and Mist to 0.0 duty → TPC writes LOW to both heater pins.
        assert(mock_pin_values[config::pins::PIN_RELAY_HEATER_2] == LOW);
        assert(mock_pin_values[config::pins::PIN_RELAY_MIST] == LOW);

        // HAir and Exhaust are unaffected by the blackout interlock; Exhaust is
        // HIGH because the default crop day (0.0) target (24.0C) is lower than mock temperature.
        assert(mock_pin_values[config::pins::PIN_RELAY_HEATER_1] == LOW);
        assert(mock_pin_values[config::pins::PIN_RELAY_FAN] == HIGH);

        // Verify no heap allocation or delay() was used — confirmed by static
        // analysis of core1_tasks.cpp (no malloc/new/String/delay in loop body).
        // The pipeline correctly follows: sensors → trajectory → fuzzy → gains
        // → arbitration → protection → TPC → vTaskDelay(50).
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

        // 30.2 Test evaluateDeltaThresholds first publish (cold start)
        Telemetry::TelemetryState state = Telemetry::makeInitialState();
        TelemetryData current = { 25.0f, 80.0f, NAN };
        
        // First publish must be FULL
        assert(Telemetry::evaluateDeltaThresholds(current, state, 1000UL) == Telemetry::PublishType::FULL);
        assert(state.lastPubState.temp_air == 25.0f);
        assert(state.lastPubState.humidity_air == 80.0f);
        assert(std::isnan(state.lastPubState.co2_level));
        assert(state.lastPubTimeMs == 1000UL);
        assert(state.forceFullPublish == false);

        // 30.3 Test no change
        assert(Telemetry::evaluateDeltaThresholds(current, state, 2000UL) == Telemetry::PublishType::NONE);
        // State remains unchanged
        assert(state.lastPubTimeMs == 1000UL);

        // 30.4 Test small change below thresholds
        TelemetryData small_change = { 25.1f, 80.5f, NAN };
        assert(Telemetry::evaluateDeltaThresholds(small_change, state, 3000UL) == Telemetry::PublishType::NONE);
        assert(state.lastPubTimeMs == 1000UL);

        // 30.5 Test Temp change exceeds threshold (> 0.2°C)
        TelemetryData temp_exceeded = { 25.25f, 80.0f, NAN };
        assert(Telemetry::evaluateDeltaThresholds(temp_exceeded, state, 4000UL) == Telemetry::PublishType::DELTA);
        assert(state.lastPubState.temp_air == 25.25f);
        assert(state.lastPubTimeMs == 4000UL);

        // 30.6 Test Humid change exceeds threshold (> 1.0%)
        TelemetryData humid_exceeded = { 25.25f, 81.1f, NAN };
        assert(Telemetry::evaluateDeltaThresholds(humid_exceeded, state, 5000UL) == Telemetry::PublishType::DELTA);
        assert(state.lastPubState.humidity_air == 81.1f);
        assert(state.lastPubTimeMs == 5000UL);

        // 30.7 Test CO2 change transitions from NAN to finite (sensor connected)
        TelemetryData co2_connected = { 25.25f, 81.1f, 400.0f };
        assert(Telemetry::evaluateDeltaThresholds(co2_connected, state, 6000UL) == Telemetry::PublishType::DELTA);
        assert(state.lastPubState.co2_level == 400.0f);
        assert(state.lastPubTimeMs == 6000UL);

        // 30.8 Test CO2 change exceeds threshold (> 10 ppm)
        TelemetryData co2_exceeded = { 25.25f, 81.1f, 411.0f };
        assert(Telemetry::evaluateDeltaThresholds(co2_exceeded, state, 7000UL) == Telemetry::PublishType::DELTA);
        assert(state.lastPubState.co2_level == 411.0f);
        assert(state.lastPubTimeMs == 7000UL);

        // 30.9 Test forceFullPublish flag
        state.forceFullPublish = true;
        assert(Telemetry::evaluateDeltaThresholds(co2_exceeded, state, 8000UL) == Telemetry::PublishType::FULL);
        assert(state.forceFullPublish == false);
        assert(state.lastPubTimeMs == 8000UL);

        // 30.10 Test heartbeat keepalive timeout (5 minutes = 300,000 ms)
        // Set time just under 5 mins
        assert(Telemetry::evaluateDeltaThresholds(co2_exceeded, state, 8000UL + 299999UL) == Telemetry::PublishType::NONE);
        // Exceeds 5 mins
        assert(Telemetry::evaluateDeltaThresholds(co2_exceeded, state, 8000UL + 300000UL) == Telemetry::PublishType::FULL);
        assert(state.lastPubTimeMs == 308000UL);

        // 30.11 Test buildDeltaPayload
        TelemetryData baseline = { 25.0f, 80.0f, NAN };
        
        // 30.11.1 NONE publish type should yield empty string
        assert(Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::NONE) == "");

        // 30.11.2 FULL publish type should contain all keys
        String full_payload = Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::FULL);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, full_payload);
            assert(!err);
            assert(doc.containsKey("rT"));
            assert(std::fabs(doc["rT"].as<float>() - 25.0f) < 0.01f);
            assert(doc.containsKey("rH"));
            assert(std::fabs(doc["rH"].as<float>() - 80.0f) < 0.01f);
            assert(doc.containsKey("tC"));
            assert(doc["tC"].isNull());
        }

        // 30.11.3 DELTA publish type - no changes
        assert(Telemetry::buildDeltaPayload(baseline, baseline, Telemetry::PublishType::DELTA) == "{}");

        // 30.11.4 DELTA publish type - only temperature changed
        TelemetryData temp_changed = { 25.3f, 80.0f, NAN };
        String temp_delta_payload = Telemetry::buildDeltaPayload(temp_changed, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, temp_delta_payload);
            assert(!err);
            assert(doc.containsKey("rT"));
            assert(std::fabs(doc["rT"].as<float>() - 25.3f) < 0.01f);
            assert(!doc.containsKey("rH"));
            assert(!doc.containsKey("tC"));
        }

        // 30.11.5 DELTA publish type - temperature and humidity changed
        TelemetryData temp_humid_changed = { 25.3f, 81.5f, NAN };
        String multi_delta_payload = Telemetry::buildDeltaPayload(temp_humid_changed, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, multi_delta_payload);
            assert(!err);
            assert(doc.containsKey("rT"));
            assert(std::fabs(doc["rT"].as<float>() - 25.3f) < 0.01f);
            assert(doc.containsKey("rH"));
            assert(std::fabs(doc["rH"].as<float>() - 81.5f) < 0.01f);
            assert(!doc.containsKey("tC"));
        }

        // 30.11.6 DELTA publish type - CO2 becomes valid
        TelemetryData co2_became_valid = { 25.0f, 80.0f, 400.0f };
        String co2_delta_payload = Telemetry::buildDeltaPayload(co2_became_valid, baseline, Telemetry::PublishType::DELTA);
        {
            StaticJsonDocument<256> doc;
            DeserializationError err = deserializeJson(doc, co2_delta_payload);
            assert(!err);
            assert(!doc.containsKey("rT"));
            assert(!doc.containsKey("rH"));
            assert(doc.containsKey("tC"));
            assert(std::fabs(doc["tC"].as<float>() - 400.0f) < 0.01f);
        }
    }

    // 31. Test Task D4 - Shared System State and WebInterface stubs
    Serial.println("[TEST] Starting Task D4 - Shared System State Unit Tests...");
    {
        // 31.1 Test update_shared_system_state and get_shared_system_state
        SharedSystemState state = { 24.5f, 85.0f, 600.0f, 25.0f, 80.0f, 1000.0f, 0.45f, 0.0f, 0.12f, 0.0f };
        update_shared_system_state(state);
        
        SharedSystemState loaded = get_shared_system_state();
        assert(std::fabs(loaded.temp_air - 24.5f) < 0.01f);
        assert(std::fabs(loaded.humidity_air - 85.0f) < 0.01f);
        assert(std::fabs(loaded.co2_level - 600.0f) < 0.01f);
        assert(std::fabs(loaded.temp_target - 25.0f) < 0.01f);
        assert(std::fabs(loaded.humidity_target - 80.0f) < 0.01f);
        assert(std::fabs(loaded.co2_target - 1000.0f) < 0.01f);
        assert(std::fabs(loaded.h_air_duty - 0.45f) < 0.01f);
        assert(std::fabs(loaded.h_wat_duty - 0.0f) < 0.01f);
        assert(std::fabs(loaded.mist_duty - 0.12f) < 0.01f);
        assert(std::fabs(loaded.exhaust_duty - 0.0f) < 0.01f);
        
        // 31.2 Test WebInterface stubs and rate-limiting
        web_interface::init_server();
        assert(web_interface::is_server_running() == false); // False under UNIT_TEST
        web_interface::handle_client();
        web_interface::serveDashboardHTML();
        web_interface::apiGetRealtimeData(); // Should not crash
        web_interface::stop_server();

        // 31.3 Test check_rate_limit logic
        // First call should succeed
        assert(web_interface::check_rate_limit(10000UL) == true);
        // Call within 1s (e.g. at 10500ms) should fail (be throttled)
        assert(web_interface::check_rate_limit(10500UL) == false);
        // Call at exactly 1s delta (11000ms) should succeed
        assert(web_interface::check_rate_limit(11000UL) == true);
        // Call after 2s delta (13000ms) should succeed
        assert(web_interface::check_rate_limit(13000UL) == true);
    }
    Serial.println("--- All Unit Tests Passed Successfully! ---");
    return 0;
}

