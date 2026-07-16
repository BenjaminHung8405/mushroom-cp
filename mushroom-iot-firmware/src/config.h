#pragma once

#include <stdint.h>
#ifndef UNIT_TEST
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

namespace config
{
    namespace pins
    {

        // Actuators (Relays)
        constexpr uint8_t PIN_RELAY_MIST = 10; // Sương (Fogger/Mist)
        constexpr uint8_t PIN_RELAY_FAN = 11;  // Quạt (Fan)
        constexpr uint8_t PIN_RELAY_HWAT = 12; // Sưởi nước (Heater Water)
        constexpr uint8_t PIN_RELAY_LAMP = 13; // Đèn nhiệt — relay duy nhất

        // I2C Bus (e.g. SHT30, SCD30)
        constexpr uint8_t PIN_I2C_SDA = 8;
        constexpr uint8_t PIN_I2C_SCL = 9;

        // WiFi provisioning button.
        // ESP32-S3 dev boards commonly expose BOOT on GPIO0 (active LOW).
        // Hold 5 seconds during runtime to force SoftAP config portal.
        constexpr uint8_t PIN_WIFI_CONFIG_BUTTON = 4;

        // PIN_BUTTON_UP / PIN_BUTTON_DOWN đã bị xóa:
        // GPIO 15 và 16 được dùng cho nút tủ điện (cabinet_buttons: LAMP, FAN).
        // Tham chiếu đúng: config::hardware::PIN_BTN_LAMP (15), PIN_BTN_FAN (16).

        // KY-040 rotary encoder. Supply the module at 3.3 V only.
        constexpr uint8_t PIN_ENCODER_CLK = 5;
        constexpr uint8_t PIN_ENCODER_DT = 6;
        constexpr uint8_t PIN_ENCODER_SW = 7;

    } // namespace pins

    namespace network
    {
        // Default SoftAP Configuration for WiFi Setup (Captive Portal)
        constexpr const char *AP_SSID = "TraiNam_Setup_KhongDay";
        constexpr const char *AP_PASS = "12345678";

        // Injected at build time from the repository's shared .env file.
        // This keeps firmware and the web client on the same public API origin.
#ifdef UNIT_TEST
#ifndef DEFAULT_MQTT_BROKER_URL
#define DEFAULT_MQTT_BROKER_URL "mushroomapp.mitelai.com"
#endif
#ifndef DEFAULT_MQTT_PORT_VALUE
#define DEFAULT_MQTT_PORT_VALUE 1883
#endif
#ifndef IOT_TENANT
#define IOT_TENANT "test_tenant"
#endif
#ifndef BOOTSTRAP_USERNAME
#define BOOTSTRAP_USERNAME "test_user"
#endif
#ifndef BOOTSTRAP_PASSWORD
#define BOOTSTRAP_PASSWORD "test_pass"
#endif
#endif

#if !defined(UNIT_TEST) && (!defined(DEFAULT_MQTT_BROKER_URL) || !defined(DEFAULT_MQTT_PORT_VALUE) || !defined(IOT_TENANT) || !defined(BOOTSTRAP_USERNAME) || !defined(BOOTSTRAP_PASSWORD))
#error "Firmware MQTT defaults, tenant, and bootstrap credentials must be provided by the PlatformIO environment script"
#endif
        constexpr const char *DEFAULT_MQTT_BROKER = DEFAULT_MQTT_BROKER_URL;
        constexpr uint16_t DEFAULT_MQTT_PORT = DEFAULT_MQTT_PORT_VALUE;
        constexpr const char *TENANT = IOT_TENANT;
        constexpr const char *BOOTSTRAP_USER = BOOTSTRAP_USERNAME;
        constexpr const char *BOOTSTRAP_SECRET = BOOTSTRAP_PASSWORD;
        constexpr uint16_t DEFAULT_TELEMETRY_INTERVAL_SEC = 30;
        constexpr uint8_t DEFAULT_REPORTING_QOS = 1;
        constexpr const char *DEFAULT_MQTT_PASS = "";

        // NVS Storage namespace and keys (Preference keys must be <= 15 chars)
        constexpr const char *NVS_NAMESPACE = "mushroom_cfg";
        constexpr const char *KEY_WIFI_SSID = "wifi_ssid";
        constexpr const char *KEY_WIFI_PASS = "wifi_pass";
        constexpr const char *KEY_MQTT_BROKER = "mqtt_broker";
        constexpr const char *KEY_MQTT_PORT = "mqtt_port";
        constexpr const char *KEY_MQTT_USER = "mqtt_user";
        constexpr const char *KEY_MQTT_PASS = "mqtt_pass";
        constexpr const char *KEY_DEVICE_ID = "device_id";
        constexpr const char *KEY_PROVISIONED = "provisioned";
        constexpr const char *KEY_PROVISION_TOKEN = "provision_token";
        constexpr const char *KEY_TELEMETRY_INT = "tel_interval";
        constexpr const char *KEY_REPORTING_QOS = "report_qos";
        constexpr const char *KEY_LAST_SP = "last_sp";
        constexpr const char *KEY_HW_OVR = "hw_ovr";
        constexpr const char *KEY_ACT_OVR = "act_ovr";
        constexpr const char *KEY_START_TIME = "start_time";
        constexpr const char *KEY_ELAPSED_SEC = "elapsed_sec";

