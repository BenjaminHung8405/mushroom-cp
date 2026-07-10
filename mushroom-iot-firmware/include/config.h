#pragma once

#include <stdint.h>

namespace config
{
    namespace pins
    {

        // Actuators (Relays)
        constexpr uint8_t PIN_RELAY_MIST = 10;     // Sương (Fogger/Mist)
        constexpr uint8_t PIN_RELAY_FAN = 11;      // Quạt (Fan)
        constexpr uint8_t PIN_RELAY_HEATER_1 = 12; // Sưởi 1 (Heater 1)
        constexpr uint8_t PIN_RELAY_HEATER_2 = 13; // Sưởi 2 (Heater 2)

        // I2C Bus (e.g. SHT30, SCD30)
        constexpr uint8_t PIN_I2C_SDA = 8;
        constexpr uint8_t PIN_I2C_SCL = 9;

        // OneWire Bus (e.g. DS18B20)
        constexpr uint8_t PIN_ONE_WIRE = 14;

    } // namespace pins

    namespace network
    {

// WiFi credentials (defined in ifndef blocks to allow override via compiler flags)
#ifndef WIFI_SSID
#define WIFI_SSID "TanLeQuyen_02"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "AnhHung326_7"
#endif

// Fallback WiFi credentials for redundancy
#ifndef WIFI_FALLBACK_SSID
#define WIFI_FALLBACK_SSID "Mushroom_WiFi_Backup"
#endif

#ifndef WIFI_FALLBACK_PASSWORD
#define WIFI_FALLBACK_PASSWORD "backup_secure_pass"
#endif

// MQTT configuration
#ifndef MQTT_BROKER
#define MQTT_BROKER "192.168.1.50"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

#ifndef MQTT_CLIENT_ID
#define MQTT_CLIENT_ID "esp32_mushroom_client"
#endif

#ifndef MQTT_USER
#define MQTT_USER "mushroom_device"
#endif

#ifndef MQTT_PASSWORD
#define MQTT_PASSWORD "mqtt_secure_pass"
#endif

        // Type-safe constants for use in codebase
        constexpr const char *WIFI_SSID_VAL = WIFI_SSID;
        constexpr const char *WIFI_PASS_VAL = WIFI_PASSWORD;
        constexpr const char *WIFI_BACKUP_SSID_VAL = WIFI_FALLBACK_SSID;
        constexpr const char *WIFI_BACKUP_PASS_VAL = WIFI_FALLBACK_PASSWORD;

        constexpr const char *MQTT_BROKER_VAL = MQTT_BROKER;
        constexpr uint16_t MQTT_PORT_VAL = MQTT_PORT;
        constexpr const char *MQTT_CLIENT_ID_VAL = MQTT_CLIENT_ID;
        constexpr const char *MQTT_USER_VAL = MQTT_USER;
        constexpr const char *MQTT_PASSWORD_VAL = MQTT_PASSWORD;

    } // namespace network

} // namespace config
