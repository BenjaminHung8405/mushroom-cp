#pragma once

#include <iostream>
#include <string>
#include <sstream>
#include <cstdint>

class String : public std::string {
public:
    String() : std::string() {}
    String(const char* str) : std::string(str ? str : "") {}
    String(const std::string& str) : std::string(str) {}
    String(int val) : std::string(std::to_string(val)) {}
    
    const char* c_str() const { return std::string::c_str(); }
    size_t length() const { return std::string::length(); }
};

class HardwareSerial {
public:
    void begin(unsigned long baud) {}
    void print(const String& s) { std::cout << s; }
    void print(const char* s) { std::cout << s; }
    void print(int n) { std::cout << n; }
    
    void println(const String& s) { std::cout << s << std::endl; }
    void println(const char* s) { std::cout << s << std::endl; }
    void println(int n) { std::cout << n << std::endl; }
    
    template<typename... Args>
    void printf(const char* format, Args... args) {
        std::printf(format, args...);
    }
};

extern HardwareSerial Serial;

#include <chrono>

extern unsigned long mock_millis_offset;

inline void delay(unsigned long ms) {}

inline unsigned long millis() {
    static auto start_time = std::chrono::steady_clock::now();
    auto now = std::chrono::steady_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(now - start_time);
    return static_cast<unsigned long>(duration.count()) + mock_millis_offset;
}

enum wl_status_t {
    WL_NO_SHIELD        = 255,
    WL_IDLE_STATUS      = 0,
    WL_NO_SSID_AVAIL    = 1,
    WL_SCAN_COMPLETED   = 2,
    WL_CONNECTED        = 3,
    WL_CONNECT_FAILED   = 4,
    WL_CONNECTION_LOST  = 5,
    WL_DISCONNECTED     = 6
};

enum wifi_mode_t {
    WIFI_OFF = 0,
    WIFI_STA = 1,
    WIFI_AP  = 2,
    WIFI_AP_STA = 3
};

class IPAddress {
public:
    IPAddress() {}
    String toString() const { return "192.168.1.100"; }
};

class WiFiClass {
public:
    static wl_status_t mock_status;
    static wifi_mode_t mock_mode;
    static std::string mock_ssid;
    static std::string mock_pass;
    static bool disconnect_called;

    void mode(wifi_mode_t mode) {
        mock_mode = mode;
    }

    void begin(const char* ssid, const char* pass) {
        mock_ssid = ssid ? ssid : "";
        mock_pass = pass ? pass : "";
        if (mock_status != WL_CONNECTED) {
            mock_status = WL_DISCONNECTED;
        }
    }

    wl_status_t status() {
        return mock_status;
    }

    IPAddress localIP() {
        return IPAddress();
    }

    bool disconnect(bool wifioff = false) {
        disconnect_called = true;
        mock_status = WL_DISCONNECTED;
        return true;
    }
};

extern WiFiClass WiFi;

class WiFiClient {
public:
    WiFiClient() {}
};

class PubSubClient {
public:
    static bool mock_connected;
    PubSubClient() {}
    PubSubClient(WiFiClient& client) {}
    
    typedef void (*MQTT_CALLBACK_SIGNATURE)(char*, uint8_t*, unsigned int);
    static MQTT_CALLBACK_SIGNATURE mock_callback;
    
    PubSubClient& setServer(const char* ip, uint16_t port) { return *this; }
    PubSubClient& setCallback(MQTT_CALLBACK_SIGNATURE cb) { mock_callback = cb; return *this; }
    
    bool connect(const char* id) { mock_connected = true; return true; }
    bool connect(const char* id, const char* user, const char* pass) { mock_connected = true; return true; }
    bool connect(const char* id, const char* user, const char* pass, const char* willTopic, uint8_t willQos, bool willRetain, const char* willMessage) { mock_connected = true; return true; }
    
    void disconnect() { mock_connected = false; }
    
    bool loop() { return true; }
    
    bool publish(const char* topic, const char* payload) { return true; }
    bool publish(const char* topic, const uint8_t* payload, unsigned int plength, bool retained) { return true; }
    
    bool subscribe(const char* topic) { return true; }
    bool subscribe(const char* topic, uint8_t qos) { return true; }
    
    bool connected() { return mock_connected; }
    
    int state() { return 0; }
};

