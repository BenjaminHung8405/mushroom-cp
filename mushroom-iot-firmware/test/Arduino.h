#pragma once

#include <iostream>
#include <string>
#include <sstream>
#include <cstdint>
#include <map>
#include <vector>

#define INPUT 0x01
#define OUTPUT 0x02
#define INPUT_PULLUP 0x04

#define LOW 0x00
#define HIGH 0x01

#ifndef IRAM_ATTR
#define IRAM_ATTR
#endif

typedef bool boolean;

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

inline void noInterrupts() {}
inline void interrupts() {}


class String {
private:
    std::string _str;
public:
    String() : _str("") {}
    String(const char* str) : _str(str ? str : "") {}
    String(const std::string& str) : _str(str) {}
    String(int val) : _str(std::to_string(val)) {}

    const char* c_str() const { return _str.c_str(); }
    size_t length() const { return _str.length(); }
    bool isEmpty() const { return _str.empty(); }
    bool endsWith(const char* suffix) const {
        if (!suffix) return false;
        size_t suffix_len = strlen(suffix);
        if (_str.length() < suffix_len) return false;
        return _str.compare(_str.length() - suffix_len, suffix_len, suffix) == 0;
    }
    bool endsWith(const String& suffix) const {
        return endsWith(suffix.c_str());
    }
    bool equals(const char* other) const {
        if (!other) return _str.empty();
        return _str == other;
    }
    bool equals(const String& other) const {
        return _str == other._str;
    }
    void clear() { _str.clear(); }

    bool operator==(const char* other) const { return _str == other; }
    bool operator==(const String& other) const { return _str == other._str; }
    bool operator!=(const char* other) const { return _str != other; }
    bool operator!=(const String& other) const { return _str != other._str; }
    String& operator+=(const char* other) { _str += other; return *this; }
    String& operator+=(const String& other) { _str += other._str; return *this; }
    operator const char*() const { return _str.c_str(); }

    size_t write(uint8_t c) {
        _str.push_back(c);
        return 1;
    }
    size_t write(const uint8_t* buffer, size_t size) {
        _str.append(reinterpret_cast<const char*>(buffer), size);
        return size;
    }
};

inline String operator+(const char* lhs, const String& rhs) {
    std::string s(lhs);
    s += rhs.c_str();
    return String(s);
}

inline String operator+(const String& lhs, const char* rhs) {
    std::string s(lhs.c_str());
    s += rhs;
    return String(s);
}

inline String operator+(const String& lhs, const String& rhs) {
    std::string s(lhs.c_str());
    s += rhs.c_str();
    return String(s);
}

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

inline void yield() {}
#define pgm_read_byte_near(addr) (*(addr))

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
    IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {}
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

class Print {
public:
    virtual size_t write(uint8_t) = 0;
    virtual size_t write(const uint8_t *buffer, size_t size) = 0;
};

class Stream {
public:
    virtual int available() { return 0; }
    virtual int read() { return -1; }
    virtual size_t write(uint8_t) { return 0; }
    virtual size_t write(const uint8_t *buffer, size_t size) { return 0; }
    virtual void flush() {}
};

class Client : public Stream {
public:
    virtual int connect(IPAddress ip, uint16_t port) { return 0; }
    virtual int connect(const char *host, uint16_t port) { return 0; }
    virtual void stop() {}
    virtual uint8_t connected() { return 0; }
    virtual operator bool() { return false; }
    virtual void flush() override {}
};

extern WiFiClass WiFi;

class WiFiClient : public Client {
public:
    std::vector<uint8_t> mock_input;
    size_t mock_input_pos = 0;

    WiFiClient() {}
    int available() override { return mock_input.size() - mock_input_pos; }
    int read() override {
        if (mock_input_pos < mock_input.size()) {
            return mock_input[mock_input_pos++];
        }
        return -1;
    }
    size_t write(uint8_t) override { return 0; }
    size_t write(const uint8_t *buffer, size_t size) override { return size; }
    int connect(IPAddress ip, uint16_t port) override { return 1; }
    int connect(const char *host, uint16_t port) override { return 1; }
    void stop() override {}
    uint8_t connected() override { return 1; }
    operator bool() override { return true; }
    void flush() override {}
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
    static std::vector<std::string> mock_subscribed_topics;
    static std::string mock_last_published_topic;
    static std::string mock_last_published_payload;
    static bool mock_last_published_retained;
    static uint8_t mock_last_published_qos;
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

