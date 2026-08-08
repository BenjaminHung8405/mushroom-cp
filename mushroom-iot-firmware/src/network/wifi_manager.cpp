#include "network/wifi_manager.h"
#include "network/web_interface/web_interface.h"
#include "config.h"
#include "core/storage.h"
#include "core/system_manager.h"
#include "core/time_confidence.h"
#include "network/ota_manager.h"
#include "core/config_manager.h"
#include "network/web_interface/index_html.h"
#include <ArduinoJson.h>
#include <time.h>

#ifndef UNIT_TEST
#include <esp_sntp.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_task_wdt.h>
#endif

namespace wifi
{
    // Biến lưu trữ trạng thái WiFi nội bộ

#ifndef UNIT_TEST
    static DNSServer dnsServer;
    static WebServer webServer(80);
    static bool captive_server_running = false;
    static bool captive_routes_registered = false;
    static void setup_web_server();
    static void start_captive_portal_server();
    static void stop_captive_portal_server();
#endif
    static bool start_softap(bool allow_sta_reconnect = false);

    static WifiState current_state = WifiState::IDLE;
    static unsigned long connection_start_time = 0;
    static unsigned long last_reconnect_attempt = 0;
    static int reconnect_attempts = 0;
    static unsigned long softap_start_time = 0;
    static unsigned long softap_last_activity_ms = 0;
    // Once the user forces the captive portal, never auto-return to STA
    // until the portal idle-timeout expires or config is saved/rebooted.
    static bool softap_forced = false;
    // True only when SoftAP is a fallback from configured STA credentials.
    // It allows periodic STA reconnect attempts while the provisioning portal stays up.
    static bool softap_auto_reconnect = false;
    static unsigned long last_softap_sta_attempt = 0;
    // Set only after the portal response is sent; processed outside HTTP callbacks.
    static bool restart_pending = false;
    static unsigned long restart_at_ms = 0;
#ifndef UNIT_TEST
    static void on_sntp_sync(struct timeval *timeval)
    {
        if (timeval != nullptr && sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) {
            time_conf::onTimeSyncSuccess(static_cast<int64_t>(timeval->tv_sec));

            struct tm localTime {};
            const time_t epoch = static_cast<time_t>(timeval->tv_sec);
            if (localtime_r(&epoch, &localTime) != nullptr) {
                char formattedTime[32] = {};
                strftime(formattedTime, sizeof(formattedTime), "%Y-%m-%d %H:%M:%S", &localTime);
                Serial.printf(
                    "[WIFI] SNTP sync: epoch=%lld local=%s TZ=%s\n",
                    static_cast<long long>(timeval->tv_sec),
                    formattedTime,
                    config::network::TIMEZONE_ICT);
            } else {
                Serial.printf(
                    "[WIFI] SNTP sync: epoch=%lld local-time conversion failed TZ=%s\n",
                    static_cast<long long>(timeval->tv_sec),
                    config::network::TIMEZONE_ICT);
            }
        }
    }
#endif

    // Các hằng số cấu hình thời gian (ms)
    constexpr unsigned long WIFI_CONNECTION_TIMEOUT_MS = 15000; // 15 giây
    constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000; // 10 giây
    constexpr int MAX_RECONNECT_ATTEMPTS = 3;
    // Idle timeout for SoftAP. Reset whenever user opens / interacts with portal.
    constexpr unsigned long SOFTAP_IDLE_TIMEOUT_MS = 900000; // 15 phút idle

    static void mark_softap_activity()
    {
        softap_last_activity_ms = millis();
    }

#ifndef UNIT_TEST
    static bool has_softap_clients()
    {
        return WiFi.softAPgetStationNum() > 0;
    }

    // Note: check_config_button removed; handled by Core 1 Task HWButton and EventGroup.
#else
    static bool has_softap_clients()
    {
        return false;
    }

#endif

