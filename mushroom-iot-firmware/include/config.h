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
        constexpr uint8_t PIN_RELAY_MIST   = 10; // Sương (Fogger/Mist)
        constexpr uint8_t PIN_RELAY_FAN    = 11; // Quạt (Fan)
        constexpr uint8_t PIN_RELAY_HWAT   = 12; // Sưởi nước (Heater Water)
        // Đèn nhiệt: 2 kênh TPC (stage1/stage2) dùng chung 1 relay vật lý GPIO 13.
        // LAMP_2 cố ý trỏ vào LAMP_1 để merge 2 stage thành 1 pin.
        constexpr uint8_t PIN_RELAY_LAMP_1 = 13; // Đèn nhiệt — relay duy nhất
        constexpr uint8_t PIN_RELAY_LAMP_2 = 13; // Alias LAMP_1 — merged single-relay wiring

        // I2C Bus (e.g. SHT30, SCD30)
        constexpr uint8_t PIN_I2C_SDA = 8;
        constexpr uint8_t PIN_I2C_SCL = 9;

        // WiFi provisioning button.
        // ESP32-S3 dev boards commonly expose BOOT on GPIO0 (active LOW).
        // Hold 5 seconds during runtime to force SoftAP config portal.
        constexpr uint8_t PIN_WIFI_CONFIG_BUTTON = 0;

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

        // Default Fallback Configurations for Backend and MQTT (used on first boot / missing NVS config)
        constexpr const char *DEFAULT_BACKEND_URL = "http://192.168.1.136:3001";
        constexpr const char *DEFAULT_MQTT_BROKER = "192.168.1.136";
        constexpr uint16_t DEFAULT_MQTT_PORT = 18883;
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
        constexpr const char *KEY_BACKEND_URL = "backend_url";
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

        // Backend API URL (persisted in NVS) and runtime JWT token (RAM only)
        extern String BACKEND_API_URL;
        extern String AUTH_JWT_TOKEN;

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
        constexpr uint8_t PIN_BTN_FAN  = 16; // Nút Quạt — INPUT_PULLUP, debounce 8-sample shift-register

        // Manual latch duration (15 minutes)
        constexpr uint32_t MANUAL_LATCH_TTL_MS = 900000;
    } // namespace hardware

    namespace safe_offline
    {
        // Cấu hình phòng thủ bảo vệ sinh học tối đa cho Nấm Rơm miền Tây (Vụ 1 - 15/07)
        constexpr float TEMP_TARGET_C = 30.0f;      // Điểm ngọt sinh học cho nấm rơm ra ghim
        constexpr float HUMIDITY_TARGET_RH = 83.0f; // Ngưỡng ẩm an toàn chống thối tơ khi mất mạng
        constexpr float CO2_TARGET_PPM = 1000.0f;   // Giới hạn thông gió chống ngộp khí
    } // namespace safe_offline

} // namespace config
