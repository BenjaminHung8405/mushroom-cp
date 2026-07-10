#pragma once

#include <Arduino.h>
#include "config.h"

namespace storage
{
    /**
     * @brief Manager class for handling non-volatile storage (NVS) using ESP32 Preferences library.
     * Enforces type safety, centralized namespace/keys, and proper error/log tracing.
     */
    class StorageManager
    {
    public:
        // Singleton Instance Access
        static StorageManager &get_instance();

        // Disable copy and assignment operations
        StorageManager(const StorageManager &) = delete;
        StorageManager &operator=(const StorageManager &) = delete;

        /**
         * @brief Initializes NVS storage by opening and closing preferences to verify access.
         * @return true if initialized successfully, false otherwise.
         */
        bool init();

        /**
         * @brief Saves WiFi credentials to NVS storage.
         * @param ssid WiFi SSID string
         * @param pass WiFi Password string
         * @return true if saved successfully, false otherwise.
         */
        bool save_wifi_credentials(const String &ssid, const String &pass);

        /**
         * @brief Loads WiFi credentials from NVS storage.
         * @param[out] ssid Output parameter for WiFi SSID
         * @param[out] pass Output parameter for WiFi Password
         * @return true if credentials existed and were loaded successfully, false otherwise.
         */
        bool load_wifi_credentials(String &ssid, String &pass);

        /**
         * @brief Checks if WiFi credentials exist in NVS.
         * @return true if SSID exists, false otherwise.
         */
        bool has_wifi_credentials();

        /**
         * @brief Clears WiFi credentials from NVS storage.
         * @return true if cleared successfully, false otherwise.
         */
        bool clear_wifi_credentials();

        /**
         * @brief Saves MQTT configuration parameters to NVS.
         * @param broker MQTT Broker address (IP or domain name)
         * @param port MQTT connection port
         * @param user MQTT username
         * @param pass MQTT password
         * @return true if saved successfully, false otherwise.
         */
        bool save_mqtt_config(const String &broker, uint16_t port, const String &user, const String &pass);

        /**
         * @brief Loads MQTT configuration from NVS.
         * @param[out] broker Output parameter for MQTT Broker address
         * @param[out] port Output parameter for MQTT port
         * @param[out] user Output parameter for MQTT username
         * @param[out] pass Output parameter for MQTT password
         * @return true if MQTT configuration existed and was loaded successfully, false otherwise.
         */
        bool load_mqtt_config(String &broker, uint16_t &port, String &user, String &pass);

        /**
         * @brief Checks if MQTT configuration exists in NVS.
         * @return true if broker configuration exists, false otherwise.
         */
        bool has_mqtt_config();

        /**
         * @brief Clears MQTT configuration from NVS storage.
         * @return true if cleared successfully, false otherwise.
         */
        bool clear_mqtt_config();

        /**
         * @brief Deletes all keys in the storage namespace, performing a factory reset.
         * @return true if reset successfully, false otherwise.
         */
        bool factory_reset();

    private:
        StorageManager() = default;
        ~StorageManager() = default;
    };
} // namespace storage