        // WiFi Station (STA) credentials - Động, khởi tạo dạng chuỗi trống, bắt buộc đọc từ NVS
        extern String STA_SSID;
        extern String STA_PASS;

        // MQTT configuration variables - Động, khởi tạo dạng chuỗi trống hoặc mặc định, bắt buộc đọc từ NVS
        extern String MQTT_BROKER_VAL;
        extern uint16_t MQTT_PORT_VAL;
        extern String MQTT_CLIENT_ID_VAL;
        extern String MQTT_USER_VAL;
        extern String MQTT_PASSWORD_VAL;

        String resolve_device_identity();

        /**
         * @brief Nạp các cấu hình động (WiFi STA và MQTT) từ NVS Flash.
         * Nếu NVS trống hoặc lỗi, các biến động sẽ giữ nguyên giá trị mặc định (chuỗi rỗng hoặc giá trị mặc định).
         * @return true nếu đọc thành công ít nhất cấu hình WiFi STA từ NVS, false nếu NVS trống.
         */
        bool load_runtime_config();

    } // namespace network

    namespace hardware
    {
        // Nút bấm tủ điện vật lý (active-LOW, INPUT_PULLUP).
        // Cần thêm trở kéo ngoài 4.7kΩ + tụ lọc 100nF + trở debounce 10kΩ ở môi trường production.
        // Tất cả 3 chân theo cùng pattern: GPIO4 = chuẩn tham chiếu, 15 và 16 đồng bộ theo.
        constexpr uint8_t PIN_BTN_MIST = 4;  // Nút Sương — chuẩn tham chiếu
        constexpr uint8_t PIN_BTN_LAMP = 15; // Nút Đèn — INPUT_PULLUP, debounce 8-sample shift-register
        constexpr uint8_t PIN_BTN_FAN = 16;  // Nút Quạt — INPUT_PULLUP, debounce 8-sample shift-register

        // Configurable button polling interval (20ms to prevent CPU context choke)
        constexpr uint32_t BUTTON_POLL_INTERVAL_MS = 20;

        // Manual override duration while auto mode is enabled (AON).
        constexpr uint32_t MANUAL_LATCH_TTL_MS = 30000;
        // Manual ON duration while auto mode is disabled (AOFF).
        constexpr uint32_t MANUAL_AOFF_LATCH_TTL_MS = 180000;

        // Continuous-operation safety lock for every relay channel.
        constexpr uint32_t MAX_ON_DURATION_MS = 180000;
        constexpr uint32_t COOLDOWN_DURATION_MS = 30000;
        constexpr uint32_t LAMP_OVER_TEMP_COOLDOWN_MS = 300000;
        constexpr uint32_t MIST_OVER_HUMIDITY_COOLDOWN_MS = 600000;

        // NVS Keys for Bio Thresholds
        constexpr const char *KEY_BIO_T_MAX = "bio_t_max";
        constexpr const char *KEY_BIO_T_MIN = "bio_t_min";
        constexpr const char *KEY_BIO_H_MAX = "bio_h_max";
        constexpr const char *KEY_BIO_H_MIN = "bio_h_min";

        // Dynamic bio thresholds (loaded from NVS)
        extern float ThTOP;
        extern float ThBOT;
        extern float HmTOP;
        extern float HmBOT;
    } // namespace hardware

    namespace control
    {
        // Automatic fuzzy control is opt-in. Manual latches, including requests
        // from physical cabinet buttons, are applied later in the pipeline and
        // remain operational when this is false.
        constexpr bool ENABLE_FUZZY_CONTROL = false;

        // Inertia compensation coefficients (in seconds)
        constexpr float K_INERTIA_TEMP = 45.0f;  // seconds
        constexpr float K_INERTIA_HUMID = 30.0f; // seconds

    } // namespace control

    namespace safe_offline
    {
        // Cấu hình phòng thủ bảo vệ sinh học tối đa cho Nấm Rơm miền Tây (Vụ 1 - 15/07)
        constexpr float TEMP_TARGET_C = 30.0f;      // Điểm ngọt sinh học cho nấm rơm ra ghim
        constexpr float HUMIDITY_TARGET_RH = 83.0f; // Ngưỡng ẩm an toàn chống thối tơ khi mất mạng
        constexpr float CO2_TARGET_PPM = 1000.0f;   // Giới hạn thông gió chống ngộp khí
    } // namespace safe_offline

    // Biến cho phép bật/tắt chế độ điều khiển bằng fuzzy
    extern bool FUZZY_CONTROL_ENABLED;

} // namespace config
