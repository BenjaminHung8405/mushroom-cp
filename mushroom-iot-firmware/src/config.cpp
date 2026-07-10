#include "config.h"
#include "storage.h"

namespace config
{
    namespace network
    {
        // Khởi tạo các biến động WiFi STA là chuỗi trống
        String STA_SSID = "";
        String STA_PASS = "";

        // Khởi tạo các biến động MQTT
        String MQTT_BROKER_VAL = "";
        uint16_t MQTT_PORT_VAL = 1883;
        String MQTT_CLIENT_ID_VAL = "esp32_mushroom_client";
        String MQTT_USER_VAL = "";
        String MQTT_PASSWORD_VAL = "";

        bool load_runtime_config()
        {
            storage::StorageManager &storage = storage::StorageManager::get_instance();
            
            // Nạp cấu hình WiFi STA từ NVS
            bool wifi_loaded = storage.load_wifi_credentials(STA_SSID, STA_PASS);
            if (wifi_loaded)
            {
                Serial.printf("[CONFIG] Loaded WiFi credentials from NVS (SSID: %s).\n", STA_SSID.c_str());
            }
            else
            {
                Serial.println("[CONFIG] No WiFi credentials found in NVS, default to empty.");
                STA_SSID = "";
                STA_PASS = "";
            }
            
            // Nạp cấu hình MQTT từ NVS
            String temp_broker;
            uint16_t temp_port = 0;
            String temp_user;
            String temp_pass;
            bool mqtt_loaded = storage.load_mqtt_config(temp_broker, temp_port, temp_user, temp_pass);
            
            if (mqtt_loaded)
            {
                MQTT_BROKER_VAL = temp_broker;
                MQTT_PORT_VAL = temp_port;
                MQTT_USER_VAL = temp_user;
                MQTT_PASSWORD_VAL = temp_pass;
                Serial.printf("[CONFIG] Loaded MQTT config from NVS (Broker: %s:%d).\n", MQTT_BROKER_VAL.c_str(), MQTT_PORT_VAL);
            }
            else
            {
                Serial.println("[CONFIG] ERROR: No MQTT configuration found in NVS. Setting state to ERROR_NO_CONFIG.");
                MQTT_BROKER_VAL = "";
                MQTT_PORT_VAL = 0;
                MQTT_USER_VAL = "";
                MQTT_PASSWORD_VAL = "";
            }
            
            return wifi_loaded;
        }
    }
}
