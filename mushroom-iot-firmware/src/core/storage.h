#pragma once

#include <Arduino.h>
#include "config.h"

namespace storage
{
    /**
     * @brief Snapshot POD structures for setpoints persistence in NVS.
     * Aligned to 4 bytes for ESP32 memory efficiency.
     */
    struct BackendSetpointSnapshot
    {
        float temp_target;
        float humidity_target;
        float co2_target;
        bool valid;
    } __attribute__((aligned(4)));

    struct HardwareOverrideSnapshot
    {
        float temp_target;
        float humidity_target;
        bool active;
    } __attribute__((aligned(4)));

    struct ActuatorOverrideSnapshot
    {
        int8_t mist_override;       // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
        int8_t fan_override;        // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
        int8_t heater_air_override; // 0: AUTO, 1: FORCE_ON, 2: FORCE_OFF
        bool active;
    } __attribute__((aligned(4)));

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
         * @brief Persists the one-way cloud provisioning activation record.
         */
        bool save_provisioning(uint16_t telemetry_interval_sec, uint8_t reporting_qos);

        /**
         * @brief Loads a valid cloud provisioning record.
         */
        bool load_provisioning(uint16_t &telemetry_interval_sec, uint8_t &reporting_qos);

        /**
         * @brief Removes cloud activation. This is called only by local factory reset.
         */
        bool clear_provisioning();

        /**
         * @brief Stores the unique MQTT token assigned during bootstrap provisioning.
         */
        bool save_provision_token(const String &token);

        /**
         * @brief Loads the unique MQTT token assigned during bootstrap provisioning.
         */
        bool load_provision_token(String &token);

        /**
         * @brief Removes the MQTT token during factory reset.
         */
        bool clear_provision_token();

        /**
         * @brief Saves provisioned device identity override to NVS.
         * @param device_id Canonical device ID (also used as MQTT username/clientId).
         */
        bool save_device_id(const String &device_id);

        /**
         * @brief Loads provisioned device identity from NVS.
         * @return true if a non-empty device_id exists.
         */
        bool load_device_id(String &device_id);

        /**
         * @brief Checks whether a provisioned device identity exists in NVS.
         */
        bool has_device_id();

        /**
         * @brief Clears provisioned device identity from NVS.
         */
        bool clear_device_id();

        /**
         * @brief Saves backend setpoint snapshot to NVS.
         */
        bool save_backend_snapshot(const BackendSetpointSnapshot &snapshot);

        /**
         * @brief Loads backend setpoint snapshot from NVS.
         */
        bool load_backend_snapshot(BackendSetpointSnapshot &snapshot);

        /**
         * @brief Clears backend setpoint snapshot from NVS.
         */
        bool clear_backend_snapshot();
        bool save_baseline_config_revision(uint32_t revision);
        bool load_baseline_config_revision(uint32_t &revision);

        /**
         * @brief Saves hardware override snapshot to NVS.
         */
        bool save_hardware_override(const HardwareOverrideSnapshot &snapshot);

        /**
         * @brief Loads hardware override snapshot from NVS.
         */
        bool load_hardware_override(HardwareOverrideSnapshot &snapshot);

        /**
         * @brief Clears hardware override snapshot from NVS.
         */
        bool clear_hardware_override();

        /**
         * @brief Saves actuator manual override snapshot to NVS.
         */
        bool save_actuator_override(const ActuatorOverrideSnapshot &snapshot);

        /**
         * @brief Loads actuator manual override snapshot from NVS.
         */
        bool load_actuator_override(ActuatorOverrideSnapshot &snapshot);

        /**
         * @brief Clears actuator manual override snapshot from NVS.
         */
        bool clear_actuator_override();

        /** @brief Persists global operating mode (0=AI, 1=MANUAL). */
        bool save_operating_mode(uint8_t mode);
        bool load_operating_mode(uint8_t &mode);

        /**
         * @brief Saves start epoch time (in seconds) to NVS.
         */
        bool save_start_epoch_time(uint32_t start_time);

        /**
         * @brief Loads start epoch time (in seconds) from NVS.
         */
        bool load_start_epoch_time(uint32_t &start_time);

        /**
         * @brief Saves elapsed seconds since batch started to NVS.
         */
        bool save_elapsed_seconds(uint32_t elapsed_sec);

        /**
         * @brief Loads elapsed seconds since batch started from NVS.
         */
        bool load_elapsed_seconds(uint32_t &elapsed_sec);

        /** Increment and persist the boot session counter before network/tasks begin. */
        bool increment_boot_count(uint32_t &boot_count);

        /**
         * @brief Saves configurable bio protection thresholds to NVS.
         */
        bool save_bio_thresholds(float t_max, float t_min, float h_max, float h_min);

        /**
         * @brief Loads configurable bio protection thresholds from NVS.
         */
        bool load_bio_thresholds(float &t_max, float &t_min, float &h_max, float &h_min);

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
