#include "storage.h"
#include <Preferences.h>
#include <cmath>

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

        if (prefs.isKey(config::network::KEY_WIFI_SSID) &&
            prefs.isKey(config::network::KEY_WIFI_PASS))
        {
            ssid = prefs.getString(config::network::KEY_WIFI_SSID, "");
            pass = prefs.getString(config::network::KEY_WIFI_PASS, "");
        }
        else
        {
            ssid = "";
            pass = "";
        }

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

        if (prefs.isKey(config::network::KEY_MQTT_BROKER))
        {
            broker = prefs.getString(config::network::KEY_MQTT_BROKER, "");
            port = prefs.isKey(config::network::KEY_MQTT_PORT)
                       ? prefs.getUShort(config::network::KEY_MQTT_PORT, 0)
                       : 0;
            user = prefs.isKey(config::network::KEY_MQTT_USER)
                       ? prefs.getString(config::network::KEY_MQTT_USER, "")
                       : "";
            pass = prefs.isKey(config::network::KEY_MQTT_PASS)
                       ? prefs.getString(config::network::KEY_MQTT_PASS, "")
                       : "";
        }
        else
        {
            broker = "";
            port = 0;
            user = "";
            pass = "";
        }

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

    bool StorageManager::save_backend_config(const String &backend_url)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing Backend API URL.");
            return false;
        }

        size_t url_bytes = prefs.putString(config::network::KEY_BACKEND_URL, backend_url);
        prefs.end();

        if (url_bytes > 0)
        {
            Serial.printf("[STORAGE] Saved Backend API URL successfully: %s\n", backend_url.c_str());
            return true;
        }

        Serial.println("[STORAGE] Error: Failed to save Backend API URL.");
        return false;
    }

    bool StorageManager::load_backend_config(String &backend_url)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading Backend API URL.");
            return false;
        }

        backend_url = prefs.isKey(config::network::KEY_BACKEND_URL)
                          ? prefs.getString(config::network::KEY_BACKEND_URL, "")
                          : "";
        prefs.end();

        if (backend_url.length() > 0)
        {
            Serial.println("[STORAGE] Loaded Backend API URL from NVS.");
            return true;
        }

        Serial.println("[STORAGE] Backend API URL empty or not found in NVS.");
        return false;
    }

    bool StorageManager::has_backend_config()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        bool exists = prefs.isKey(config::network::KEY_BACKEND_URL) &&
                      (prefs.getString(config::network::KEY_BACKEND_URL, "").length() > 0);
        prefs.end();
        return exists;
    }

    bool StorageManager::clear_backend_config()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_BACKEND_URL);
        prefs.end();
        Serial.println("[STORAGE] Cleared Backend API URL from NVS.");
        return result;
    }

    bool StorageManager::save_device_id(const String &device_id)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing device_id.");
            return false;
        }
        size_t bytes = prefs.putString(config::network::KEY_DEVICE_ID, device_id);
        prefs.end();
        if (bytes > 0)
        {
            Serial.printf("[STORAGE] Saved device_id: %s\n", device_id.c_str());
            return true;
        }
        Serial.println("[STORAGE] Error: Failed to save device_id.");
        return false;
    }

    bool StorageManager::load_device_id(String &device_id)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading device_id.");
            return false;
        }
        device_id = prefs.isKey(config::network::KEY_DEVICE_ID)
                        ? prefs.getString(config::network::KEY_DEVICE_ID, "")
                        : "";
        prefs.end();
        if (device_id.length() > 0)
        {
            Serial.println("[STORAGE] Loaded device_id from NVS.");
            return true;
        }
        Serial.println("[STORAGE] device_id empty or not found in NVS.");
        return false;
    }

    bool StorageManager::has_device_id()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        bool exists = prefs.isKey(config::network::KEY_DEVICE_ID) &&
                      (prefs.getString(config::network::KEY_DEVICE_ID, "").length() > 0);
        prefs.end();
        return exists;
    }

    bool StorageManager::clear_device_id()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_DEVICE_ID);
        prefs.end();
        Serial.println("[STORAGE] Cleared device_id from NVS.");
        return result;
    }

    static bool is_valid_backend(const BackendSetpointSnapshot &snapshot)
    {
        return (std::isfinite(snapshot.temp_target) && snapshot.temp_target >= 10.0f && snapshot.temp_target <= 45.0f &&
                std::isfinite(snapshot.humidity_target) && snapshot.humidity_target >= 30.0f && snapshot.humidity_target <= 95.0f &&
                std::isfinite(snapshot.co2_target) && snapshot.co2_target >= 400.0f && snapshot.co2_target <= 10000.0f);
    }

    static bool is_valid_hardware(const HardwareOverrideSnapshot &snapshot)
    {
        return (std::isfinite(snapshot.temp_target) && snapshot.temp_target >= 20.0f && snapshot.temp_target <= 40.0f &&
                std::isfinite(snapshot.humidity_target) && snapshot.humidity_target >= 50.0f && snapshot.humidity_target <= 95.0f);
    }

    bool StorageManager::save_backend_snapshot(const BackendSetpointSnapshot &snapshot)
    {
        if (!is_valid_backend(snapshot))
        {
            Serial.println("[STORAGE] Error: Invalid backend snapshot data range.");
            return false;
        }

        BackendSetpointSnapshot old;
        bool has_old = load_backend_snapshot(old);
        bool should_write = !has_old;
        if (has_old)
        {
            if (std::abs(snapshot.temp_target - old.temp_target) >= 0.099f ||
                std::abs(snapshot.humidity_target - old.humidity_target) >= 0.099f ||
                std::abs(snapshot.co2_target - old.co2_target) >= 0.099f ||
                snapshot.valid != old.valid)
            {
                should_write = true;
            }
        }

        if (!should_write)
        {
            Serial.println("[STORAGE] Skip saving backend snapshot (change < 0.1 delta).");
            return true;
        }

        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing backend snapshot.");
            return false;
        }

        size_t bytes = prefs.putBytes(config::network::KEY_LAST_SP, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot))
        {
            Serial.printf("[STORAGE] Saved backend snapshot (T:%.2f, H:%.2f, CO2:%.2f, V:%d) successfully.\n",
                          snapshot.temp_target, snapshot.humidity_target, snapshot.co2_target, snapshot.valid);
            return true;
        }
        Serial.println("[STORAGE] Error: Failed to save backend snapshot.");
        return false;
    }

    bool StorageManager::load_backend_snapshot(BackendSetpointSnapshot &snapshot)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading backend snapshot.");
            return false;
        }

        size_t bytes = prefs.getBytes(config::network::KEY_LAST_SP, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot) && is_valid_backend(snapshot))
        {
            return true;
        }
        if (bytes == sizeof(snapshot))
        {
            Serial.println("[STORAGE] Error: Corrupt backend snapshot rejected.");
        }
        return false;
    }

    bool StorageManager::clear_backend_snapshot()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_LAST_SP);
        prefs.end();
        Serial.println("[STORAGE] Cleared backend snapshot from NVS.");
        return result;
    }

    bool StorageManager::save_hardware_override(const HardwareOverrideSnapshot &snapshot)
    {
        if (!is_valid_hardware(snapshot))
        {
            Serial.println("[STORAGE] Error: Invalid hardware override data range.");
            return false;
        }

        HardwareOverrideSnapshot old;
        bool has_old = load_hardware_override(old);
        bool should_write = !has_old;
        if (has_old)
        {
            if (std::abs(snapshot.temp_target - old.temp_target) >= 0.099f ||
                std::abs(snapshot.humidity_target - old.humidity_target) >= 0.099f ||
                snapshot.active != old.active)
            {
                should_write = true;
            }
        }

        if (!should_write)
        {
            Serial.println("[STORAGE] Skip saving hardware override (change < 0.1 delta).");
            return true;
        }

        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing hardware override.");
            return false;
        }

        size_t bytes = prefs.putBytes(config::network::KEY_HW_OVR, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot))
        {
            Serial.printf("[STORAGE] Saved hardware override (T:%.2f, H:%.2f, A:%d) successfully.\n",
                          snapshot.temp_target, snapshot.humidity_target, snapshot.active);
            return true;
        }
        Serial.println("[STORAGE] Error: Failed to save hardware override.");
        return false;
    }

    bool StorageManager::load_hardware_override(HardwareOverrideSnapshot &snapshot)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading hardware override.");
            return false;
        }

        size_t bytes = prefs.getBytes(config::network::KEY_HW_OVR, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot) && is_valid_hardware(snapshot))
        {
            return true;
        }
        if (bytes == sizeof(snapshot))
        {
            Serial.println("[STORAGE] Error: Corrupt hardware override rejected.");
        }
        return false;
    }

    bool StorageManager::clear_hardware_override()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_HW_OVR);
        prefs.end();
        Serial.println("[STORAGE] Cleared hardware override from NVS.");
        return result;
    }

    bool StorageManager::save_actuator_override(const ActuatorOverrideSnapshot &snapshot)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing actuator override.");
            return false;
        }

        size_t bytes = prefs.putBytes(config::network::KEY_ACT_OVR, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot))
        {
            Serial.printf("[STORAGE] Saved actuator override (M:%d, F:%d, H:%d, A:%d) successfully.\n",
                          snapshot.mist_override, snapshot.fan_override, snapshot.heater_air_override, snapshot.active);
            return true;
        }
        Serial.println("[STORAGE] Error: Failed to save actuator override.");
        return false;
    }

    bool StorageManager::load_actuator_override(ActuatorOverrideSnapshot &snapshot)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading actuator override.");
            return false;
        }

        size_t bytes = prefs.getBytes(config::network::KEY_ACT_OVR, &snapshot, sizeof(snapshot));
        prefs.end();

        if (bytes == sizeof(snapshot))
        {
            return true;
        }
        return false;
    }

    bool StorageManager::clear_actuator_override()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_ACT_OVR);
        prefs.end();
        Serial.println("[STORAGE] Cleared actuator override from NVS.");
        return result;
    }

    bool StorageManager::save_start_epoch_time(uint32_t start_time)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.putUInt(config::network::KEY_START_TIME, start_time) > 0;
        prefs.end();
        return result;
    }

    bool StorageManager::load_start_epoch_time(uint32_t &start_time)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        start_time = prefs.getUInt(config::network::KEY_START_TIME, 0);
        prefs.end();
        return start_time > 0;
    }

    bool StorageManager::save_elapsed_seconds(uint32_t elapsed_sec)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.putUInt(config::network::KEY_ELAPSED_SEC, elapsed_sec) > 0;
        prefs.end();
        return result;
    }

    bool StorageManager::load_elapsed_seconds(uint32_t &elapsed_sec)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        elapsed_sec = prefs.getUInt(config::network::KEY_ELAPSED_SEC, 0);
        prefs.end();
        return elapsed_sec > 0;
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
