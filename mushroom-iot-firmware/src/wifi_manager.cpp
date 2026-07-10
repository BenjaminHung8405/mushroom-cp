#include "wifi_manager.h"
#include "config.h"
#include "storage.h"

#ifndef UNIT_TEST
#include <WiFi.h>
#endif

namespace wifi
{
    // Biến lưu trữ trạng thái WiFi nội bộ
    static WifiState current_state = WifiState::IDLE;
    static unsigned long connection_start_time = 0;
    static unsigned long last_reconnect_attempt = 0;

    // Các hằng số cấu hình thời gian (ms)
    constexpr unsigned long WIFI_CONNECTION_TIMEOUT_MS = 15000; // 15 giây
    constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000; // 10 giây

    WifiState init_wifi()
    {
        Serial.println("[WIFI] Initializing WiFi Manager...");

        // Đọc cấu hình WiFi STA từ NVS thông qua cấu hình hệ thống
        bool has_config = config::network::load_runtime_config();

        if (has_config)
        {
            Serial.printf("[WIFI] Found WiFi credentials in NVS (SSID: %s). Transitioning to STA_CONNECTING.\n",
                          config::network::STA_SSID.c_str());
            WiFi.mode(WIFI_STA);
            WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
            connection_start_time = millis();
            current_state = WifiState::STA_CONNECTING;
        }
        else
        {
            Serial.println("[WIFI] No WiFi credentials found in NVS. Transitioning to SOFTAP_ACTIVE.");
            current_state = WifiState::SOFTAP_ACTIVE;
        }

        return current_state;
    }

    void check_wifi_connection()
    {
        unsigned long now = millis();

        switch (current_state)
        {
            case WifiState::STA_CONNECTING:
            {
                if (WiFi.status() == WL_CONNECTED)
                {
                    Serial.printf("[WIFI] WiFi Connected successfully! IP: %s\n", WiFi.localIP().toString().c_str());
                    current_state = WifiState::STA_CONNECTED;
                }
                else if (now - connection_start_time >= WIFI_CONNECTION_TIMEOUT_MS)
                {
                    Serial.println("[WIFI] WiFi connection timeout! Transitioning to STA_DISCONNECTED.");
                    WiFi.disconnect();
                    current_state = WifiState::STA_DISCONNECTED;
                    last_reconnect_attempt = now;
                }
                break;
            }
            case WifiState::STA_CONNECTED:
            {
                if (WiFi.status() != WL_CONNECTED)
                {
                    Serial.println("[WIFI] WiFi connection lost! Transitioning to STA_DISCONNECTED.");
                    current_state = WifiState::STA_DISCONNECTED;
                    last_reconnect_attempt = now;
                }
                break;
            }
            case WifiState::STA_DISCONNECTED:
            {
                if (now - last_reconnect_attempt >= WIFI_RECONNECT_INTERVAL_MS)
                {
                    Serial.println("[WIFI] Reconnection interval reached. Retrying connection...");
                    reconnect_wifi();
                }
                break;
            }
            case WifiState::SOFTAP_ACTIVE:
            case WifiState::IDLE:
            default:
                // SoftAP hoặc IDLE không tự động thực hiện hành vi trong check_wifi_connection
                break;
        }
    }

    void reconnect_wifi()
    {
        Serial.printf("[WIFI] Reconnecting to SSID: %s...\n", config::network::STA_SSID.c_str());
        // Gọi WiFi.begin để tái kết nối
        WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
        connection_start_time = millis();
        current_state = WifiState::STA_CONNECTING;
    }

    WifiState get_wifi_state()
    {
        return current_state;
    }

} // namespace wifi
