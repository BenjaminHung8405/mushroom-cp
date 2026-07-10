#include "wifi_manager.h"
#include "config.h"
#include "storage.h"
#include "definitions.h"
#include <ArduinoJson.h>

#ifndef UNIT_TEST
#include <DNSServer.h>
#include <ESP.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#endif

namespace wifi
{
    // Biến lưu trữ trạng thái WiFi nội bộ

#ifndef UNIT_TEST
    static DNSServer dnsServer;
    static WebServer webServer(80);
    static void setup_web_server();
#endif

    static WifiState current_state = WifiState::IDLE;
    static unsigned long connection_start_time = 0;
    static unsigned long last_reconnect_attempt = 0;
    static int reconnect_attempts = 0;
    static unsigned long softap_start_time = 0;

    // Các hằng số cấu hình thời gian (ms)
    constexpr unsigned long WIFI_CONNECTION_TIMEOUT_MS = 15000; // 15 giây
    constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000; // 10 giây
    constexpr int MAX_RECONNECT_ATTEMPTS = 3;
    constexpr unsigned long SOFTAP_TIMEOUT_MS = 900000; // 15 phút (900000 ms)

    static void set_state(WifiState new_state)
    {
        current_state = new_state;

        if (new_state == WifiState::SOFTAP_ACTIVE)
        {
            softap_start_time = millis();
        }

        // Synchronize Event Bits to Core 1
        if (xWifiEventGroup != nullptr)
        {
            if (new_state == WifiState::STA_CONNECTED)
            {
                xEventGroupSetBits(xWifiEventGroup, WIFI_CONNECTED_BIT);
                xEventGroupClearBits(xWifiEventGroup, WIFI_SOFTAP_BIT);
            }
            else if (new_state == WifiState::SOFTAP_ACTIVE)
            {
                xEventGroupSetBits(xWifiEventGroup, WIFI_SOFTAP_BIT);
                xEventGroupClearBits(xWifiEventGroup, WIFI_CONNECTED_BIT);
            }
            else
            {
                xEventGroupClearBits(xWifiEventGroup, WIFI_CONNECTED_BIT | WIFI_SOFTAP_BIT);
            }
        }
    }

    static bool start_softap()
    {
        Serial.println("[WIFI] Activating SoftAP Mode...");
        WiFi.mode(WIFI_AP);
        bool ap_started = WiFi.softAP(
            config::network::AP_SSID,
            config::network::AP_PASS);

        if (ap_started)
        {
            Serial.printf("[WIFI] SoftAP Activated: %s\n", config::network::AP_SSID);
            Serial.printf("[WIFI] SoftAP IP: %s\n", WiFi.softAPIP().toString().c_str());
            set_state(WifiState::SOFTAP_ACTIVE);

#ifndef UNIT_TEST
            // Khởi động DNS Server để chuyển hướng mọi domain về IP SoftAP
            dnsServer.start(53, "*", WiFi.softAPIP());

            // Khởi động WebServer
            setup_web_server();
            webServer.begin();
#endif
            return true;
        }
        else
        {
            Serial.println("[WIFI] ERROR: Failed to start SoftAP.");
            set_state(WifiState::IDLE);
            return false;
        }
    }