    static void set_state(WifiState new_state)
    {
        current_state = new_state;

        if (new_state == WifiState::SOFTAP_ACTIVE)
        {
            softap_start_time = millis();
            softap_last_activity_ms = softap_start_time;
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

    static bool start_softap(bool allow_sta_reconnect)
    {
        Serial.println("[WIFI] Activating SoftAP Mode...");

#ifndef UNIT_TEST
        // The dashboard owns port 80 while STA is connected. Stop it before the
        // captive portal binds the same port, then let lwIP release old sockets.
        if (web_interface::isServerRunning())
        {
            web_interface::stopServer();
            vTaskDelay(pdMS_TO_TICKS(50));
        }
#endif

        // Stop any previous STA attempt so the radio is fully dedicated to AP.
        // WIFI_AP_STA + background STA reconnect is a common cause of phones
        // dropping the captive-portal association while the user is typing.
        //
        // Important for ESP32 Arduino:
        // - Do NOT call WiFi.mode(WIFI_AP) then softAPConfig()/softAP().
        //   mode(WIFI_AP) already starts the AP with defaults; reconfig restarts it.
        // - softAPConfig() is unnecessary for the classic 192.168.4.1 defaults and
        //   itself calls enableAP(), which can bounce AP_START/AP_STOP and leave
        //   residual STA events. One softAP() call is enough.
        WiFi.persistent(false);
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(true /* wifioff */, false /* keep SDK creds; app uses NVS */);
        delay(50);
        WiFi.mode(WIFI_OFF);
        delay(150);

        String ap_ssid = config::network::get_dynamic_ap_ssid();
        bool ap_started = WiFi.softAP(
            ap_ssid.c_str(),
            config::network::AP_PASS,
            1,
            0,
            4);

        // Belt-and-suspenders: ensure STA interface cannot come back while portal is up.
        WiFi.enableSTA(false);
        WiFi.setSleep(false);
        WiFi.setAutoReconnect(false);

        if (ap_started)
        {
            softap_forced = !allow_sta_reconnect;
            softap_auto_reconnect = allow_sta_reconnect;
            last_softap_sta_attempt = millis();
            Serial.printf("[WIFI] SoftAP Activated: %s\n", ap_ssid.c_str());
            Serial.printf("[WIFI] SoftAP IP: %s\n", WiFi.softAPIP().toString().c_str());
            Serial.printf("[WIFI] SoftAP IP: %s\n", WiFi.softAPIP().toString().c_str());
            Serial.printf("[WIFI] SoftAP mode bits: 0x%X (expect WIFI_AP=0x%X)\n",
                          static_cast<unsigned>(WiFi.getMode()),
                          static_cast<unsigned>(WIFI_AP));
            set_state(WifiState::SOFTAP_ACTIVE);

#ifndef UNIT_TEST
            start_captive_portal_server();
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

#ifndef UNIT_TEST
    // ---------------------------------------------------------------------------
    // Captive portal UI
    // ---------------------------------------------------------------------------
    // Known UX/failure modes fixed here:
    // 1) Fields inside <details> still have HTML5 "required" → mobile browsers
    //    block submit silently when Advanced is collapsed.
    // 2) Classic form POST + captive mini-browser often loses the response or
    //    gets 302'd by DNS spoofing → "press Save and nothing happens".
    // 3) Save was all-or-nothing (WiFi + backend + MQTT). Empty/invalid advanced
    //    values could fail NVS write even when WiFi creds were fine.
    // 4) ESP.restart() too early can cut the HTTP response before the phone
    //    finishes reading it.
    // ---------------------------------------------------------------------------
    static const char *captive_html = PORTAL_HTML;

    static void send_json(int code, const String &json)
    {
        webServer.sendHeader("Cache-Control", "no-store");
        webServer.sendHeader("Access-Control-Allow-Origin", "*");
        webServer.sendHeader("Connection", "close");
        webServer.send(code, "application/json; charset=utf-8", json);
    }

    static String json_escape(const String &in)
    {
        String out;
        out.reserve(in.length() + 8);
        for (size_t i = 0; i < in.length(); ++i)
        {
            char c = in[i];
            if (c == '"' || c == '\\')
            {
                out += '\\';
                out += c;
            }
            else if (c == '\n')
            {
                out += "\\n";
            }
            else if (static_cast<unsigned char>(c) < 0x20)
            {
                // drop control chars
            }
            else
            {
                out += c;
            }
        }
        return out;
    }

    static void handle_config()
    {
        mark_softap_activity();
        storage::ConfigManager &cfg = storage::ConfigManager::getInstance();
        String resp = "{";
        resp += "\"ssid\":\"" + json_escape(cfg.getWifiSSID()) + "\",";
        resp += "\"pass_len\":" + String(cfg.getWifiPass().length()) + ",";
        resp += "\"wifi_state\":" + String((int)current_state) + ",";
        resp += "\"ap_clients\":" + String(WiFi.softAPgetStationNum());
        resp += "}";
            static void handle_root()
    {
        mark_softap_activity();
        storage::ConfigManager &cfg = storage::ConfigManager::getInstance();
        String html = captive_html;
        html.replace("%SSID%", cfg.getWifiSSID());
        html.replace("%PASS%", cfg.getWifiPass());
        html.replace("%MQTT_BROKER%", cfg.getMqttBroker());
        html.replace("%MQTT_PORT%", String(cfg.getMqttPort()));
        html.replace("%MQTT_USER%", cfg.getMqttUser());
        html.replace("%MQTT_PASS%", cfg.getMqttPass());
        html.replace("%BACKEND_URL%", "");
        html.replace("%AP_SSID%", config::network::get_dynamic_ap_ssid());
        webServer.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        webServer.sendHeader("Pragma", "no-cache");
        webServer.sendHeader("Connection", "close");
        webServer.send(200, "text/html; charset=utf-8", html);
    }

    static void handle_known_networks()
    {
        mark_softap_activity();
        std::vector<storage::KnownWifiNetwork> list;
        storage::StorageManager::get_instance().load_known_wifi_list(list);

        String json = "[";
        for (size_t i = 0; i < list.size(); ++i)
        {
            if (i > 0) json += ",";
            json += "{\"ssid\":\"" + json_escape(list[i].ssid) + "\",\"ts\":" + String(list[i].last_connected) + "}";
        }
        json += "]";
        send_json(200, json);
    }

    static void handle_forget_network()
    {
        mark_softap_activity();
        String ssid = webServer.arg("ssid");
        ssid.trim();
        if (ssid.length() == 0)
        {
            send_json(400, "{\"ok\":false,\"error\":\"SSID khong hop le\"}");
            return;
        }

        bool ok = storage::StorageManager::get_instance().remove_known_wifi(ssid);
        if (ok)
        {
            send_json(200, "{\"ok\":true}");
        }
        else
        {
            send_json(404, "{\"ok\":false,\"error\":\"Khong tim thay SSID trong danh sach\"}");
        }
    }

    static void handle_keep_alive()
    {
        mark_softap_activity();
        webServer.sendHeader("Cache-Control", "no-store");
        webServer.sendHeader("Connection", "close");
        webServer.send(204, "text/plain", "");
    }

    static void handle_scan()
    {
        mark_softap_activity();
        Serial.println("[WIFI] SoftAP portal requested WiFi scan...");

        // WIFI_AP_STA is required on ESP32 to scan while SoftAP stays up.
        // Keep SoftAP alive so the phone does not drop mid-scan.
        wifi_mode_t mode = WiFi.getMode();
        if (mode != WIFI_AP_STA)
        {
            WiFi.mode(WIFI_AP_STA);
        }

        int n = WiFi.scanNetworks(/*async=*/false, /*hidden=*/false);
        String json = "[";
        int added = 0;
        for (int i = 0; i < n; ++i)
        {
            String ssid = WiFi.SSID(i);
            if (ssid.length() == 0)
            {
                continue; // skip hidden
            }
            if (added > 0)
            {
                json += ',';
            }
            bool secure = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
            json += "{\"ssid\":\"";
            json += json_escape(ssid);
            json += "\",\"rssi\":";
            json += String(WiFi.RSSI(i));
            json += ",\"secure\":";
            json += secure ? "true" : "false";
            json += '}';
            ++added;
            if (added >= 20)
            {
                break; // keep payload small for captive browsers
            }
        }
        json += ']';
        WiFi.scanDelete();

        // Return to pure AP mode for stable captive portal.
        WiFi.mode(WIFI_AP);
        WiFi.setSleep(false);

        Serial.printf("[WIFI] Scan complete: %d network(s) returned.\n", added);
        send_json(200, json);
    }

    static void handle_save()
    {
        mark_softap_activity();

        // Always respond to OPTIONS for stubborn captive browsers.
        if (webServer.method() == HTTP_OPTIONS)
        {
            webServer.sendHeader("Access-Control-Allow-Origin", "*");
            webServer.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            webServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
            webServer.send(204);
            return;
        }

        String ssid = webServer.arg("ssid");
        ssid.trim();
        String pass = webServer.arg("pass");
        String broker = webServer.arg("mqtt_broker");
        broker.trim();
        String port_raw = webServer.arg("mqtt_port");
        port_raw.trim();
        String mpass = webServer.arg("mqtt_pass");

        Serial.printf("[WIFI] Portal save request: ssid='%s' pass_len=%u broker='%s' port='%s'\n",
                      ssid.c_str(),
                      static_cast<unsigned>(pass.length()),
                      broker.c_str(),
                      port_raw.c_str());

        if (ssid.length() == 0)
        {
            send_json(400, "{\"ok\":false,\"error\":\"SSID khong duoc de trong\"}");
            return;
        }
        if (ssid.length() > 32)
        {
            send_json(400, "{\"ok\":false,\"error\":\"SSID qua dai (toi da 32 ky tu)\"}");
            return;
        }
        if (pass.length() > 0 && pass.length() < 8)
        {
            // WPA2 PSK minimum; allow empty for open networks.
            send_json(400, "{\"ok\":false,\"error\":\"WiFi password toi thieu 8 ky tu (hoac de trong neu mang mo)\"}");
            return;
        }

        if (broker.length() == 0)
        {
            broker = config::network::MQTT_BROKER_VAL.length()
                         ? config::network::MQTT_BROKER_VAL
                         : String(config::network::DEFAULT_MQTT_BROKER);
        }
        long parsed_port = port_raw.length() ? port_raw.toInt() : config::network::MQTT_PORT_VAL;
        if (parsed_port < 1 || parsed_port > 65535)
        {
            parsed_port = config::network::DEFAULT_MQTT_PORT;
        }
        uint16_t port = static_cast<uint16_t>(parsed_port);
        if (mpass.length() == 0)
        {
            mpass = config::network::MQTT_PASSWORD_VAL.length()
                        ? config::network::MQTT_PASSWORD_VAL
                        : String(config::network::DEFAULT_MQTT_PASS);
        }

        // Live Proof-of-Connectivity Test in WIFI_AP_STA mode
        WiFi.mode(WIFI_AP_STA);
        WiFi.begin(ssid.c_str(), pass.c_str());

        bool connected = false;
        unsigned long start_test = millis();
        while (millis() - start_test < 8000)
        {
            if (WiFi.status() == WL_CONNECTED)
            {
                connected = true;
                break;
            }
            delay(100);
            dnsServer.processNextRequest();
            webServer.handleClient();
        }

        if (!connected)
        {
            Serial.printf("[WIFI] Live verification failed for SSID='%s'. Keeping SoftAP alive.\n", ssid.c_str());
            WiFi.disconnect(false, false);
            WiFi.mode(WIFI_AP);
            send_json(400, "{\"ok\":false,\"error\":\"Khong the ket noi toi WiFi! Kiem tra lai mat khau hoac khoang cach toi Router.\"}");
            return;
        }

        String assigned_ip = WiFi.localIP().toString();
        Serial.printf("[WIFI] Live verification SUCCESS for SSID='%s'. IP: %s\n", ssid.c_str(), assigned_ip.c_str());

        // Add network to Known Networks list in NVS (max 5 LRU)
        storage::StorageManager::get_instance().add_or_update_known_wifi(ssid, pass);

        if (!storage::ConfigManager::getInstance().saveNetworkConfig(ssid, pass, broker, port, mpass))
        {
            send_json(500, "{\"ok\":false,\"error\":\"Loi luu cau hinh vao NVS\"}");
            return;
        }

        String ok_json = String("{\"ok\":true,\"ssid\":\"") + json_escape(ssid) +
                         "\",\"ip\":\"" + assigned_ip + "\",\"reboot\":true}";
        send_json(200, ok_json);

        restart_at_ms = millis() + 1500;
        restart_pending = true;
        Serial.printf("[WIFI] Config verified & saved from portal. New SSID='%s'. Restart scheduled.\n", ssid.c_str());
    }

    static void handle_not_found()
    {
        const bool captive_active = current_state == WifiState::SOFTAP_ACTIVE &&
                                     (WiFi.getMode() & WIFI_AP) != 0;

        // Requests outside the active captive portal must not redirect to a
        // missing SoftAP address such as 0.0.0.0.
        if (!captive_active || webServer.method() == HTTP_POST || webServer.method() == HTTP_PUT)
        {
            send_json(404, "{\"ok\":false,\"error\":\"Endpoint khong ton tai\"}");
            return;
        }

        mark_softap_activity();
        webServer.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
        webServer.sendHeader("Cache-Control", "no-store");
        webServer.sendHeader("Connection", "close");
        webServer.send(302, "text/plain", "");
    }

    static void setup_web_server()
    {
        webServer.on("/", HTTP_GET, handle_root);
        webServer.on("/save", HTTP_POST, handle_save);
        webServer.on("/save", HTTP_OPTIONS, handle_save);
        webServer.on("/scan", HTTP_GET, handle_scan);
        webServer.on("/keep-alive", HTTP_GET, handle_keep_alive);
        webServer.on("/config", HTTP_GET, handle_config);
        webServer.on("/known-networks", HTTP_GET, handle_known_networks);
        webServer.on("/forget-network", HTTP_POST, handle_forget_network);

        // Captive portal probes — serve config page so OS keeps association open.
        webServer.on("/generate_204", HTTP_GET, handle_root);              // Android
        webServer.on("/gen_204", HTTP_GET, handle_root);                   // Android alt
        webServer.on("/hotspot-detect.html", HTTP_GET, handle_root);       // iOS/macOS
        webServer.on("/library/test/success.html", HTTP_GET, handle_root); // iOS
        webServer.on("/ncsi.txt", HTTP_GET, handle_root);                  // Windows
        webServer.on("/connecttest.txt", HTTP_GET, handle_root);           // Windows
        webServer.on("/canonical.html", HTTP_GET, handle_root);            // Firefox
        webServer.on("/success.txt", HTTP_GET, handle_root);               // Firefox
        webServer.on("/fwlink/", HTTP_GET, handle_root);                   // Windows
        webServer.on("/fwlink", HTTP_GET, handle_root);

        webServer.onNotFound(handle_not_found);
    }

    static void start_captive_portal_server()
    {
        if (captive_server_running)
        {
            return;
        }

        dnsServer.stop();
        dnsServer.start(53, "*", WiFi.softAPIP());
        if (!captive_routes_registered)
        {
            setup_web_server();
            captive_routes_registered = true;
        }
        webServer.begin();
        captive_server_running = true;
        Serial.println("[WIFI] Captive portal server started on port 80.");
    }

    static void stop_captive_portal_server()
    {
        dnsServer.stop();
        if (!captive_server_running)
        {
        webServer.stop();
        captive_server_running = false;
        Serial.println("[WIFI] Captive portal server stopped.");
    }

    unsigned long get_reconnect_backoff_interval_ms(int attempt)
    {
        if (attempt <= 3)
        {
            return 10000;  // 10s (Attempts 1-3)
        }
        else if (attempt <= 6)
        {
            return 30000;  // 30s (Attempts 4-6)
        }
        else if (attempt <= 10)
        {
            return 60000;  // 60s (Attempts 7-10)
        }
        else
        {
            return 300000; // 300s / 5 mins (Attempts > 10)
        }
    }

    // Các hằng số cấu hình thời gian (ms)
    constexpr unsigned long WIFI_CONNECTION_TIMEOUT_MS = 15000;        // 15 giây
    constexpr unsigned long SOFTAP_IDLE_TIMEOUT_MS = 600000;          // 10 phút idle tự tắt AP
    constexpr unsigned long STA_DISCONNECTED_MAX_DURATION_MS = 900000; // 15 phút rớt mạng tự mở AP dự phòng

    static void mark_softap_activity()
    {
        softap_last_activity_ms = millis();
    }

#ifndef UNIT_TEST
    static bool has_softap_clients()
    {
        return WiFi.softAPgetStationNum() > 0;
    }
#else
    static bool has_softap_clients()
    {
        return false;
    }
#endif

    static void set_state(WifiState new_state)
    {
        current_state = new_state;

        if (new_state == WifiState::SOFTAP_ACTIVE || new_state == WifiState::AP_PROVISIONING)
        {
            softap_start_time = millis();
            softap_last_activity_ms = softap_start_time;
        }

        // Synchronize Event Bits to Core 1
        if (xWifiEventGroup != nullptr)
        {
            if (new_state == WifiState::STA_CONNECTED)
            {
                xEventGroupSetBits(xWifiEventGroup, WIFI_CONNECTED_BIT);
                xEventGroupClearBits(xWifiEventGroup, WIFI_SOFTAP_BIT);
            }
            else if (new_state == WifiState::SOFTAP_ACTIVE || new_state == WifiState::AP_PROVISIONING)
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

    static bool start_softap(bool allow_sta_reconnect)
    {
        Serial.println("[WIFI] Activating SoftAP Mode...");

#ifndef UNIT_TEST
        if (web_interface::isServerRunning())
        {
            web_interface::stopServer();
            vTaskDelay(pdMS_TO_TICKS(50));
        }
#endif

        WiFi.persistent(false);
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(true, false);
        delay(50);
        WiFi.mode(WIFI_OFF);
        delay(150);

        String ap_ssid = config::network::get_dynamic_ap_ssid();
        bool ap_started = WiFi.softAP(
            ap_ssid.c_str(),
            config::network::AP_PASS,
            1,
            0,
            4);

        WiFi.enableSTA(false);
        WiFi.setSleep(false);
        WiFi.setAutoReconnect(false);

        if (ap_started)
        {
            softap_forced = !allow_sta_reconnect;
            softap_auto_reconnect = allow_sta_reconnect;
            last_softap_sta_attempt = millis();
            Serial.printf("[WIFI] SoftAP Activated: %s\n", ap_ssid.c_str());
            Serial.printf("[WIFI] SoftAP IP: %s\n", WiFi.softAPIP().toString().c_str());
            set_state(allow_sta_reconnect ? WifiState::SOFTAP_ACTIVE : WifiState::AP_PROVISIONING);

#ifndef UNIT_TEST
            start_captive_portal_server();
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

#endif

    WifiState init_wifi()
    {
        Serial.println("[WIFI] Initializing WiFi Manager...");

        // Initialize OTA Mutex before starting network activities
        ota::init();

#ifndef UNIT_TEST
        // Disable SDK Auto-Reconnect so State Machine has 100% control over Backoff timing
        WiFi.setAutoReconnect(false);
#endif

        // Đọc cấu hình WiFi STA từ NVS thông qua cấu hình hệ thống
        config::network::load_runtime_config();

        std::vector<storage::KnownWifiNetwork> known_list;
        storage::StorageManager::get_instance().load_known_wifi_list(known_list);

        if (!known_list.empty())
        {
            // Credentialed devices boot STA-only. Captive portal is a fallback,
            // never a parallel listener on port 80.
            softap_forced = false;
            softap_auto_reconnect = false;
            WiFi.persistent(false);
            WiFi.disconnect(false, false);
            WiFi.mode(WIFI_STA);
            WiFi.setAutoReconnect(false);

            // Select primary network (first in known list)
            config::network::STA_SSID = known_list[0].ssid;
            config::network::STA_PASS = known_list[0].pass;

            Serial.printf("[WIFI] Booting STA mode. Connecting to primary saved WiFi '%s' (%u saved networks total)...\n",
                          config::network::STA_SSID.c_str(), static_cast<unsigned>(known_list.size()));
            WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
            connection_start_time = millis();
            set_state(WifiState::STA_CONNECTING);
        }
        else
        {
            Serial.println("[WIFI] No WiFi credentials configured. Activating Captive Portal...");
            start_softap(false);
        }

        return current_state;
    }

    static unsigned long sta_disconnected_start_time = 0;

    void check_wifi_connection()
    {
        unsigned long now = millis();

#ifndef UNIT_TEST
        // This executes outside WebServer callbacks, preventing callback-induced WDT resets.
        if (restart_pending && static_cast<long>(now - restart_at_ms) >= 0)
        {
            restart_pending = false;
            Serial.println("[WIFI] Portal response grace period elapsed. Restarting to apply WiFi configuration...");
            WiFi.persistent(false);
            WiFi.disconnect(true, true);
            ESP.restart();
        }
#endif

        // Power-Up Boot Guard: Ignore GPIO0 BOOT button trigger during first 5 seconds of uptime
        if (xWifiEventGroup != nullptr)
        {
            EventBits_t bits = xEventGroupGetBits(xWifiEventGroup);

            if (bits & WIFI_FACTORY_RESET_BIT)
            {
                Serial.println("[WIFI] Handling WIFI_FACTORY_RESET_BIT...");
                storage::StorageManager::get_instance().factory_reset();
                xEventGroupClearBits(xWifiEventGroup, WIFI_FACTORY_RESET_BIT);
                delay(100);
#ifndef UNIT_TEST
                ESP.restart();
#endif
            }
            else if ((bits & WIFI_FORCE_PROVISION_BIT) && (now > 5000))
            {
                Serial.println("[WIFI] Handling WIFI_FORCE_PROVISION_BIT (millis > 5000) -> Forcing SoftAP AP_PROVISIONING...");
                storage::StorageManager &storage_manager = storage::StorageManager::get_instance();
                if (!storage_manager.clear_wifi_credentials())
                {
                    Serial.println("[WIFI] WiFi credentials were already absent or could not be cleared.");
                }
                storage::ConfigManager::getInstance().init();
                reconnect_attempts = 0;
                xEventGroupClearBits(xWifiEventGroup, WIFI_FORCE_PROVISION_BIT);

                start_softap(false);
                return; // SoftAP started, exit check early
            }
        }

        switch (current_state)
        {
        case WifiState::STA_CONNECTING:
        {
            if (WiFi.status() == WL_CONNECTED)
            {
                Serial.printf("[WIFI] WiFi Connected successfully! IP: %s\n", WiFi.localIP().toString().c_str());
#ifndef UNIT_TEST
                sntp_set_time_sync_notification_cb(on_sntp_sync);
                configTzTime(config::network::TIMEZONE_ICT, "pool.ntp.org", "time.nist.gov");
#endif
                reconnect_attempts = 0;
                set_state(WifiState::STA_CONNECTED);

                // Wi-Fi association is not time synchronization. The state stays
                // fail-safe until SNTP reports a completed synchronization.
#ifndef UNIT_TEST
                if (sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) {
                    time_conf::onTimeSyncSuccess(time(nullptr));
                }
#endif
            }
            else if (now - connection_start_time >= WIFI_CONNECTION_TIMEOUT_MS)
            {
                Serial.println("[WIFI] WiFi connection timeout! Transitioning to STA_RECONNECTING.");
                WiFi.disconnect();
                reconnect_attempts++;

                set_state(WifiState::STA_RECONNECTING);
                last_reconnect_attempt = now;
                if (sta_disconnected_start_time == 0)
                {
                    sta_disconnected_start_time = now;
                }
            }
            break;
        }
        case WifiState::STA_CONNECTED:
        {
            if (WiFi.status() != WL_CONNECTED)
            {
                Serial.println("[WIFI] WiFi connection lost! Transitioning to STA_RECONNECTING (Safe Offline mode active).");
                set_state(WifiState::STA_RECONNECTING);
                last_reconnect_attempt = now;
                sta_disconnected_start_time = now;

                // B2: Connection loss while same boot -> Holdover
                time_conf::onConnectionLoss();
            }
            break;
        }
        case WifiState::STA_DISCONNECTED:
        case WifiState::STA_RECONNECTING:
        {
            unsigned long backoff_ms = get_reconnect_backoff_interval_ms(reconnect_attempts + 1);

            // Fallback to AP if disconnected for > 15 minutes continuously
            if (sta_disconnected_start_time > 0 && (now - sta_disconnected_start_time >= STA_DISCONNECTED_MAX_DURATION_MS))
            {
                Serial.println("[WIFI] Continuous disconnection exceeded 15 minutes. Opening fallback Captive AP...");
                start_softap(true);
                break;
            }

            if (now - last_reconnect_attempt >= backoff_ms)
            {
                Serial.printf("[WIFI] Backoff interval (%lu s) reached (Attempt %d). Retrying connection...\n",
                              backoff_ms / 1000, reconnect_attempts + 1);
                reconnect_wifi();
            }
            break;
        }
        case WifiState::SOFTAP_ACTIVE:
        case WifiState::AP_PROVISIONING:
        {
#ifndef UNIT_TEST
            // Drain multiple packets per tick while captive portal is the sole
            // port-80 owner in SoftAP mode.
            for (int i = 0; i < 4; ++i)
            {
                dnsServer.processNextRequest();
                webServer.handleClient();
            }
#endif

            if (has_softap_clients())
            {
                mark_softap_activity();
            }

            // Lock Channel Hopping: DO NOT run periodic WiFi.begin() while portal is active.
            // Active Session Guard: Auto-shutdown AP only if idle without clients for 10 minutes (600,000 ms).
            if (now - softap_last_activity_ms >= SOFTAP_IDLE_TIMEOUT_MS)
            {
                Serial.println("[WIFI] SoftAP active session idle timeout (10 mins). Reverting to STA_RECONNECTING.");
#ifndef UNIT_TEST
                stop_captive_portal_server();
#endif
                softap_forced = false;
                softap_auto_reconnect = false;
                WiFi.softAPdisconnect(true);
                WiFi.mode(WIFI_STA);
                reconnect_attempts = 0;
                set_state(WifiState::STA_RECONNECTING);
                last_reconnect_attempt = now;
                sta_disconnected_start_time = now;
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
        if (softap_forced || current_state == WifiState::SOFTAP_ACTIVE || current_state == WifiState::AP_PROVISIONING)
        {
            Serial.println("[WIFI] Abort reconnect: SoftAP provisioning portal is active.");
            return;
        }

        std::vector<storage::KnownWifiNetwork> known_list;
        storage::StorageManager::get_instance().load_known_wifi_list(known_list);

        if (known_list.empty())
        {
            Serial.println("[WIFI] Abort reconnect: No saved WiFi credentials available.");
            return;
        }

        size_t idx = reconnect_attempts % known_list.size();
        config::network::STA_SSID = known_list[idx].ssid;
        config::network::STA_PASS = known_list[idx].pass;

        Serial.printf("[WIFI] Reconnecting to network %u/%u (SSID: %s, Attempt %d)...\n",
                      static_cast<unsigned>(idx + 1),
                      static_cast<unsigned>(known_list.size()),
                      config::network::STA_SSID.c_str(),
                      reconnect_attempts + 1);

        WiFi.setAutoReconnect(false);
        WiFi.disconnect(false, false);
        delay(100);
        WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
        connection_start_time = millis();
        set_state(WifiState::STA_CONNECTING);
    }

    WifiState get_wifi_state()
    {
        return current_state;
    }

} // namespace wifi
