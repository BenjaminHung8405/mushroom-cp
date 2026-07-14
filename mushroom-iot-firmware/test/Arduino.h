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

inline int digitalRead(uint8_t pin) {
    auto value = mock_pin_values.find(pin);
    return value == mock_pin_values.end() ? HIGH : value->second;
}


class String : public std::string {
public:
    String() : std::string() {}
    String(const char* str) : std::string(str ? str : "") {}
    String(const std::string& str) : std::string(str) {}
    String(int val) : std::string(std::to_string(val)) {}

    const char* c_str() const { return std::string::c_str(); }
    size_t length() const { return std::string::length(); }
    bool isEmpty() const { return empty(); }
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

    bool disconnect(bool wifioff = false, bool eraseap = false) {
        disconnect_called = true;
        if (wifioff) {
            mock_status = WL_DISCONNECTED;
        }
        return true;
    }

    bool softAP(const char* ssid, const char* pass = nullptr, int channel = 1, int ssid_hidden = 0, int max_connection = 4) {
        if (mock_mode != WIFI_AP_STA) {
            mock_mode = WIFI_AP;
        }
        return true;
    }

    IPAddress softAPIP() {
        return IPAddress();
    }

    void persistent(bool val) {}
    void setAutoReconnect(bool val) {}
    void enableSTA(bool val) {}
    void setSleep(bool val) {}
    wifi_mode_t getMode() { return mock_mode; }
    bool softAPdisconnect(bool val) { return true; }
};

extern WiFiClass WiFi;

class WiFiClient {
public:
    WiFiClient() {}
};

class PubSubClient {
public:
    static bool mock_connected;
    static uint16_t mock_buffer_size;
    static uint16_t mock_keep_alive;
    static int mock_state;
    static std::string mock_server_host;
    static uint16_t mock_server_port;
    static bool mock_connect_result;
    static bool mock_publish_result;
    PubSubClient() {}
    PubSubClient(WiFiClient& client) {}

    typedef void (*MQTT_CALLBACK_SIGNATURE)(char*, uint8_t*, unsigned int);
    static MQTT_CALLBACK_SIGNATURE mock_callback;

    PubSubClient& setServer(const char* ip, uint16_t port) {
        mock_server_host = ip ? ip : "";
        mock_server_port = port;
        return *this;
    }
    PubSubClient& setCallback(MQTT_CALLBACK_SIGNATURE cb) { mock_callback = cb; return *this; }
    bool setBufferSize(uint16_t size) { mock_buffer_size = size; return true; }
    PubSubClient& setKeepAlive(uint16_t keepAlive) { mock_keep_alive = keepAlive; return *this; }

    bool connect(const char* id) { mock_connected = mock_connect_result; if (mock_connect_result) mock_state = 0; return mock_connect_result; }
    bool connect(const char* id, const char* user, const char* pass) { mock_connected = mock_connect_result; if (mock_connect_result) mock_state = 0; return mock_connect_result; }
    bool connect(const char* id, const char* user, const char* pass, const char* willTopic, uint8_t willQos, bool willRetain, const char* willMessage) {
        mock_connected = mock_connect_result;
        if (mock_connect_result) mock_state = 0;
        return mock_connect_result;
    }

    void disconnect() { mock_connected = false; mock_state = -1; }

    bool loop() { return true; }

    bool publish(const char* topic, const char* payload) { return mock_publish_result; }
    bool publish(const char* topic, const uint8_t* payload, unsigned int plength, bool retained) { return mock_publish_result; }

    bool subscribe(const char* topic) { return true; }
    bool subscribe(const char* topic, uint8_t qos) { return true; }

    bool connected() { return mock_connected; }

    int state() { return mock_state; }
};

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
typedef void* EventGroupHandle_t;
typedef uint32_t EventBits_t;
struct portMUX_TYPE {};
#define portMUX_INITIALIZER_UNLOCKED portMUX_TYPE{}
#define portENTER_CRITICAL(mux) do { (void)(mux); } while (0)
#define portEXIT_CRITICAL(mux) do { (void)(mux); } while (0)
#define portENTER_CRITICAL_ISR(mux) do { (void)(mux); } while (0)
#define portEXIT_CRITICAL_ISR(mux) do { (void)(mux); } while (0)

extern EventBits_t mock_event_group_bits;

inline EventGroupHandle_t xEventGroupCreate() {
    return (EventGroupHandle_t)1;
}

inline EventBits_t xEventGroupSetBits(EventGroupHandle_t xEventGroup, const EventBits_t uxBitsToSet) {
    mock_event_group_bits |= uxBitsToSet;
    return mock_event_group_bits;
}

inline EventBits_t xEventGroupClearBits(EventGroupHandle_t xEventGroup, const EventBits_t uxBitsToClear) {
    mock_event_group_bits &= ~uxBitsToClear;
    return mock_event_group_bits;
}

inline EventBits_t xEventGroupGetBits(EventGroupHandle_t xEventGroup) {
    return mock_event_group_bits;
}

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

inline BaseType_t xQueueOverwrite(QueueHandle_t xQueue, const void* pvItemToQueue) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr) return pdFALSE;
    while (!q->items.empty()) {
        q->items.pop();
    }
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

inline BaseType_t xQueueReset(QueueHandle_t xQueue) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr) return pdFALSE;
    while (!q->items.empty()) {
        q->items.pop();
    }
    return pdTRUE;
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

#define FALLING 2
inline int digitalPinToInterrupt(uint8_t pin) { return pin; }
inline void attachInterrupt(int /*interrupt*/, void (*/*callback*/)(), int /*mode*/) {}
inline void detachInterrupt(int /*interrupt*/) {}