    /**
     * @brief Fetch JWT auth token from the NestJS backend after WiFi connects.
     * Stores the token in config::network::AUTH_JWT_TOKEN (RAM only).
     * In UNIT_TEST builds, always succeeds with a mock token.
     */
    static bool fetch_auth_token()
    {
#ifdef UNIT_TEST
        // Unit-test stub: inject a mock JWT so MQTT can proceed without HTTP.
        if (config::network::AUTH_JWT_TOKEN.length() == 0)
        {
            config::network::AUTH_JWT_TOKEN = "mock_jwt_token_for_unit_test";
        }
        Serial.println("[AUTH] UNIT_TEST stub: mock JWT injected.");
        return true;
#else
        if (config::network::BACKEND_API_URL.length() == 0)
        {
            Serial.println("[AUTH] Backend API URL is empty. Cannot fetch token.");
            return false;
        }

        // Build URL: strip trailing slash if present, then append /auth/token
        String base = config::network::BACKEND_API_URL;
        if (base.endsWith("/"))
        {
            base.remove(base.length() - 1);
        }
        String url = base + "/auth/token";

        Serial.printf("[AUTH] Requesting JWT from: %s\n", url.c_str());

        HTTPClient http;
        http.begin(url);
        http.addHeader("Content-Type", "application/json");
        http.setTimeout(5000);

        // Build request body
        StaticJsonDocument<256> req;
        req["clientId"] = config::network::MQTT_CLIENT_ID_VAL;
        req["mqttUser"] = config::network::MQTT_USER_VAL;

        String body;
        serializeJson(req, body);

        int status = http.POST(body);
        if (status != 200)
        {
            Serial.printf("[AUTH] Token request failed. HTTP status: %d\n", status);
            http.end();
            return false;
        }

        String response = http.getString();
        http.end();

        StaticJsonDocument<768> doc;
        DeserializationError err = deserializeJson(doc, response);
        if (err)
        {
            Serial.printf("[AUTH] Failed to parse token JSON: %s\n", err.c_str());
            return false;
        }

        // Accept common JWT response field names
        const char *token = nullptr;
        if (doc.containsKey("token"))
            token = doc["token"];
        else if (doc.containsKey("accessToken"))
            token = doc["accessToken"];
        else if (doc.containsKey("access_token"))
            token = doc["access_token"];

        if (token == nullptr || strlen(token) == 0)
        {
            Serial.println("[AUTH] Token response missing token field.");
            return false;
        }

        config::network::AUTH_JWT_TOKEN = token;
        Serial.println("[AUTH] JWT token acquired successfully.");
        return true;
#endif
    }

#ifndef UNIT_TEST
    static const char *captive_html = R"rawliteral(
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TraiNam Cau Hinh WiFi & MQTT</title>
<style>
body { font-family: Arial, sans-serif; margin: 20px; background: #f0f2f5; }
.container { max-width: 400px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
h2 { text-align: center; color: #333; }
label { font-weight: bold; margin-top: 10px; display: block; color: #555; }
input { width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
input[type="submit"] { background: #4CAF50; color: white; border: none; cursor: pointer; padding: 12px; font-size: 16px; font-weight: bold; }
input[type="submit"]:hover { background: #45a049; }
summary { font-weight: bold; color: #1a73e8; cursor: pointer; margin-top: 15px; margin-bottom: 10px; outline: none; }
</style></head><body>
<div class="container">
  <h2>Trai Nam - Cau Hinh</h2>
  <form action="/save" method="POST">
    <label>WiFi SSID</label><input type="text" name="ssid" value="%SSID%" required>
    <label>WiFi Password</label><input type="password" name="pass" value="%PASS%">
    
    <details>
      <summary>Cau hinh nang cao (Advanced Settings)</summary>
      <div style="padding-left: 10px; border-left: 2px solid #1a73e8; margin-top: 10px;">
        <label>Backend API URL</label><input type="text" name="backend_url" value="%BACKEND_URL%" required>
        <label>MQTT Broker IP</label><input type="text" name="mqtt_broker" value="%MQTT_BROKER%" required>
        <label>MQTT Port</label><input type="number" name="mqtt_port" value="%MQTT_PORT%" required>
        <label>MQTT Username</label><input type="text" name="mqtt_user" value="%MQTT_USER%">
        <label>MQTT Password</label><input type="password" name="mqtt_pass" value="%MQTT_PASS%">
      </div>
    </details>
    
    <input type="submit" value="Luu & Khoi dong lai" style="margin-top: 20px;">
  </form>
</div></body></html>
)rawliteral";

    static void handle_root()
    {
        String html = captive_html;
        html.replace("%SSID%", config::network::STA_SSID);
        html.replace("%PASS%", config::network::STA_PASS);
        html.replace("%BACKEND_URL%", config::network::BACKEND_API_URL);
        html.replace("%MQTT_BROKER%", config::network::MQTT_BROKER_VAL);
        html.replace("%MQTT_PORT%", String(config::network::MQTT_PORT_VAL));
        html.replace("%MQTT_USER%", config::network::MQTT_USER_VAL);
        html.replace("%MQTT_PASS%", config::network::MQTT_PASSWORD_VAL);
        webServer.send(200, "text/html", html);
    }

    static void handle_save()
    {
        String ssid = webServer.arg("ssid");
        String pass = webServer.arg("pass");
        String backend_url = webServer.arg("backend_url");
        String broker = webServer.arg("mqtt_broker");
        uint16_t port = webServer.arg("mqtt_port").toInt();
        String user = webServer.arg("mqtt_user");
        String mpass = webServer.arg("mqtt_pass");

        bool wifi_saved = storage::StorageManager::get_instance().save_wifi_credentials(ssid, pass);
        bool backend_saved = storage::StorageManager::get_instance().save_backend_config(backend_url);
        bool mqtt_saved = storage::StorageManager::get_instance().save_mqtt_config(broker, port, user, mpass);

        if (wifi_saved && backend_saved && mqtt_saved)
        {
            webServer.send(200, "text/html", "<h2>Da luu thanh cong! Thiet bi dang khoi dong lai...</h2>");
            delay(1000);
            ESP.restart();
        }
        else
        {
            webServer.send(500, "text/html", "<h2>Loi khi luu vao NVS Flash! Thu lai sau.</h2>");
        }
    }

    static void handle_not_found()
    {
        // Captive portal redirect:
        // Khi điện thoại gửi request tới bất kỳ domain nào (VD: google.com),
        // ta chuyển hướng (302) về trang cấu hình (IP của SoftAP).
        webServer.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true);
        webServer.send(302, "text/plain", "");
    }

    static void setup_web_server()
    {
        webServer.on("/", HTTP_GET, handle_root);
        webServer.on("/save", HTTP_POST, handle_save);

        // Dành cho iOS/Android Captive portal checks (thường gõ URL ảo)
        webServer.on("/generate_204", handle_root);        // Android captive portal
        webServer.on("/hotspot-detect.html", handle_root); // iOS captive portal

        webServer.onNotFound(handle_not_found);
    }
#endif

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
            set_state(WifiState::STA_CONNECTING);
        }
        else
        {
            Serial.println("[WIFI] No WiFi credentials found in NVS. Activating SoftAP Mode...");
            start_softap();
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

                // Fetch JWT before advertising STA_CONNECTED so MQTT never races with empty password
                if (fetch_auth_token())
                {
                    reconnect_attempts = 0; // Reset counter on success
                    set_state(WifiState::STA_CONNECTED);
                }
                else
                {
                    Serial.println("[WIFI] Auth token fetch failed. Transitioning to STA_DISCONNECTED for retry.");
                    config::network::AUTH_JWT_TOKEN = "";
                    set_state(WifiState::STA_DISCONNECTED);
                    last_reconnect_attempt = now;
                }
            }
            else if (now - connection_start_time >= WIFI_CONNECTION_TIMEOUT_MS)
            {
                Serial.println("[WIFI] WiFi connection timeout! Transitioning to STA_DISCONNECTED.");
                WiFi.disconnect();
                reconnect_attempts++;
                Serial.printf("[WIFI] Reconnection attempt %d of %d failed.\n", reconnect_attempts, MAX_RECONNECT_ATTEMPTS);

                if (reconnect_attempts >= MAX_RECONNECT_ATTEMPTS)
                {
                    Serial.println("[WIFI] Max reconnection attempts reached. Falling back to SoftAP mode...");
                    start_softap();
                }
                else
                {
                    set_state(WifiState::STA_DISCONNECTED);
                    last_reconnect_attempt = now;
                }
            }
            break;
        }
        case WifiState::STA_CONNECTED:
        {
            if (WiFi.status() != WL_CONNECTED)
            {
                Serial.println("[WIFI] WiFi connection lost! Transitioning to STA_DISCONNECTED.");
                // Clear JWT so it is re-fetched after reconnection
                config::network::AUTH_JWT_TOKEN = "";
                set_state(WifiState::STA_DISCONNECTED);
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
        {
#ifndef UNIT_TEST
            dnsServer.processNextRequest();
            webServer.handleClient();
            vTaskDelay(10 / portTICK_PERIOD_MS); // Yield CPU to avoid TWDT
#endif
            if (now - softap_start_time >= SOFTAP_TIMEOUT_MS)
            {
                Serial.println("[WIFI] SoftAP timeout reached (15 minutes). Shutting down SoftAP and reverting to STA_DISCONNECTED.");
#ifndef UNIT_TEST
                dnsServer.stop();
                webServer.close();
#endif
                WiFi.mode(WIFI_STA);
                reconnect_attempts = 0; // Reset attempts to try connecting again
                set_state(WifiState::STA_DISCONNECTED);
                last_reconnect_attempt = now;
            }
            break;
        }
        case WifiState::IDLE:
        default:
            break;
        }
    }

    void reconnect_wifi()
    {
        if (config::network::STA_SSID.length() == 0)
        {
            Serial.println("[WIFI] Abort reconnect: No SSID config available.");
            return;
        }
        Serial.printf("[WIFI] Reconnecting to SSID: %s...\n", config::network::STA_SSID.c_str());
        // Gọi WiFi.begin để tái kết nối
        WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
        connection_start_time = millis();
        set_state(WifiState::STA_CONNECTING);
    }

    WifiState get_wifi_state()
    {
        return current_state;
    }

} // namespace wifi
