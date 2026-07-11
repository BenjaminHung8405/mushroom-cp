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
    static bool start_softap();

    static WifiState current_state = WifiState::IDLE;
    static unsigned long connection_start_time = 0;
    static unsigned long last_reconnect_attempt = 0;
    static unsigned long last_auth_attempt = 0;
    static int reconnect_attempts = 0;
    static unsigned long softap_start_time = 0;
    static unsigned long softap_last_activity_ms = 0;
    // Once the user forces the captive portal, never auto-return to STA
    // until the portal idle-timeout expires or config is saved/rebooted.
    static bool softap_forced = false;

    // Các hằng số cấu hình thời gian (ms)
    constexpr unsigned long WIFI_CONNECTION_TIMEOUT_MS = 15000; // 15 giây
    constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000; // 10 giây
    constexpr unsigned long AUTH_RETRY_INTERVAL_MS = 30000;     // 30 giây, retry backend token without dropping WiFi
    constexpr unsigned long AUTH_HTTP_TIMEOUT_MS = 10000;       // 10 giây
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

    static bool start_softap()
    {
        Serial.println("[WIFI] Activating SoftAP Mode...");

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

        // channel=1, hidden=false, max_connection=4, ftm_responder=false
        // softAP() enables AP mode internally via enableAP(true).
        bool ap_started = WiFi.softAP(
            config::network::AP_SSID,
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
            softap_forced = true;
            Serial.printf("[WIFI] SoftAP Activated: %s\n", config::network::AP_SSID);
            Serial.printf("[WIFI] SoftAP IP: %s\n", WiFi.softAPIP().toString().c_str());
            Serial.printf("[WIFI] SoftAP mode bits: 0x%X (expect WIFI_AP=0x%X)\n",
                          static_cast<unsigned>(WiFi.getMode()),
                          static_cast<unsigned>(WIFI_AP));
            set_state(WifiState::SOFTAP_ACTIVE);

#ifndef UNIT_TEST
            // Khởi động DNS Server để chuyển hướng mọi domain về IP SoftAP
            dnsServer.stop();
            dnsServer.start(53, "*", WiFi.softAPIP());

            // Khởi động WebServer
            webServer.stop();
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
        http.setTimeout(AUTH_HTTP_TIMEOUT_MS);

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
    static const char *captive_html = R"rawliteral(
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="format-detection" content="telephone=no">
<title>TraiNam Cau Hinh WiFi</title>
<style>
:root { --ok:#1e8e3e; --err:#d93025; --pri:#1a73e8; --bg:#f0f2f5; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; margin: 0; background: var(--bg); color: #202124; }
.wrap { max-width: 440px; margin: 0 auto; padding: 16px; }
.card { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
h1 { font-size: 20px; margin: 0 0 6px; text-align: center; }
.sub { font-size: 13px; color: #5f6368; text-align: center; margin: 0 0 16px; line-height: 1.4; }
label { display:block; font-size: 13px; font-weight: 600; color: #3c4043; margin: 12px 0 6px; }
input[type=text], input[type=password], input[type=number], select {
  width: 100%; font-size: 16px; padding: 12px; border: 1px solid #dadce0; border-radius: 8px; background: #fff;
}
input:focus, select:focus { outline: 2px solid #aecbfa; border-color: var(--pri); }
.row { display:flex; gap:8px; align-items:stretch; }
.row > :first-child { flex:1; min-width:0; }
.btn {
  font-size: 14px; font-weight: 600; border-radius: 8px; border: 1px solid #dadce0; background:#fff; color:#3c4043;
  padding: 0 12px; min-height: 46px; cursor: pointer; white-space: nowrap;
}
.btn-pri { background: var(--ok); color:#fff; border-color: var(--ok); width:100%; font-size:16px; margin-top:16px; }
.btn-pri:disabled { opacity: .65; cursor: wait; }
.btn-sec { background:#e8f0fe; color:var(--pri); border-color:#aecbfa; width:100%; margin-top:8px; }
.btn-toggle { min-width: 72px; color:var(--pri); border-color:#aecbfa; background:#e8f0fe; }
details { margin-top: 14px; border-top: 1px solid #eee; padding-top: 10px; }
summary { color: var(--pri); font-weight: 600; cursor: pointer; outline:none; }
.msg { display:none; margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 14px; line-height: 1.4; }
.msg.show { display:block; }
.msg.ok { background:#e6f4ea; color:#137333; border:1px solid #ceead6; }
.msg.err { background:#fce8e6; color:#a50e0e; border:1px solid #f5c6c2; }
.msg.info { background:#e8f0fe; color:#174ea6; border:1px solid #d2e3fc; }
.scan-box { margin-top:8px; max-height:160px; overflow:auto; border:1px solid #e0e0e0; border-radius:8px; display:none; }
.scan-item { display:block; width:100%; text-align:left; padding:10px 12px; border:0; border-bottom:1px solid #f1f3f4; background:#fff; font-size:14px; cursor:pointer; }
.scan-item:last-child { border-bottom:0; }
.scan-item:active { background:#e8f0fe; }
.meta { font-size:11px; color:#80868b; margin-top:14px; text-align:center; line-height:1.4; }
.spinner { display:inline-block; width:14px; height:14px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; vertical-align:-2px; margin-right:6px; animation:spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Trai Nam - Cau hinh WiFi</h1>
  <p class="sub">Buoc 1: chon/nhap WiFi nha ban.<br>Buoc 2: bam Luu. May se tu ket noi lai.</p>

  <div id="banner" class="msg"></div>

  <form id="cfgForm" autocomplete="off" onsubmit="return false;">
    <label for="ssid">WiFi SSID</label>
    <div class="row">
      <input id="ssid" name="ssid" type="text" value="%SSID%" maxlength="32" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    </div>
    <button type="button" class="btn btn-sec" id="btnScan" onclick="scanWifi()">Quet mang WiFi xung quanh</button>
    <div id="scanBox" class="scan-box"></div>

    <label for="pass">WiFi Password</label>
    <div class="row">
      <input id="pass" name="pass" type="password" value="%PASS%" maxlength="64" autocapitalize="none" autocorrect="off" spellcheck="false">
      <button type="button" class="btn btn-toggle" id="btnPass" onclick="togglePass('pass','btnPass')">Hien</button>
    </div>

    <details id="adv">
      <summary>Cau hinh nang cao (tuy chon)</summary>
      <label for="backend_url">Backend API URL</label>
      <input id="backend_url" name="backend_url" type="text" value="%BACKEND_URL%" autocapitalize="none" autocorrect="off" spellcheck="false">

      <label for="mqtt_broker">MQTT Broker IP</label>
      <input id="mqtt_broker" name="mqtt_broker" type="text" value="%MQTT_BROKER%" autocapitalize="none" autocorrect="off" spellcheck="false">

      <label for="mqtt_port">MQTT Port</label>
      <input id="mqtt_port" name="mqtt_port" type="number" value="%MQTT_PORT%" min="1" max="65535">

      <label for="mqtt_user">MQTT Username</label>
      <input id="mqtt_user" name="mqtt_user" type="text" value="%MQTT_USER%" autocapitalize="none" autocorrect="off" spellcheck="false">

      <label for="mqtt_pass">MQTT Password</label>
      <div class="row">
        <input id="mqtt_pass" name="mqtt_pass" type="password" value="%MQTT_PASS%" autocapitalize="none" autocorrect="off" spellcheck="false">
        <button type="button" class="btn btn-toggle" id="btnMqttPass" onclick="togglePass('mqtt_pass','btnMqttPass')">Hien</button>
      </div>
    </details>

    <button type="button" class="btn btn-pri" id="btnSave" onclick="saveConfig()">Luu & Khoi dong lai</button>
  </form>

  <p class="meta">Neu mat ket noi AP: mo WiFi, ket noi lai <b>TraiNam_Setup_KhongDay</b><br>roi mo trinh duyet toi <b>192.168.4.1</b></p>
</div></div>

<script>
function $(id){ return document.getElementById(id); }
function showMsg(type, text){
  var el = $('banner');
  el.className = 'msg show ' + type;
  el.innerHTML = text;
}
function togglePass(inputId, btnId){
  var el = $(inputId), btn = $(btnId);
  if(!el) return;
  if(el.type === 'password'){ el.type='text'; if(btn) btn.textContent='An'; }
  else { el.type='password'; if(btn) btn.textContent='Hien'; }
}
function setBusy(busy, label){
  var b = $('btnSave');
  if(!b) return;
  b.disabled = !!busy;
  b.innerHTML = busy ? ('<span class="spinner"></span>' + (label||'Dang luu...')) : 'Luu & Khoi dong lai';
}
function scanWifi(){
  var box = $('scanBox');
  var btn = $('btnScan');
  btn.disabled = true;
  btn.textContent = 'Dang quet...';
  box.style.display = 'block';
  box.innerHTML = '<div class="scan-item">Dang quet mang...</div>';
  var x = new XMLHttpRequest();
  x.open('GET', '/scan?t=' + Date.now(), true);
  x.timeout = 12000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    btn.disabled = false;
    btn.textContent = 'Quet mang WiFi xung quanh';
    if(x.status !== 200){
      box.innerHTML = '<div class="scan-item">Quet that bai. Hay nhap SSID thu cong.</div>';
      return;
    }
    try {
      var list = JSON.parse(x.responseText || '[]');
      if(!list.length){
        box.innerHTML = '<div class="scan-item">Khong thay mang nao. Hay nhap SSID thu cong.</div>';
        return;
      }
      box.innerHTML = '';
      for(var i=0;i<list.length;i++){
        (function(item){
          var a = document.createElement('button');
          a.type = 'button';
          a.className = 'scan-item';
          var lock = item.secure ? ' 🔒' : ' 🔓';
          a.textContent = item.ssid + lock + '  (' + item.rssi + ' dBm)';
          a.onclick = function(){ $('ssid').value = item.ssid; $('pass').focus(); };
          box.appendChild(a);
        })(list[i]);
      }
    } catch(e){
      box.innerHTML = '<div class="scan-item">Loi doc ket qua quet.</div>';
    }
  };
  x.onerror = function(){
    btn.disabled = false;
    btn.textContent = 'Quet mang WiFi xung quanh';
    box.innerHTML = '<div class="scan-item">Mat ket noi AP khi quet. Thu lai.</div>';
  };
  x.send();
}
function saveConfig(){
  var ssid = ($('ssid').value || '').trim();
  if(!ssid){
    showMsg('err', 'Vui long nhap WiFi SSID.');
    $('ssid').focus();
    return;
  }
  var port = parseInt(($('mqtt_port').value || '18883'), 10);
  if(isNaN(port) || port < 1 || port > 65535){
    showMsg('err', 'MQTT Port khong hop le.');
    return;
  }

  setBusy(true, 'Dang luu...');
  showMsg('info', 'Dang gui cau hinh toi thiet bi...');

  var body =
    'ssid=' + encodeURIComponent(ssid) +
    '&pass=' + encodeURIComponent($('pass').value || '') +
    '&backend_url=' + encodeURIComponent(($('backend_url').value || '').trim()) +
    '&mqtt_broker=' + encodeURIComponent(($('mqtt_broker').value || '').trim()) +
    '&mqtt_port=' + encodeURIComponent(String(port)) +
    '&mqtt_user=' + encodeURIComponent(($('mqtt_user').value || '').trim()) +
    '&mqtt_pass=' + encodeURIComponent($('mqtt_pass').value || '');

  var x = new XMLHttpRequest();
  // Absolute URL to SoftAP IP avoids captive mini-browser rewriting relative /save.
  x.open('POST', 'http://192.168.4.1/save', true);
  x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  x.timeout = 20000;
  x.onreadystatechange = function(){
    if(x.readyState !== 4) return;
    if(x.status >= 200 && x.status < 300){
      var resp = {};
      try { resp = JSON.parse(x.responseText || '{}'); } catch(e) {}
      if(resp.ok){
        showMsg('ok', 'Da luu thanh cong! Thiet bi dang khoi dong lai va se ket noi WiFi <b>' + ssid + '</b>. Ban co the dong trang nay.');
        setBusy(true, 'Da luu - dang reboot...');
      } else {
        showMsg('err', (resp.error || 'Luu that bai. Thu lai.'));
        setBusy(false);
      }
    } else if(x.status === 0){
      // Connection dropped right after reboot/save — usually still OK.
      showMsg('ok', 'Da gui lenh luu. Neu AP bien mat, thiet bi dang reboot de ket noi WiFi moi.');
      setBusy(true, 'Da gui lenh...');
    } else {
      showMsg('err', 'Loi HTTP ' + x.status + '. Kiem tra ket noi AP roi thu lai.');
      setBusy(false);
    }
  };
  x.onerror = function(){
    // Many captive browsers fire error when device reboots after successful save.
    showMsg('ok', 'Mat ket noi AP sau khi gui. Neu dung, thiet bi dang reboot de vao WiFi moi.');
    setBusy(true, 'Da gui lenh...');
  };
  x.ontimeout = function(){
    showMsg('err', 'Het thoi gian cho phan hoi. Hay giu ket noi AP va bam Luu lai.');
    setBusy(false);
  };
  x.send(body);
}
// Keep association warm while user is filling the form.
setInterval(function(){
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/keep-alive?t=' + Date.now(), true);
    x.timeout = 2000;
    x.send();
  } catch(e) {}
}, 12000);
</script>
</body>
</html>
)rawliteral";

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
        String resp = "{";
        resp += "\"ssid\":\"" + json_escape(config::network::STA_SSID) + "\",";
        resp += "\"pass_len\":" + String(config::network::STA_PASS.length()) + ",";
        resp += "\"wifi_state\":" + String((int)current_state) + ",";
        resp += "\"ap_clients\":" + String(WiFi.softAPgetStationNum());
        resp += "}";
        send_json(200, resp);
    }

    static void handle_root()
    {
        mark_softap_activity();
        String html = captive_html;
        html.replace("%SSID%", config::network::STA_SSID);
        html.replace("%PASS%", config::network::STA_PASS);
        html.replace("%BACKEND_URL%", config::network::BACKEND_API_URL);
        html.replace("%MQTT_BROKER%", config::network::MQTT_BROKER_VAL);
        html.replace("%MQTT_PORT%", String(config::network::MQTT_PORT_VAL));
        html.replace("%MQTT_USER%", config::network::MQTT_USER_VAL);
        html.replace("%MQTT_PASS%", config::network::MQTT_PASSWORD_VAL);
        webServer.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        webServer.sendHeader("Pragma", "no-cache");
        webServer.sendHeader("Connection", "close");
        webServer.send(200, "text/html; charset=utf-8", html);
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

    // Test WiFi credentials synchronously without losing AP
    static bool test_wifi_connection(const String &ssid, const String &pass)
    {
        Serial.printf("[WIFI] Testing STA connection to '%s'...\n", ssid.c_str());

        // Switch to AP_STA so AP doesn't drop while testing
        if (WiFi.getMode() != WIFI_AP_STA)
        {
            WiFi.mode(WIFI_AP_STA);
        }

        WiFi.disconnect(false, false);
        delay(100);
        WiFi.begin(ssid.c_str(), pass.c_str());

        int attempt = 0;
        // Wait up to 12 seconds for connection
        while (WiFi.status() != WL_CONNECTED && attempt < 24)
        {
            delay(500);
            attempt++;

// Keep serving AP requests so captive portal doesn't timeout on the phone
#ifndef UNIT_TEST
            dnsServer.processNextRequest();
            webServer.handleClient();
#endif
        }

        bool success = (WiFi.status() == WL_CONNECTED);

        // Disconnect STA to return radio fully to AP until reboot
        WiFi.disconnect(false, false);
        WiFi.mode(WIFI_AP);
        WiFi.setSleep(false);

        if (success)
        {
            Serial.println("[WIFI] Test success! Credentials are valid.");
        }
        else
        {
            Serial.printf("[WIFI] Test failed! Status: %d\n", WiFi.status());
        }

        return success;
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
        String backend_url = webServer.arg("backend_url");
        backend_url.trim();
        String broker = webServer.arg("mqtt_broker");
        broker.trim();
        String port_raw = webServer.arg("mqtt_port");
        port_raw.trim();
        String user = webServer.arg("mqtt_user");
        user.trim();
        String mpass = webServer.arg("mqtt_pass");

        Serial.printf("[WIFI] Portal save request: ssid='%s' pass_len=%u backend='%s' broker='%s' port='%s'\n",
                      ssid.c_str(),
                      static_cast<unsigned>(pass.length()),
                      backend_url.c_str(),
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

        // 1. Test WiFi connection live
        if (!test_wifi_connection(ssid, pass))
        {
            send_json(400, "{\"ok\":false,\"error\":\"Khong the ket noi toi WiFi nay. Vui long kiem tra lai ten/mat khau.\"}");
            return;
        }

        // Fill advanced defaults if user left them blank (collapsed details).
        if (backend_url.length() == 0)
        {
            backend_url = config::network::BACKEND_API_URL.length()
                              ? config::network::BACKEND_API_URL
                              : String(config::network::DEFAULT_BACKEND_URL);
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
        // Leave mqtt_user blank — resolve_device_identity() forces username=deviceId.
        // The portal field is kept for display only; the actual MQTT connection uses deviceId.
        if (user.length() == 0)
        {
            user = config::network::MQTT_USER_VAL.length()
                       ? config::network::MQTT_USER_VAL
                       : String("");
        }
        if (mpass.length() == 0)
        {
            mpass = config::network::MQTT_PASSWORD_VAL.length()
                        ? config::network::MQTT_PASSWORD_VAL
                        : String(config::network::DEFAULT_MQTT_PASS);
        }

        bool wifi_saved = storage::StorageManager::get_instance().save_wifi_credentials(ssid, pass);
        if (!wifi_saved)
        {
            send_json(500, "{\"ok\":false,\"error\":\"Loi luu WiFi vao NVS\"}");
            return;
        }

        // Advanced config is best-effort: never block a successful WiFi save.
        bool backend_saved = storage::StorageManager::get_instance().save_backend_config(backend_url);
        bool mqtt_saved = storage::StorageManager::get_instance().save_mqtt_config(broker, port, user, mpass);
        if (!backend_saved || !mqtt_saved)
        {
            Serial.printf("[WIFI] WARNING: advanced save partial failure backend=%d mqtt=%d\n",
                          backend_saved, mqtt_saved);
        }

        // Mirror into runtime config so post-reboot path is consistent if restart is delayed.
        config::network::STA_SSID = ssid;
        config::network::STA_PASS = pass;
        config::network::BACKEND_API_URL = backend_url;
        config::network::MQTT_BROKER_VAL = broker;
        config::network::MQTT_PORT_VAL = port;
        config::network::MQTT_USER_VAL = user;
        config::network::MQTT_PASSWORD_VAL = mpass;

        String ok_json = String("{\"ok\":true,\"ssid\":\"") + json_escape(ssid) +
                         "\",\"reboot\":true,\"advanced_ok\":" +
                         ((backend_saved && mqtt_saved) ? "true" : "false") + '}';
        send_json(200, ok_json);

        // Give the TCP stack time to flush the JSON response before reboot.
        // Without this, many phones see "nothing happened" because the socket dies mid-response.
        webServer.client().flush();
        delay(300);
        Serial.printf("[WIFI] Config saved from portal. New SSID='%s'. Wiping SDK WiFi cache and restarting...\n", ssid.c_str());
        delay(700);
        WiFi.persistent(false);
        WiFi.disconnect(true, true);
        ESP.restart();
    }

    static void handle_not_found()
    {
        mark_softap_activity();

        // Do not 302 POST/PUT bodies away — that silently drops save attempts.
        if (webServer.method() == HTTP_POST || webServer.method() == HTTP_PUT)
        {
            send_json(404, "{\"ok\":false,\"error\":\"Endpoint khong ton tai\"}");
            return;
        }

        // Captive portal redirect for browser probes / random hosts.
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
#endif

    WifiState init_wifi()
    {
        Serial.println("[WIFI] Initializing WiFi Manager...");

#ifndef UNIT_TEST
        // Disable Arduino SDK auto-reconnect so it cannot keep retrying a stale
        // SSID cached outside our application NVS keys.
        WiFi.setAutoReconnect(false);
#endif

        // Đọc cấu hình WiFi STA từ NVS thông qua cấu hình hệ thống
        bool has_config = config::network::load_runtime_config();

        if (has_config)
        {
            softap_forced = false;
            Serial.printf("[WIFI] Found WiFi credentials in NVS (SSID: %s). Transitioning to STA_CONNECTING.\n",
                          config::network::STA_SSID.c_str());
            WiFi.persistent(false);
            WiFi.setAutoReconnect(false);
            WiFi.disconnect(false, false);
            delay(100);
            WiFi.mode(WIFI_STA);
            WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
            connection_start_time = millis();
            last_auth_attempt = 0;
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

        // 1. Process hardware button event requests from Core 1 Task
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
            else if (bits & WIFI_FORCE_PROVISION_BIT)
            {
                Serial.println("[WIFI] Handling WIFI_FORCE_PROVISION_BIT -> Forcing SoftAP...");
                storage::StorageManager &storage_manager = storage::StorageManager::get_instance();
                if (!storage_manager.clear_wifi_credentials())
                {
                    Serial.println("[WIFI] WiFi credentials were already absent or could not be cleared.");
                }
                config::network::STA_SSID = "";
                config::network::STA_PASS = "";
                reconnect_attempts = 0;
                xEventGroupClearBits(xWifiEventGroup, WIFI_FORCE_PROVISION_BIT);

#ifndef UNIT_TEST
                dnsServer.stop();
                webServer.stop();
#endif
                start_softap();
                return; // SoftAP started, exit check early
            }
        }

        switch (current_state)
        {
        case WifiState::STA_CONNECTING:
        {
            if (WiFi.status() == WL_CONNECTED)
            {
                // MQTT uses the provisioned NVS pre-shared key directly. Do not gate
                // station connectivity on a NestJS HTTP token: a regional power/network
                // recovery must not cause all devices to stampede /auth/token.
                Serial.printf("[WIFI] WiFi Connected successfully! IP: %s\n", WiFi.localIP().toString().c_str());
                reconnect_attempts = 0;
                set_state(WifiState::STA_CONNECTED);
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
            // Drain multiple clients/packets per tick so form typing/submit
            // is responsive even under captive-portal probe spam.
            for (int i = 0; i < 4; ++i)
            {
                dnsServer.processNextRequest();
                webServer.handleClient();
            }
#endif
            // If the radio silently left pure AP mode (common after AP/STA bounce),
            // re-assert SoftAP instead of letting STA auto-reclaim the link.
            if (softap_forced && (WiFi.getMode() & WIFI_AP) == 0)
            {
                Serial.println("[WIFI] SoftAP mode lost unexpectedly. Re-asserting captive portal...");
                start_softap();
                break;
            }
            if (softap_forced)
            {
                WiFi.enableSTA(false);
                WiFi.setAutoReconnect(false);
            }

            // Idle timeout: only shut AP when there are NO clients.
            // If a phone/laptop is still associated, keep portal alive indefinitely.
            if (has_softap_clients())
            {
                softap_last_activity_ms = now;
            }
            else if (now - softap_last_activity_ms >= SOFTAP_IDLE_TIMEOUT_MS)
            {
                Serial.println("[WIFI] SoftAP idle timeout (15 minutes, no clients). Shutting down SoftAP and reverting to STA_DISCONNECTED.");
#ifndef UNIT_TEST
                dnsServer.stop();
                webServer.stop();
#endif
                softap_forced = false;
                WiFi.softAPdisconnect(true);
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
        if (softap_forced || current_state == WifiState::SOFTAP_ACTIVE)
        {
            Serial.println("[WIFI] Abort reconnect: SoftAP provisioning portal is active.");
            return;
        }
        if (config::network::STA_SSID.length() == 0)
        {
            Serial.println("[WIFI] Abort reconnect: No SSID config available.");
            return;
        }
        Serial.printf("[WIFI] Reconnecting to SSID: %s...\n", config::network::STA_SSID.c_str());
        WiFi.setAutoReconnect(false);
        WiFi.disconnect(false, false);
        delay(100);
        // Gọi WiFi.begin để tái kết nối
        WiFi.begin(config::network::STA_SSID.c_str(), config::network::STA_PASS.c_str());
        connection_start_time = millis();
        last_auth_attempt = 0;
        set_state(WifiState::STA_CONNECTING);
    }

    WifiState get_wifi_state()
    {
        return current_state;
    }

} // namespace wifi
