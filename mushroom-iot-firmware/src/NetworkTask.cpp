#include "NetworkTask.h"
#include "config.h"
#include "definitions.h"

#ifndef UNIT_TEST
#include <WiFi.h>
#else
#include "Arduino.h"
#endif

namespace network
{
    void initWiFiModes()
    {
        Serial.println("[NETWORK] Initializing WiFi in WIFI_AP_STA mode...");

        // Nạp cấu hình từ NVS
        bool has_config = config::network::load_runtime_config();

        // Cấu hình không chặn và ngắt kết nối cũ nếu có
        WiFi.persistent(false);
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(false, false);
        delay(50);

        // Thiết lập chế độ AP_STA
        WiFi.mode(WIFI_AP_STA);
        delay(50);

        // Khởi động SoftAP nội bộ
        bool ap_started = WiFi.softAP(
            config::network::AP_SSID,
            config::network::AP_PASS,
            1, // Kênh 1
            0, // Không ẩn SSID
            4  // Tối đa 4 kết nối
        );

        if (ap_started)
        {
            Serial.printf("[NETWORK] SoftAP Activated: %s, IP: %s\n", 
                          config::network::AP_SSID, 
                          WiFi.softAPIP().toString().c_str());
        }
        else
        {
            Serial.println("[NETWORK] ERROR: Failed to start SoftAP!");
        }

        // Bắt đầu tiến trình kết nối Router ngoài không chặn nếu có cấu hình hợp lệ
        if (has_config && !config::network::STA_SSID.isEmpty())
        {
            Serial.printf("[NETWORK] Connecting to STA SSID: %s (non-blocking)\n", 
                          config::network::STA_SSID.c_str());
            WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
        }
        else
        {
            Serial.println("[NETWORK] No STA credentials configured in NVS. SoftAP active for provisioning.");
        }
    }
}
