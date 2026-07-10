#include "storage.h"
#include <Preferences.h>

namespace storage
{
    StorageManager &StorageManager::get_instance()
    {
        static StorageManager instance;
        return instance;
    }

    bool StorageManager::init()
    {
        Preferences prefs;
        if (prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            prefs.end();
            Serial.println("[STORAGE] NVS initialized successfully.");
            return true;
        }
        Serial.println("[STORAGE] Failed to initialize NVS.");
        return false;
    }

    bool StorageManager::save_wifi_credentials(const String &ssid, const String &pass)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing WiFi credentials.");
            return false;
        }
        
        size_t ssid_bytes = prefs.putString(config::network::KEY_WIFI_SSID, ssid);
        size_t pass_bytes = prefs.putString(config::network::KEY_WIFI_PASS, pass);
        
        prefs.end();

        if (ssid_bytes > 0)
        {
            Serial.printf("[STORAGE] Saved WiFi credentials successfully (SSID: %s).\n", ssid.c_str());
            return true;
        }
        else
        {
            Serial.println("[STORAGE] Error: Failed to save WiFi credentials.");
            return false;
        }
    }

    bool StorageManager::load_wifi_credentials(String &ssid, String &pass)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true)) // Open in read-only mode
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading WiFi credentials.");
            return false;
        }

        ssid = prefs.getString(config::network::KEY_WIFI_SSID, "");
        pass = prefs.getString(config::network::KEY_WIFI_PASS, "");
        
        prefs.end();

        if (ssid.length() > 0)
        {
            Serial.println("[STORAGE] Loaded WiFi credentials from NVS.");
            return true;
        }
        else
        {
            Serial.println("[STORAGE] WiFi credentials empty or not found in NVS.");
            return false;
        }
    }

    bool StorageManager::has_wifi_credentials()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        bool exists = prefs.isKey(config::network::KEY_WIFI_SSID) && (prefs.getString(config::network::KEY_WIFI_SSID, "").length() > 0);
        prefs.end();
        return exists;
    }

    bool StorageManager::clear_wifi_credentials()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool res1 = prefs.remove(config::network::KEY_WIFI_SSID);
        bool res2 = prefs.remove(config::network::KEY_WIFI_PASS);
        prefs.end();
        Serial.println("[STORAGE] Cleared WiFi credentials from NVS.");
        return res1 || res2;
    }

    bool StorageManager::save_mqtt_config(const String &broker, uint16_t port, const String &user, const String &pass)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing MQTT config.");
            return false;
        }

        size_t broker_bytes = prefs.putString(config::network::KEY_MQTT_BROKER, broker);
        size_t port_bytes = prefs.putUShort(config::network::KEY_MQTT_PORT, port);
        size_t user_bytes = prefs.putString(config::network::KEY_MQTT_USER, user);
        size_t pass_bytes = prefs.putString(config::network::KEY_MQTT_PASS, pass);

        prefs.end();

        if (broker_bytes > 0 && port_bytes > 0)
        {
            Serial.printf("[STORAGE] Saved MQTT configuration successfully (Broker: %s:%d).\n", broker.c_str(), port);
            return true;
        }
        else
        {
            Serial.println("[STORAGE] Error: Failed to save MQTT config.");
            return false;
        }
    }

    bool StorageManager::load_mqtt_config(String &broker, uint16_t &port, String &user, String &pass)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading MQTT config.");
            return false;
        }

        broker = prefs.getString(config::network::KEY_MQTT_BROKER, "");
        port = prefs.getUShort(config::network::KEY_MQTT_PORT, 0);
        user = prefs.getString(config::network::KEY_MQTT_USER, "");
        pass = prefs.getString(config::network::KEY_MQTT_PASS, "");

        prefs.end();

        if (broker.length() > 0)
        {
            Serial.println("[STORAGE] Loaded MQTT configuration from NVS.");
            return true;
        }
        else
        {
            Serial.println("[STORAGE] MQTT configuration empty or not found in NVS.");
            return false;
        }
    }

    bool StorageManager::has_mqtt_config()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        bool exists = prefs.isKey(config::network::KEY_MQTT_BROKER) && (prefs.getString(config::network::KEY_MQTT_BROKER, "").length() > 0);
        prefs.end();
        return exists;
    }

    bool StorageManager::clear_mqtt_config()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool res1 = prefs.remove(config::network::KEY_MQTT_BROKER);
        bool res2 = prefs.remove(config::network::KEY_MQTT_PORT);
        bool res3 = prefs.remove(config::network::KEY_MQTT_USER);
        bool res4 = prefs.remove(config::network::KEY_MQTT_PASS);
        prefs.end();
        Serial.println("[STORAGE] Cleared MQTT config from NVS.");
        return res1 || res2 || res3 || res4;
    }

    bool StorageManager::factory_reset()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for factory reset.");
            return false;
        }
        bool cleared = prefs.clear();
        prefs.end();
        if (cleared)
        {
            Serial.println("[STORAGE] Factory reset completed. All keys cleared.");
        }
        else
        {
            Serial.println("[STORAGE] Error: Factory reset failed.");
        }
        return cleared;
    }
} // namespace storage
