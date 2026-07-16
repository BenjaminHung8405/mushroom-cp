#pragma once
#include <Arduino.h>

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace storage {

    class ConfigManager {
    public:
        static ConfigManager& getInstance();

        ConfigManager(const ConfigManager&) = delete;
        ConfigManager& operator=(const ConfigManager&) = delete;

        void init();

        // WiFi Station Credentials
        String getWifiSSID();
        String getWifiPass();

        // MQTT configurations
        String getMqttBroker();
        uint16_t getMqttPort();
        String getMqttUser();
        String getMqttPass();
        String getDeviceId();

        // Unified network config updater
        bool saveNetworkConfig(const String& ssid, const String& pass,
                               const String& mqtt_broker, uint16_t mqtt_port,
                               const String& mqtt_pass);

    private:
        ConfigManager();
        ~ConfigManager() = default;

        String _ssid;
        String _pass;
        String _mqtt_broker;
        uint16_t _mqtt_port = 1883;
        String _mqtt_user;
        String _mqtt_pass;
        String _device_id;

#ifndef UNIT_TEST
        void* _mutex = nullptr;
#endif
        void lock();
        void unlock();
    };

} // namespace storage
