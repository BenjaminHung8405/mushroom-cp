#include "config.h"
#include "storage.h"

namespace config
{
    namespace network
    {
        // Khởi tạo các biến động WiFi STA là chuỗi trống
        String STA_SSID = "";
        String STA_PASS = "";

        // Khởi tạo các biến động MQTT với giá trị mặc định từ config
        String MQTT_BROKER_VAL = DEFAULT_MQTT_BROKER;
        uint16_t MQTT_PORT_VAL = DEFAULT_MQTT_PORT;
        String MQTT_CLIENT_ID_VAL = "esp32";
        String MQTT_USER_VAL = "esp32";
        String MQTT_PASSWORD_VAL = DEFAULT_MQTT_PASS;
        String BACKEND_API_URL = DEFAULT_BACKEND_URL;
        String AUTH_JWT_TOKEN = "";

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
            
            String temp_backend_url;
            bool backend_loaded = storage.load_backend_config(temp_backend_url);
            if (backend_loaded && temp_backend_url.length() > 0)
            {
                BACKEND_API_URL = temp_backend_url;
                Serial.printf("[CONFIG] Loaded Backend API URL from NVS: %s\n", BACKEND_API_URL.c_str());
            }
            else
            {
                BACKEND_API_URL = DEFAULT_BACKEND_URL;
                Serial.printf("[CONFIG] No Backend API URL found in NVS, default to: %s\n", BACKEND_API_URL.c_str());
            }

            // Nạp cấu hình MQTT từ NVS
            String temp_broker;
            uint16_t temp_port = 0;
            String temp_user;
            String temp_pass;
            bool mqtt_loaded = storage.load_mqtt_config(temp_broker, temp_port, temp_user, temp_pass);
            
            if (mqtt_loaded && temp_broker.length() > 0)
            {
                MQTT_BROKER_VAL = temp_broker;
                MQTT_PORT_VAL = temp_port;
                MQTT_USER_VAL = temp_user;
                MQTT_PASSWORD_VAL = temp_pass;
                Serial.printf("[CONFIG] Loaded MQTT config from NVS (Broker: %s:%d).\n", MQTT_BROKER_VAL.c_str(), MQTT_PORT_VAL);
            }
            else
            {
                MQTT_BROKER_VAL = DEFAULT_MQTT_BROKER;
                MQTT_PORT_VAL = DEFAULT_MQTT_PORT;
                MQTT_USER_VAL = DEFAULT_MQTT_USER;
                MQTT_PASSWORD_VAL = DEFAULT_MQTT_PASS;
                Serial.printf("[CONFIG] No MQTT configuration found in NVS, default to: %s:%d\n", MQTT_BROKER_VAL.c_str(), MQTT_PORT_VAL);
            }
            
            return wifi_loaded;
        }
    }
}
