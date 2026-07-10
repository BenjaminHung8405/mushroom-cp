#pragma once

#include <iostream>
#include <string>
#include <sstream>
#include <cstdint>
#include <map>

#define INPUT 0x01
#define OUTPUT 0x02
#define INPUT_PULLUP 0x04

#define LOW 0x00
#define HIGH 0x01

extern std::map<uint8_t, uint8_t> mock_pin_modes;
extern std::map<uint8_t, uint8_t> mock_pin_values;
extern std::map<uint8_t, int> mock_pin_write_order;
extern int mock_operation_counter;

inline void pinMode(uint8_t pin, uint8_t mode) {
    mock_pin_modes[pin] = mode;
}

inline void digitalWrite(uint8_t pin, uint8_t val) {
    mock_pin_values[pin] = val;
    mock_pin_write_order[pin] = ++mock_operation_counter;
}


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
    
    operator bool() const { return true; }
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

// ---------------------------------------------------------------------------
// FreeRTOS stubs for host-side UNIT_TEST builds
// ---------------------------------------------------------------------------

#include <vector>
#include <cstring>
#include <queue>

typedef void* QueueHandle_t;
typedef void* TaskHandle_t;
typedef void* SemaphoreHandle_t;
typedef int32_t BaseType_t;
typedef uint32_t UBaseType_t;
typedef uint32_t TickType_t;

#define pdTRUE  1
#define pdFALSE 0
#define pdPASS  1
#define pdFAIL  0
#define portMAX_DELAY 0xFFFFFFFFUL

/**
 * @brief Lightweight mock queue backed by std::queue.
 * QueueHandle_t IS the MockQueue* — no indirection needed.
 */
struct MockQueue {
    size_t item_size = 0;
    size_t capacity  = 0;
    std::queue<std::vector<uint8_t>> items;
};

inline QueueHandle_t xQueueCreate(UBaseType_t uxQueueLength, UBaseType_t uxItemSize) {
    MockQueue* q = new MockQueue();
    q->capacity  = uxQueueLength;
    q->item_size = uxItemSize;
    return static_cast<QueueHandle_t>(q);
}

inline BaseType_t xQueueSend(QueueHandle_t xQueue, const void* pvItemToQueue, TickType_t /*xTicksToWait*/) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr) return pdFALSE;
    if (q->items.size() >= q->capacity) return pdFALSE;
    std::vector<uint8_t> buf(q->item_size);
    std::memcpy(buf.data(), pvItemToQueue, q->item_size);
    q->items.push(std::move(buf));
    return pdTRUE;
}

inline BaseType_t xQueueReceive(QueueHandle_t xQueue, void* pvBuffer, TickType_t /*xTicksToWait*/) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr || q->items.empty()) return pdFALSE;
    std::memcpy(pvBuffer, q->items.front().data(), q->item_size);
    q->items.pop();
    return pdTRUE;
}

inline UBaseType_t uxQueueMessagesWaiting(const QueueHandle_t xQueue) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr) return 0;
    return static_cast<UBaseType_t>(q->items.size());
}

inline void vQueueDelete(QueueHandle_t xQueue) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q != nullptr) delete q;
}

inline void vTaskDelay(TickType_t /*xTicksToDelay*/) {}
inline TickType_t pdMS_TO_TICKS(uint32_t ms) { return ms; }

inline BaseType_t xTaskCreatePinnedToCore(
    void (*/*pxTaskCode*/)(void*),
    const char* /*pcName*/,
    uint32_t /*usStackDepth*/,
    void* /*pvParameters*/,
    UBaseType_t /*uxPriority*/,
    TaskHandle_t* /*pxCreatedTask*/,
    BaseType_t /*xCoreID*/)
{
    return pdPASS;
}

inline UBaseType_t uxTaskGetStackHighWaterMark(void* /*xTask*/) {
    return 4096;
}