    bool publish(const char* topic, const char* payload) {
        mock_last_published_topic = topic ? topic : "";
        mock_last_published_payload = payload ? payload : "";
        mock_last_published_retained = false;
        return mock_publish_result;
    }
    bool publish(const char* topic, const uint8_t* payload, unsigned int plength, bool retained) {
        mock_last_published_topic = topic ? topic : "";
        mock_last_published_payload.assign(
            reinterpret_cast<const char*>(payload), payload == nullptr ? 0 : plength);
        mock_last_published_retained = retained;
        return mock_publish_result;
    }
    bool publishQos1(const char* topic, const uint8_t* payload, unsigned int plength, bool retained) {
        mock_last_published_topic = topic ? topic : "";
        mock_last_published_payload.assign(
            reinterpret_cast<const char*>(payload), payload == nullptr ? 0 : plength);
        mock_last_published_retained = retained;
        mock_last_published_qos = 1;
        return mock_publish_result;
    }

    bool subscribe(const char* topic) { if (topic) mock_subscribed_topics.push_back(topic); return true; }
    bool subscribe(const char* topic, uint8_t qos) { if (topic) mock_subscribed_topics.push_back(topic); return true; }
    bool unsubscribe(const char* topic) { return true; }

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

struct MockEventGroup {
    EventBits_t bits = 0;
};

extern EventGroupHandle_t xWifiEventGroup;
extern EventBits_t mock_event_group_bits;

inline EventGroupHandle_t xEventGroupCreate() {
    return new MockEventGroup();
}

inline EventBits_t xEventGroupSetBits(EventGroupHandle_t xEventGroup, const EventBits_t uxBitsToSet) {
    if (xEventGroup == nullptr) return 0;
    MockEventGroup* eg = static_cast<MockEventGroup*>(xEventGroup);
    eg->bits |= uxBitsToSet;
    if (xWifiEventGroup == nullptr || xEventGroup == xWifiEventGroup) {
        mock_event_group_bits = eg->bits;
    }
    return eg->bits;
}

inline EventBits_t xEventGroupClearBits(EventGroupHandle_t xEventGroup, const EventBits_t uxBitsToClear) {
    if (xEventGroup == nullptr) return 0;
    MockEventGroup* eg = static_cast<MockEventGroup*>(xEventGroup);
    eg->bits &= ~uxBitsToClear;
    if (xWifiEventGroup == nullptr || xEventGroup == xWifiEventGroup) {
        mock_event_group_bits = eg->bits;
    }
    return eg->bits;
}

inline EventBits_t xEventGroupGetBits(EventGroupHandle_t xEventGroup) {
    if (xEventGroup == nullptr) return 0;
    MockEventGroup* eg = static_cast<MockEventGroup*>(xEventGroup);
    return eg->bits;
}

inline EventBits_t xEventGroupWaitBits(EventGroupHandle_t xEventGroup,
                                       const EventBits_t uxBitsToWaitFor,
                                       const BaseType_t xClearOnExit,
                                       const BaseType_t /*xWaitForAllBits*/,
                                       TickType_t /*xTicksToWait*/) {
    if (xEventGroup == nullptr) return 0;
    MockEventGroup* eg = static_cast<MockEventGroup*>(xEventGroup);
    const EventBits_t observed_bits = eg->bits;
    if (xClearOnExit != 0 && (observed_bits & uxBitsToWaitFor) != 0) {
        eg->bits &= ~uxBitsToWaitFor;
    }
    if (xWifiEventGroup == nullptr || xEventGroup == xWifiEventGroup) {
        mock_event_group_bits = eg->bits;
    }
    return observed_bits;
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

extern void (*mock_queue_send_hook)(QueueHandle_t, const void*);
extern void (*mock_queue_overwrite_hook)(QueueHandle_t, const void*);
extern bool mock_fail_queue_overwrite;
extern bool mock_fail_queue_send;

inline BaseType_t xQueueSend(QueueHandle_t xQueue, const void* pvItemToQueue, TickType_t /*xTicksToWait*/) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr || mock_fail_queue_send) return pdFALSE;
    if (q->items.size() >= q->capacity) return pdFALSE;
    std::vector<uint8_t> buf(q->item_size);
    std::memcpy(buf.data(), pvItemToQueue, q->item_size);
    q->items.push(std::move(buf));
    if (mock_queue_send_hook != nullptr) {
        mock_queue_send_hook(xQueue, pvItemToQueue);
    }
    return pdTRUE;
}

inline BaseType_t xQueueOverwrite(QueueHandle_t xQueue, const void* pvItemToQueue) {
    MockQueue* q = static_cast<MockQueue*>(xQueue);
    if (q == nullptr || mock_fail_queue_overwrite) return pdFALSE;
    while (!q->items.empty()) {
        q->items.pop();
    }
    std::vector<uint8_t> buf(q->item_size);
    std::memcpy(buf.data(), pvItemToQueue, q->item_size);
    q->items.push(std::move(buf));
    if (mock_queue_overwrite_hook != nullptr) {
        mock_queue_overwrite_hook(xQueue, pvItemToQueue);
    }
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
