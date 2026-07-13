#include "WebInterface.h"
#include "definitions.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "serial_mutex.h"
#include <ArduinoJson.h>

#ifndef UNIT_TEST
#include <WebServer.h>
#include <WiFi.h>

static WebServer localWebServer(80);
static bool server_running = false;
static bool routes_registered = false;

// HTML Dashboard stored in Flash memory to protect Heap RAM (PROGMEM)
const char DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mushroom CP - Control Panel</title>
    <style>
        :root {
            --bg-color: #0b0c10;
            --card-bg: rgba(31, 40, 51, 0.45);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-main: #c5c6c7;
            --text-title: #ffffff;
            --text-muted: #868686;
            --primary: #45f3ff;
            --primary-glow: rgba(69, 243, 255, 0.15);
            --temp-color: #ff0055;
            --temp-glow: rgba(255, 0, 85, 0.15);
            --humid-color: #00ffaa;
            --humid-glow: rgba(0, 255, 170, 0.15);
            --co2-color: #ffaa00;
            --co2-glow: rgba(255, 170, 0, 0.15);
            --success: #00ff66;
            --danger: #ff3333;
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 1.5rem;
            display: flex;
            justify-content: center;
            min-height: 100vh;
        }
        .container {
            max-width: 900px;
            width: 100%;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1rem;
            margin-bottom: 2rem;
        }
        h1 {
            font-size: 1.6rem;
            font-weight: 600;
            margin: 0;
            color: var(--text-title);
            background: linear-gradient(45deg, var(--primary), #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 0 20px rgba(69, 243, 255, 0.2);
        }
        .status-container {
            display: flex;
            gap: 0.5rem;
        }
        .badge {
            padding: 0.3rem 0.6rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.3rem;
            border: 1px solid var(--border-color);
            background-color: rgba(255, 255, 255, 0.02);
            transition: all 0.3s ease;
        }
        .badge-online {
            border-color: rgba(0, 255, 102, 0.2);
            color: var(--success);
            text-shadow: 0 0 5px rgba(0, 255, 102, 0.3);
        }
        .badge-offline {
            border-color: rgba(255, 51, 51, 0.2);
            color: var(--danger);
            text-shadow: 0 0 5px rgba(255, 51, 51, 0.3);
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1.5rem;
        }
        .card {
            background: var(--card-bg);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            position: relative;
            overflow: hidden;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 3px;
        }
        .card-temp::before { background: var(--temp-color); }
        .card-temp:hover { border-color: var(--temp-color); box-shadow: 0 5px 20px var(--temp-glow); }
        .card-humid::before { background: var(--humid-color); }
        .card-humid:hover { border-color: var(--humid-color); box-shadow: 0 5px 20px var(--humid-glow); }
        .card-co2::before { background: var(--co2-color); }
        .card-co2:hover { border-color: var(--co2-color); box-shadow: 0 5px 20px var(--co2-glow); }
        .card-outputs::before { background: var(--primary); }
        .card-outputs:hover { border-color: var(--primary); box-shadow: 0 5px 20px var(--primary-glow); }

        .card-title {
            font-size: 0.8rem;
            color: var(--text-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }
        .card-value-wrapper {
            display: flex;
            align-items: baseline;
            gap: 0.3rem;
            margin-bottom: 0.5rem;
        }
        .card-value {
            font-size: 2.2rem;
            font-weight: 700;
            color: var(--text-title);
        }
        .card-unit {
            font-size: 1.1rem;
            color: var(--text-muted);
        }
        .card-target {
            font-size: 0.8rem;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 0.5rem;
            margin-top: 0.5rem;
        }
        .target-val {
            font-weight: 600;
            color: var(--text-title);
        }
        .output-item {
            margin-bottom: 0.8rem;
        }
        .output-item:last-child {
            margin-bottom: 0;
        }
        .output-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            margin-bottom: 0.25rem;
        }
        .output-label {
            font-weight: 600;
        }
        .output-val {
            font-family: monospace;
            color: var(--text-title);
        }
        .progress-bg {
            height: 6px;
            background-color: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-bar {
            height: 100%;
            width: 0%;
            border-radius: 3px;
            transition: width 0.8s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .pb-hair { background: linear-gradient(90deg, #ff0055, #ff5500); }
        .pb-hwat { background: linear-gradient(90deg, #ffaa00, #ff5500); }
        .pb-mist { background: linear-gradient(90deg, #00ffaa, #00aaff); }
        .pb-exh { background: linear-gradient(90deg, var(--primary), #a855f7); }
        
        .footer {
            margin-top: 3rem;
            text-align: center;
            font-size: 0.75rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
            padding-top: 1rem;
        }
        .footer span {
            margin: 0 0.5rem;
        }
        .footer-val {
            color: var(--text-title);
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>MUSHROOM CONTROL PANEL</h1>
            <div class="status-container">
                <div id="wifi-badge" class="badge badge-offline">○ WiFi Init</div>
                <div id="mqtt-badge" class="badge badge-offline">○ MQTT Init</div>
            </div>
        </header>
        
        <div class="grid">
            <div class="card card-temp">
                <div class="card-title">Air Temperature</div>
                <div class="card-value-wrapper">
                    <span id="temp-val" class="card-value">--.-</span>
                    <span class="card-unit">°C</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="temp-target">--.-</span> °C</span>
                </div>
            </div>
            
            <div class="card card-humid">
                <div class="card-title">Air Humidity</div>
                <div class="card-value-wrapper">
                    <span id="humid-val" class="card-value">--</span>
                    <span class="card-unit">% RH</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="humid-target">--</span> % RH</span>
                </div>
            </div>
            
            <div class="card card-co2">
                <div class="card-title">CO2 Concentration</div>
                <div class="card-value-wrapper">
                    <span id="co2-val" class="card-value">----</span>
                    <span class="card-unit">ppm</span>
                </div>
                <div class="card-target">
                    <span>Target Setpoint</span>
                    <span class="target-val"><span id="co2-target">----</span> ppm</span>
                </div>
            </div>
            
            <div class="card card-outputs">
                <div class="card-title">Actuator Demands (TPC)</div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Air Heater (HAir)</span>
                        <span id="hair-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="hair-bar" class="progress-bar pb-hair"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Water Heater (HWat)</span>
                        <span id="hwat-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="hwat-bar" class="progress-bar pb-hwat"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Mist Humidifier</span>
                        <span id="mist-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="mist-bar" class="progress-bar pb-mist"></div>
                    </div>
                </div>
                <div class="output-item">
                    <div class="output-header">
                        <span class="output-label">Exhaust Fan</span>
                        <span id="exh-val" class="output-val">0%</span>
                    </div>
                    <div class="progress-bg">
                        <div id="exh-bar" class="progress-bar pb-exh"></div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <span>Uptime: <span id="uptime-val" class="footer-val">0</span>s</span>
            <span>|</span>
            <span>Heap: <span id="heap-val" class="footer-val">0</span> KB</span>
        </div>
    </div>
    
    <script>
        function updateUI() {
            fetch('/data')
                .then(r => {
                    if (r.status === 429) {
                        console.warn('Rate limit exceeded (429)');
                        return null;
                    }
                    return r.json();
                })
                .then(data => {
                    if (!data) return;
                    
                    document.getElementById('temp-val').innerText = (data.temp_air !== undefined && data.temp_air !== null && !isNaN(data.temp_air)) ? data.temp_air.toFixed(1) : '--.-';
                    document.getElementById('humid-val').innerText = (data.humidity_air !== undefined && data.humidity_air !== null && !isNaN(data.humidity_air)) ? Math.round(data.humidity_air) : '--';
                    document.getElementById('co2-val').innerText = (data.co2_level !== undefined && data.co2_level !== null && !isNaN(data.co2_level)) ? Math.round(data.co2_level) : 'Offline';
                    
                    document.getElementById('temp-target').innerText = (data.temp_target !== undefined && data.temp_target !== null && !isNaN(data.temp_target)) ? data.temp_target.toFixed(1) : '--.-';
                    document.getElementById('humid-target').innerText = (data.humidity_target !== undefined && data.humidity_target !== null && !isNaN(data.humidity_target)) ? Math.round(data.humidity_target) : '--';
                    document.getElementById('co2-target').innerText = (data.co2_target !== undefined && data.co2_target !== null && !isNaN(data.co2_target)) ? Math.round(data.co2_target) : '----';
                    
                    updateBar('hair-bar', 'hair-val', data.h_air_duty);
                    updateBar('hwat-bar', 'hwat-val', data.h_wat_duty);
                    updateBar('mist-bar', 'mist-val', data.mist_duty);
                    updateBar('exh-bar', 'exh-val', data.exhaust_duty);
                    
                    updateBadge('wifi-badge', data.wifi_connected, 'WiFi Connected', 'WiFi Offline');
                    updateBadge('mqtt-badge', data.mqtt_connected, 'MQTT Connected', 'MQTT Offline');
                    
                    document.getElementById('uptime-val').innerText = data.uptime || 0;
                    document.getElementById('heap-val').innerText = Math.round((data.free_heap || 0) / 1024);
                })
                .catch(e => console.error('Error fetching data:', e));
        }
        
        function updateBar(barId, valId, val) {
            const num = (val !== undefined && val !== null) ? val : 0;
            const pct = Math.round(num * 100);
            document.getElementById(barId).style.width = pct + '%';
            document.getElementById(valId).innerText = pct + '%';
        }
        
        function updateBadge(id, state, textOn, textOff) {
            const el = document.getElementById(id);
            if (state) {
                el.className = 'badge badge-online';
                el.innerText = '● ' + textOn;
            } else {
                el.className = 'badge badge-offline';
                el.innerText = '○ ' + textOff;
            }
        }
        
        setInterval(updateUI, 2000);
        updateUI();
    </script>
</body>
</html>
)rawliteral";
#endif

namespace web_interface
{
    bool checkRateLimit(unsigned long now)
    {
        static unsigned long last_request_time = 0;
        static bool has_last_request = false;
        if (has_last_request && (now - last_request_time < 1000))
        {
            return false;
        }
        last_request_time = now;
        has_last_request = true;
        return true;
    }

    void mapSystemStateToJson(const SharedSystemState& state, StaticJsonDocument<512>& doc)
    {
        if (std::isnan(state.temp_air)) doc["temp_air"] = nullptr;
        else doc["temp_air"] = state.temp_air;

        if (std::isnan(state.humidity_air)) doc["humidity_air"] = nullptr;
        else doc["humidity_air"] = state.humidity_air;

        if (std::isnan(state.co2_level)) doc["co2_level"] = nullptr;
        else doc["co2_level"] = state.co2_level;

        if (std::isnan(state.temp_target)) doc["temp_target"] = nullptr;
        else doc["temp_target"] = state.temp_target;

        if (std::isnan(state.humidity_target)) doc["humidity_target"] = nullptr;
        else doc["humidity_target"] = state.humidity_target;

        if (std::isnan(state.co2_target)) doc["co2_target"] = nullptr;
        else doc["co2_target"] = state.co2_target;

        doc["h_air_duty"] = state.h_air_duty;
        doc["h_wat_duty"] = state.h_wat_duty;
        doc["mist_duty"] = state.mist_duty;
        doc["exhaust_duty"] = state.exhaust_duty;
        JsonObject actuators = doc.createNestedObject("actuators");
        actuators["mist_active"] = state.actuators.mist_active;
        actuators["fan_active"] = state.actuators.fan_active;
        actuators["heater_air_active"] = state.actuators.heater_air_active;
        actuators["heater_water_active"] = state.actuators.heater_water_active;
        actuators["midday_blackout_active"] = state.actuators.midday_blackout_active;
    }

    void apiGetRealtimeData()
    {
#ifndef UNIT_TEST
        if (!checkRateLimit(millis()))
        {
            localWebServer.sendHeader("Retry-After", "1");
            localWebServer.sendHeader("Cache-Control", "no-store");
            localWebServer.send(429, "application/json", "{\"error\":\"Too Many Requests\"}");
            return;
        }

        // Lấy trạng thái hệ thống thread-safe
        SharedSystemState state = getSharedSystemState();

        StaticJsonDocument<512> doc;
        mapSystemStateToJson(state, doc);

        doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
        doc["mqtt_connected"] = mqtt::MqttClient::getInstance().isConnected();
        doc["uptime"] = millis() / 1000;
        doc["free_heap"] = ESP.getFreeHeap();

        String jsonResponse;
        serializeJson(doc, jsonResponse);

        localWebServer.sendHeader("Cache-Control", "no-store");
        localWebServer.sendHeader("Access-Control-Allow-Origin", "*");
        localWebServer.send(200, "application/json; charset=utf-8", jsonResponse);
#endif
    }

    void initServer()
    {
#ifndef UNIT_TEST
        if (server_running) return;

        // Register callbacks only once. Re-registering them after every
        // STA/SoftAP transition grows WebServer's route list and fragments heap.
        if (!routes_registered)
        {
            localWebServer.on("/", HTTP_GET, serveDashboardHTML);
            localWebServer.on("/data", HTTP_GET, apiGetRealtimeData);
            localWebServer.onNotFound([]()
            {
                localWebServer.sendHeader("Cache-Control", "no-store");
                localWebServer.send(404, "application/json; charset=utf-8",
                                    "{\"error\":\"Not Found\"}");
            });
            routes_registered = true;
        }

        localWebServer.begin();
        server_running = true;

        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[WEB_INTERFACE] Local WebServer started successfully on port 80.");
#endif
    }

    void handleClient()
    {
#ifndef UNIT_TEST
        if (server_running)
        {
            localWebServer.handleClient();
        }
#endif
    }

    void stopServer()
    {
#ifndef UNIT_TEST
        if (!server_running) return;

        localWebServer.stop();
        server_running = false;

        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[WEB_INTERFACE] Local WebServer stopped.");
#endif
    }

    bool isServerRunning()
    {
#ifndef UNIT_TEST
        return server_running;
#else
        return false;
#endif
    }

    void serveDashboardHTML()
    {
#ifndef UNIT_TEST
        localWebServer.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        localWebServer.sendHeader("Pragma", "no-cache");
        localWebServer.sendHeader("Connection", "close");
        localWebServer.send(200, "text/html; charset=utf-8", DASHBOARD_HTML);
#endif
    }
}
