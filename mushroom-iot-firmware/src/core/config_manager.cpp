#include "core/config_manager.h"
#include "core/storage.h"
#include "config.h"

#ifndef UNIT_TEST
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace storage {

    ConfigManager& ConfigManager::getInstance() {
        static ConfigManager instance;
        return instance;
    }

    ConfigManager::ConfigManager() {
#ifndef UNIT_TEST
        _mutex = xSemaphoreCreateMutex();
#endif
    }

    void ConfigManager::lock() {
#ifndef UNIT_TEST
        if (_mutex != nullptr) {
            xSemaphoreTake((SemaphoreHandle_t)_mutex, portMAX_DELAY);
        }
#endif
    }

    void ConfigManager::unlock() {
#ifndef UNIT_TEST
        if (_mutex != nullptr) {
            xSemaphoreGive((SemaphoreHandle_t)_mutex);
        }
#endif
    }

    void ConfigManager::init() {
        lock();
        
        StorageManager &storage = StorageManager::get_instance();
        
        // Load WiFi credentials
        storage.load_wifi_credentials(_ssid, _pass);
        
        // Load backend config
        storage.load_backend_config(_backend_url);
        if (_backend_url.length() == 0) {
            _backend_url = config::network::DEFAULT_BACKEND_URL;
        }

        // Load MQTT config
        if (!storage.load_mqtt_config(_mqtt_broker, _mqtt_port, _mqtt_user, _mqtt_pass)) {
            _mqtt_broker = config::network::DEFAULT_MQTT_BROKER;
            _mqtt_port = config::network::DEFAULT_MQTT_PORT;
            _mqtt_pass = config::network::DEFAULT_MQTT_PASS;
        }
        
        // Resolve device identity
        _device_id = config::network::resolve_device_identity();
        _mqtt_user = _device_id; // Username must equal device_id

        // Propagate config back to the backward-compatible global config namespace variables
        config::network::STA_SSID = _ssid;
        config::network::STA_PASS = _pass;
        config::network::BACKEND_API_URL = _backend_url;
        config::network::MQTT_BROKER_VAL = _mqtt_broker;
        config::network::MQTT_PORT_VAL = _mqtt_port;
        config::network::MQTT_CLIENT_ID_VAL = _device_id;
        config::network::MQTT_USER_VAL = _device_id;
        config::network::MQTT_PASSWORD_VAL = _mqtt_pass;

        unlock();
    }

    String ConfigManager::getWifiSSID() {
        lock();
        if (_ssid != config::network::STA_SSID) {
            _ssid = config::network::STA_SSID;
        }
        String val = _ssid;
        unlock();
        return val;
    }

    String ConfigManager::getWifiPass() {
        lock();
        if (_pass != config::network::STA_PASS) {
            _pass = config::network::STA_PASS;
        }
        String val = _pass;
        unlock();
        return val;
    }

    String ConfigManager::getBackendUrl() {
        lock();
        if (_backend_url != config::network::BACKEND_API_URL) {
            _backend_url = config::network::BACKEND_API_URL;
        }
        String val = _backend_url;
        unlock();
        return val;
    }

    String ConfigManager::getJwtToken() {
        lock();
        if (_jwt_token != config::network::MQTT_PASSWORD_VAL) {
            _jwt_token = config::network::MQTT_PASSWORD_VAL;
        }
        String val = _jwt_token;
        unlock();
        return val;
    }

    void ConfigManager::setJwtToken(const String& token) {
        lock();
        _jwt_token = token;
        // Keep backward-compatible global updated
        config::network::MQTT_PASSWORD_VAL = token;
        unlock();
    }

    String ConfigManager::getMqttBroker() {
        lock();
        if (_mqtt_broker != config::network::MQTT_BROKER_VAL) {
            _mqtt_broker = config::network::MQTT_BROKER_VAL;
        }
        String val = _mqtt_broker;
        unlock();
        return val;
    }

    uint16_t ConfigManager::getMqttPort() {
        lock();
        if (_mqtt_port != config::network::MQTT_PORT_VAL) {
            _mqtt_port = config::network::MQTT_PORT_VAL;
        }
        uint16_t val = _mqtt_port;
        unlock();
        return val;
    }

    String ConfigManager::getMqttUser() {
        lock();
        if (_mqtt_user != config::network::MQTT_USER_VAL) {
            _mqtt_user = config::network::MQTT_USER_VAL;
        }
        String val = _mqtt_user;
        unlock();
        return val;
    }

    String ConfigManager::getMqttPass() {
        lock();
        if (_mqtt_pass != config::network::MQTT_PASSWORD_VAL) {
            _mqtt_pass = config::network::MQTT_PASSWORD_VAL;
        }
        String val = _mqtt_pass;
        unlock();
        return val;
    }

    String ConfigManager::getDeviceId() {
        lock();
        String val = _device_id;
        unlock();
        return val;
    }

    bool ConfigManager::saveNetworkConfig(const String& ssid, const String& pass, 
                                         const String& backend_url, const String& mqtt_broker, 
                                         uint16_t mqtt_port, const String& mqtt_user, 
                                         const String& mqtt_pass) {
        lock();
        
        _ssid = ssid;
        _pass = pass;
        _backend_url = backend_url;
        _mqtt_broker = mqtt_broker;
        _mqtt_port = mqtt_port;
        _mqtt_user = _device_id; // Forced
        _mqtt_pass = mqtt_pass;

        // Propagate config back to the backward-compatible global config namespace variables
        config::network::STA_SSID = _ssid;
        config::network::STA_PASS = _pass;
        config::network::BACKEND_API_URL = _backend_url;
        config::network::MQTT_BROKER_VAL = _mqtt_broker;
        config::network::MQTT_PORT_VAL = _mqtt_port;
        config::network::MQTT_PASSWORD_VAL = _mqtt_pass;

        StorageManager &storage = StorageManager::get_instance();
        bool ok = storage.save_wifi_credentials(_ssid, _pass);
        ok = storage.save_backend_config(_backend_url) && ok;
        ok = storage.save_mqtt_config(_mqtt_broker, _mqtt_port, _mqtt_user, _mqtt_pass) && ok;

        unlock();
        return ok;
    }

} // namespace storage
