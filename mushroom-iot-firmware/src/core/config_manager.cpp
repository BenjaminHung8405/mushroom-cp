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
    StorageManager& storage = StorageManager::get_instance();

    if (!storage.load_wifi_credentials(_ssid, _pass)) {
        _ssid = config::network::DEFAULT_STA_SSID;
        _pass = config::network::DEFAULT_STA_PASS;
    }
    if (!storage.load_mqtt_config(_mqtt_broker, _mqtt_port, _mqtt_user, _mqtt_pass)) {
        _mqtt_broker = config::network::DEFAULT_MQTT_BROKER;
        _mqtt_port = config::network::DEFAULT_MQTT_PORT;
        _mqtt_pass = config::network::DEFAULT_MQTT_PASS;
    }

    _device_id = config::network::resolve_device_identity();
    _mqtt_user = _device_id; // Mosquitto ACL requires username == client ID == device ID.

    // Load bio thresholds from NVS, fallback and save defaults if missing
    if (!storage.load_bio_thresholds(config::hardware::ThTOP, config::hardware::ThBOT, config::hardware::HmTOP, config::hardware::HmBOT)) {
        storage.save_bio_thresholds(config::hardware::ThTOP, config::hardware::ThBOT, config::hardware::HmTOP, config::hardware::HmBOT);
    }

    config::network::STA_SSID = _ssid;
    config::network::STA_PASS = _pass;
    config::network::MQTT_BROKER_VAL = _mqtt_broker;
    config::network::MQTT_PORT_VAL = _mqtt_port;
    config::network::MQTT_CLIENT_ID_VAL = _device_id;
    config::network::MQTT_USER_VAL = _device_id;
    config::network::MQTT_PASSWORD_VAL = _mqtt_pass;
    unlock();
}

String ConfigManager::getWifiSSID() {
    lock();
    const String val = _ssid;
    unlock();
    return val;
}

String ConfigManager::getWifiPass() {
    lock();
    const String val = _pass;
    unlock();
    return val;
}

String ConfigManager::getMqttBroker() {
    lock();
    const String val = _mqtt_broker;
    unlock();
    return val;
}

uint16_t ConfigManager::getMqttPort() {
    lock();
    const uint16_t val = _mqtt_port;
    unlock();
    return val;
}

String ConfigManager::getMqttUser() {
    lock();
    const String val = _mqtt_user;
    unlock();
    return val;
}

String ConfigManager::getMqttPass() {
    lock();
    const String val = _mqtt_pass;
    unlock();
    return val;
}

String ConfigManager::getDeviceId() {
    lock();
    const String val = _device_id;
    unlock();
    return val;
}

bool ConfigManager::saveNetworkConfig(const String& ssid, const String& pass,
                                      const String& mqtt_broker, uint16_t mqtt_port,
                                      const String& mqtt_pass) {
    lock();
    _ssid = ssid;
    _pass = pass;
    _mqtt_broker = mqtt_broker;
    _mqtt_port = mqtt_port;
    _mqtt_user = _device_id;
    _mqtt_pass = mqtt_pass;

    config::network::STA_SSID = _ssid;
    config::network::STA_PASS = _pass;
    config::network::MQTT_BROKER_VAL = _mqtt_broker;
    config::network::MQTT_PORT_VAL = _mqtt_port;
    config::network::MQTT_CLIENT_ID_VAL = _device_id;
    config::network::MQTT_USER_VAL = _device_id;
    config::network::MQTT_PASSWORD_VAL = _mqtt_pass;

    StorageManager& storage = StorageManager::get_instance();
    bool ok = storage.save_wifi_credentials(_ssid, _pass);
    ok = storage.save_mqtt_config(_mqtt_broker, _mqtt_port, _mqtt_user, _mqtt_pass) && ok;
    unlock();
    return ok;
}

} // namespace storage
