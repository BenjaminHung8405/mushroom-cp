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

#include "index_html.h"
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

        doc["h_lamp_duty"] = state.h_lamp_duty;
        doc["h_wat_duty"] = state.h_wat_duty;
        doc["mist_duty"] = state.mist_duty;
        doc["exhaust_duty"] = state.exhaust_duty;
        JsonObject actuators = doc.createNestedObject("actuators");
        actuators["mist_active"] = state.actuators.mist_active;
        actuators["fan_active"] = state.actuators.fan_active;
        actuators["lamp_stage_active"] = state.actuators.lamp_stage_active;
        actuators["lamp_stage2_active"] = state.actuators.lamp_stage2_active;
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
