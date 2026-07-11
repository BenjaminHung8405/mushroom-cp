#include "config.h"
#include "storage.h"

#ifndef UNIT_TEST
#include <WiFi.h>
#else
#include "Arduino.h"
#endif

namespace config
{
    namespace network
    {
        String STA_SSID = "";
        String STA_PASS = "";

        String MQTT_BROKER_VAL = DEFAULT_MQTT_BROKER;
        uint16_t MQTT_PORT_VAL = DEFAULT_MQTT_PORT;
        String MQTT_CLIENT_ID_VAL = "";
        String MQTT_USER_VAL = "";
        String MQTT_PASSWORD_VAL = DEFAULT_MQTT_PASS;
        String BACKEND_API_URL = DEFAULT_BACKEND_URL;
        String AUTH_JWT_TOKEN = "";

        static String mac_to_device_id()
        {
#ifndef UNIT_TEST
            // STA MAC is stable across SoftAP/STA modes and available before association.
            String mac_str = WiFi.macAddress();
            mac_str.replace(":", "");
            mac_str.toLowerCase();
            if (mac_str.length() == 12)
            {
                return String("mushroom_s3_") + mac_str;
            }
#endif
            // Host unit-test / offline fallback — deterministic, not a production hardcode.
            return String("mushroom_s3_unittest");
        }

        String resolve_device_identity()
        {
            storage::StorageManager &storage = storage::StorageManager::get_instance();
            String device_id;
            if (storage.load_device_id(device_id) && device_id.length() > 0)
            {
                return device_id;
            }

            device_id = mac_to_device_id();
            // Best-effort persist so identity stays stable across SoftAP restarts.
            storage.save_device_id(device_id);
            return device_id;
        }

        bool load_runtime_config()
        {
            storage::StorageManager &storage = storage::StorageManager::get_instance();

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

            String temp_broker;
            uint16_t temp_port = 0;
            String temp_user;
            String temp_pass;
            bool mqtt_loaded = storage.load_mqtt_config(temp_broker, temp_port, temp_user, temp_pass);

            if (mqtt_loaded && temp_broker.length() > 0)
            {
                MQTT_BROKER_VAL = temp_broker;
                MQTT_PORT_VAL = temp_port;
                MQTT_PASSWORD_VAL = temp_pass;
                Serial.printf("[CONFIG] Loaded MQTT config from NVS (Broker: %s:%d).\n",
                              MQTT_BROKER_VAL.c_str(), MQTT_PORT_VAL);
            }
            else
            {
                MQTT_BROKER_VAL = DEFAULT_MQTT_BROKER;
                MQTT_PORT_VAL = DEFAULT_MQTT_PORT;
                MQTT_PASSWORD_VAL = DEFAULT_MQTT_PASS;
                Serial.printf("[CONFIG] No MQTT configuration found in NVS, default to: %s:%d\n",
                              MQTT_BROKER_VAL.c_str(), MQTT_PORT_VAL);
            }

            // Identity is independent of broker defaults:
            // NVS override > MAC-derived. MQTT username MUST equal client/device ID (EMQX ACL).
            String device_id = resolve_device_identity();
            MQTT_CLIENT_ID_VAL = device_id;
            MQTT_USER_VAL = device_id;
            // Ignore provisioned mqtt_user if it diverges — ACL binds topics to username.
            if (temp_user.length() > 0 && temp_user != device_id)
            {
                Serial.printf(
                    "[CONFIG] WARNING: NVS mqtt_user='%s' ignored; forcing username=deviceId='%s'.\n",
                    temp_user.c_str(),
                    device_id.c_str());
            }
            Serial.printf("[CONFIG] Device identity: %s\n", device_id.c_str());

            return wifi_loaded;
        }
    }
}
