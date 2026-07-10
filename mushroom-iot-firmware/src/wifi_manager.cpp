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

    WifiState init_wifi()
    {
        Serial.println("[WIFI] Initializing WiFi Manager skeleton...");

        // Đọc cấu hình WiFi STA từ NVS thông qua cấu hình hệ thống
        bool has_config = config::network::load_runtime_config();

        if (has_config)
        {
            Serial.printf("[WIFI] Found WiFi credentials in NVS (SSID: %s). Transitioning to STA_CONNECTING.\n",
                          config::network::STA_SSID.c_str());
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
        // Khung hàm kiểm tra định kỳ trạng thái kết nối
        // Sẽ được cài đặt logic đầy đủ ở Task B2
    }

    void reconnect_wifi()
    {
        // Khung hàm xử lý kết nối lại khi mất mạng
        // Sẽ được cài đặt logic đầy đủ ở Task B2
    }

    WifiState get_wifi_state()
    {
        return current_state;
    }

} // namespace wifi
