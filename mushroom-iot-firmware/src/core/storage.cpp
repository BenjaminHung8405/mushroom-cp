#include "core/storage.h"
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

    bool StorageManager::save_provisioning(uint16_t telemetry_interval_sec, uint8_t reporting_qos)
    {
        if (telemetry_interval_sec == 0)
        {
            telemetry_interval_sec = config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
        }
        if (reporting_qos > 1)
        {
            reporting_qos = config::network::DEFAULT_REPORTING_QOS;
        }

        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for provisioning write.");
            return false;
        }

        const size_t activated = prefs.putBool(config::network::KEY_PROVISIONED, true);
        const size_t interval = prefs.putUShort(config::network::KEY_TELEMETRY_INT, telemetry_interval_sec);
        const size_t qos = prefs.putUChar(config::network::KEY_REPORTING_QOS, reporting_qos);
        prefs.end();

        const bool saved = activated > 0 && interval > 0 && qos > 0;
        Serial.printf("[STORAGE] %s provisioning record (interval=%us qos=%u).\n",
                      saved ? "Saved" : "Failed to save",
                      static_cast<unsigned>(telemetry_interval_sec),
                      static_cast<unsigned>(reporting_qos));
        return saved;
    }

    bool StorageManager::load_provisioning(uint16_t &telemetry_interval_sec, uint8_t &reporting_qos)
    {
        telemetry_interval_sec = config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
        reporting_qos = config::network::DEFAULT_REPORTING_QOS;

        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }

        const bool provisioned = prefs.isKey(config::network::KEY_PROVISIONED) &&
                                 prefs.getBool(config::network::KEY_PROVISIONED, false);
        if (provisioned)
        {
            telemetry_interval_sec = prefs.getUShort(
                config::network::KEY_TELEMETRY_INT,
                config::network::DEFAULT_TELEMETRY_INTERVAL_SEC);
            reporting_qos = prefs.getUChar(
                config::network::KEY_REPORTING_QOS,
                config::network::DEFAULT_REPORTING_QOS);
        }
        prefs.end();

        if (!provisioned)
        {
            return false;
        }
        if (telemetry_interval_sec == 0)
        {
            telemetry_interval_sec = config::network::DEFAULT_TELEMETRY_INTERVAL_SEC;
        }
        if (reporting_qos > 1)
        {
            reporting_qos = config::network::DEFAULT_REPORTING_QOS;
        }
        return true;
    }

    bool StorageManager::clear_provisioning()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        const bool cleared = prefs.remove(config::network::KEY_PROVISIONED) ||
                             prefs.remove(config::network::KEY_PROVISION_TOKEN) ||
                             prefs.remove(config::network::KEY_TELEMETRY_INT) ||
                             prefs.remove(config::network::KEY_REPORTING_QOS);
        prefs.end();
        return cleared;
    }

    bool StorageManager::save_provision_token(const String &token)
    {
        if (token.length() < 36)
        {
            Serial.println("[STORAGE] Refused provision token shorter than UUID length.");
            return false;
        }
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for provision token write.");
            return false;
        }
        const size_t bytes = prefs.putString(config::network::KEY_PROVISION_TOKEN, token);
        prefs.end();
        return bytes == token.length();
    }

    bool StorageManager::load_provision_token(String &token)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        token = prefs.getString(config::network::KEY_PROVISION_TOKEN, "");
        prefs.end();
        return token.length() >= 36;
    }

    bool StorageManager::clear_provision_token()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        const bool cleared = prefs.remove(config::network::KEY_PROVISION_TOKEN);
        prefs.end();
        return cleared;
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

    bool StorageManager::save_baseline_config_revision(uint32_t revision)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false)) return false;
        const size_t written = prefs.putUInt("base_rev", revision);
        prefs.end();
        return written == sizeof(uint32_t);
    }

    bool StorageManager::load_baseline_config_revision(uint32_t &revision)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true)) return false;
        if (!prefs.isKey("base_rev")) { prefs.end(); return false; }
        revision = prefs.getUInt("base_rev", 0);
        prefs.end();
        return true;
    }

    bool StorageManager::clear_backend_snapshot()
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.remove(config::network::KEY_LAST_SP);
        prefs.remove("base_rev");
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

    bool StorageManager::save_operating_mode(uint8_t mode)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            return false;
        }
        bool result = prefs.putUChar(config::network::KEY_OP_MODE, mode) > 0;
        prefs.end();
        return result;
    }

    bool StorageManager::load_operating_mode(uint8_t &mode)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            return false;
        }
        const bool found = prefs.isKey(config::network::KEY_OP_MODE);
        if (found)
        {
            mode = prefs.getUChar(config::network::KEY_OP_MODE, 0U);
        }
        prefs.end();
        return found;
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

    bool StorageManager::save_bio_thresholds(float t_max, float t_min, float h_max, float h_min)
    {
        if (!std::isfinite(t_max) || !std::isfinite(t_min) ||
            !std::isfinite(h_max) || !std::isfinite(h_min) ||
            t_min >= t_max || h_min >= h_max)
        {
            Serial.println("[STORAGE] Error: Invalid bio threshold range.");
            return false;
        }

        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, false))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for writing bio thresholds.");
            return false;
        }
        const size_t t_max_bytes = prefs.putFloat(config::hardware::KEY_BIO_T_MAX, t_max);
        const size_t t_min_bytes = prefs.putFloat(config::hardware::KEY_BIO_T_MIN, t_min);
        const size_t h_max_bytes = prefs.putFloat(config::hardware::KEY_BIO_H_MAX, h_max);
        const size_t h_min_bytes = prefs.putFloat(config::hardware::KEY_BIO_H_MIN, h_min);
        prefs.end();
        if (t_max_bytes == 0 || t_min_bytes == 0 || h_max_bytes == 0 || h_min_bytes == 0)
        {
            Serial.println("[STORAGE] Error: Failed to save bio thresholds.");
            return false;
        }
        Serial.printf("[STORAGE] Saved bio thresholds: T_MAX=%.2f T_MIN=%.2f H_MAX=%.2f H_MIN=%.2f\n",
                      t_max, t_min, h_max, h_min);
        return true;
    }

    bool StorageManager::load_bio_thresholds(float &t_max, float &t_min, float &h_max, float &h_min)
    {
        Preferences prefs;
        if (!prefs.begin(config::network::NVS_NAMESPACE, true))
        {
            Serial.println("[STORAGE] Error: Failed to open NVS for reading bio thresholds.");
            return false;
        }
        if (prefs.isKey(config::hardware::KEY_BIO_T_MAX) &&
            prefs.isKey(config::hardware::KEY_BIO_T_MIN) &&
            prefs.isKey(config::hardware::KEY_BIO_H_MAX) &&
            prefs.isKey(config::hardware::KEY_BIO_H_MIN))
        {
            t_max = prefs.getFloat(config::hardware::KEY_BIO_T_MAX, 35.0f);
            t_min = prefs.getFloat(config::hardware::KEY_BIO_T_MIN, 29.0f);
            h_max = prefs.getFloat(config::hardware::KEY_BIO_H_MAX, 80.0f);
            h_min = prefs.getFloat(config::hardware::KEY_BIO_H_MIN, 65.0f);
            prefs.end();
            return true;
        }
        prefs.end();
        return false;
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
