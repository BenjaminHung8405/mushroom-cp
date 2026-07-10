#include "Arduino.h"
#include "Preferences.h"
#include "storage.h"
#include "config.h"
#include "wifi_manager.h"
#include <cassert>

HardwareSerial Serial;
std::map<std::string, std::map<std::string, std::string>> Preferences::_global_storage;

wl_status_t WiFiClass::mock_status = WL_IDLE_STATUS;
wifi_mode_t WiFiClass::mock_mode = WIFI_OFF;
std::string WiFiClass::mock_ssid = "";
std::string WiFiClass::mock_pass = "";
bool WiFiClass::disconnect_called = false;
WiFiClass WiFi;
unsigned long mock_millis_offset = 0;

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

    Serial.println("--- All Unit Tests Passed Successfully! ---");
    return 0;
}
