# Sprint 3 — MQTT Integration & WiFi Auth JWT

**Phạm vi Big Plan:** Nhóm thay đổi #3 (JWT Auth & MQTT OTA Trigger) + tích hợp OTA check vào
Core 0 loop.
**Phụ thuộc:** Sprint 1 (WDT + Task Handles) và Sprint 2 (`ota_manager.h/.cpp`) phải hoàn thành.

---

## 1. PHẠM VI & MỤC TIÊU

### Module / Component bị tác động trực tiếp

| File | Loại tác động | Mô tả |
|------|--------------|-------|
| `mushroom-iot-firmware/src/wifi_manager.cpp` | MODIFY | Gọi `ota::init()`; Thêm `fetch_auth_token()` sau khi STA connected; Hạ timeout xuống 3000ms |
| `mushroom-iot-firmware/src/mqtt_client.cpp` | MODIFY | Trong handler `ota_update`: chỉ gọi `ota::request_ota_update(url)` và return ngay |
| `mushroom-iot-firmware/src/core0_tasks.cpp` | MODIFY | Thêm OTA trigger check vào vòng lặp chính sau bước telemetry |

### Mục tiêu của Sprint này
1. Firmware tự động lấy JWT từ backend qua HTTPS ngay khi WiFi kết nối thành công.
2. JWT được gán vào `config::network::MQTT_PASSWORD_VAL` để MQTT dùng cho lần connect tiếp theo.
3. MQTT callback `ota_update` được refactor thành fire-and-forget: nhận URL, lưu vào shared state,
   return ngay — không block callback context.
4. Core 0 loop định kỳ poll `ota::check_ota_trigger()` và gọi `perform_ota_update()` trên
   main task context (không phải ISR context).

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[WiFi State Machine — wifi_manager.cpp]
       |
       v (khi state chuyển sang STA_CONNECTED)
set_state(STA_CONNECTED)
       |
       v
fetch_auth_token()                    <- Gọi HTTPS đến /api/v1/auth/device-token
  ├─ WiFiClientSecure client
  ├─ client.setInsecure()
  ├─ HTTPClient http
  ├─ http.setTimeout(AUTH_HTTP_TIMEOUT_MS)   <- 3000ms (hạ từ 10000ms)
  ├─ http.begin(client, AUTH_ENDPOINT_URL)
  ├─ int code = http.GET()
  ├─ if code == 200:
  │    String body = http.getString()
  │    Dùng ArduinoJson để parse: json["token"]
  │    config::network::MQTT_PASSWORD_VAL = token  <- Gán JWT vào runtime config
  │    Serial.println("[WIFI] JWT token fetched and applied to MQTT password.")
  └─ else: Serial.printf("[WIFI] Auth token fetch failed: HTTP %d
", code)

[MQTT Callback — mqtt_client.cpp]
       |
       v (khi nhận message với command "ota_update")
handleMqttCommand(topic, payload)
       |
       v (parse JSON, extract "url" field)
ota::request_ota_update(url)          <- Lưu URL vào shared state (thread-safe)
return                                 <- Return NGAY, không block callback context

[Core 0 Main Loop — core0_tasks.cpp, trong taskCore0Communication()]
       |
       v (thêm bước mới: 5.5 — OTA Trigger Check)
String ota_url;
if (ota::check_ota_trigger(ota_url)) {
    ota::perform_ota_update(ota_url);  <- Chạy đồng bộ trên Core 0
}
```

**Luồng JWT Token:**
```
[Backend HTTPS Endpoint]  <-- HTTPClient GET /api/v1/auth/device-token
         |
         v
  Response JSON: { "token": "eyJhbGci..." }
         |
         v
  config::network::MQTT_PASSWORD_VAL = "eyJhbGci..."
         |
         v
  mqtt::MqttClient::getInstance().reconnect()
  -> PubSubClient::connect(clientId, username, MQTT_PASSWORD_VAL)
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK A — Tầng WiFi Manager (wifi_manager.cpp)

#### Task A-1: Gọi `ota::init()` trong `init_wifi()`

**File:** `mushroom-iot-firmware/src/wifi_manager.cpp`
**Hàm/Phương thức:** `wifi::init_wifi()` (public init function).

**Chi tiết:**
- Thêm `#include "ota_manager.h"` vào phần includes của file (trong block `#ifndef UNIT_TEST`
  hoặc unconditionally vì header đã có guard).
- Trong thân hàm `init_wifi()`, thêm lời gọi `ota::init()` **SAU** khi WiFi hardware được init
  nhưng **TRƯỚC** khi bất kỳ kết nối nào được thực hiện:
  ```cpp
  void init_wifi() {
      // ... existing init code ...
      ota::init();  // <- Khởi tạo OTA Mutex trước khi WiFi có thể trigger OTA
      // ... rest of init ...
  }
  ```

#### Task A-2: Hạ `AUTH_HTTP_TIMEOUT_MS` xuống 3000ms

**File:** `mushroom-iot-firmware/src/wifi_manager.cpp`
**Hàm/Phương thức:** File scope constant declaration.

**Chi tiết:**
- Tìm dòng:
  ```cpp
  constexpr unsigned long AUTH_HTTP_TIMEOUT_MS = 10000;       // 10 giây
  ```
- Sửa thành:
  ```cpp
  constexpr unsigned long AUTH_HTTP_TIMEOUT_MS = 3000;        // 3 giây (giảm từ 10s)
  ```
- **Lý do:** Với WDT 8 giây, timeout 10 giây sẽ kích hoạt hard reset trước khi auth hoàn thành.
  3 giây đủ cho kết nối LAN tốt, và nếu fail sẽ retry ở AUTH_RETRY_INTERVAL_MS (30s).

#### Task A-3: Hiện thực hàm `fetch_auth_token()`

**File:** `mushroom-iot-firmware/src/wifi_manager.cpp`
**Hàm/Phương thức:** `static void fetch_auth_token()` (hàm nội bộ, static).

**Chi tiết — vị trí khai báo:** Thêm khai báo `static void fetch_auth_token();` vào phần forward
declaration trong block `#ifndef UNIT_TEST` ở đầu file.

**Chi tiết — hiện thực:**
```cpp
#ifndef UNIT_TEST
static void fetch_auth_token() {
    // Đọc URL auth endpoint từ runtime config (đã load từ NVS)
    const String& auth_url = config::network::AUTH_ENDPOINT_URL_VAL;
    if (auth_url.length() == 0) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[WIFI] AUTH_ENDPOINT_URL not configured. Skipping token fetch.");
        return;
    }

    WiFiClientSecure secure_client;
    secure_client.setInsecure();  // Không verify CA

    HTTPClient http;
    http.setTimeout(AUTH_HTTP_TIMEOUT_MS);

    if (!http.begin(secure_client, auth_url)) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[WIFI] fetch_auth_token(): http.begin() failed.");
        return;
    }

    // Gửi Device ID trong header để backend định danh thiết bị
    http.addHeader("X-Device-Id", config::network::DEVICE_ID_VAL);

    int http_code = http.GET();

    if (http_code == HTTP_CODE_OK) {
        String payload = http.getString();
        http.end();

        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, payload);
        if (err) {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.printf("[WIFI] Auth token JSON parse error: %s
", err.c_str());
            return;
        }

        const char* token = doc["token"];
        if (token != nullptr && strlen(token) > 0) {
            config::network::MQTT_PASSWORD_VAL = String(token);
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[WIFI] JWT auth token fetched and applied successfully.");
        } else {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[WIFI] Auth response OK but 'token' field is empty.");
        }
    } else {
        http.end();
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.printf("[WIFI] fetch_auth_token() failed. HTTP code: %d
", http_code);
    }
}
#endif
```

#### Task A-4: Gọi `fetch_auth_token()` khi WiFi chuyển sang STA_CONNECTED

**File:** `mushroom-iot-firmware/src/wifi_manager.cpp`
**Hàm/Phương thức:** `set_state(WifiState new_state)` hoặc hàm xử lý transition vào `STA_CONNECTED`.

**Chi tiết:**
- Tìm điểm trong code nơi `current_state` chuyển sang `WifiState::STA_CONNECTED` (trong
  `set_state()` hoặc trong logic polling WiFi).
- Thêm lời gọi `fetch_auth_token()` ngay sau khi state được set:
  ```cpp
  case WifiState::STA_CONNECTED:
      // ... existing transition logic ...
  #ifndef UNIT_TEST
      fetch_auth_token();  // Lấy JWT token để dùng cho MQTT authentication
  #endif
      break;
  ```
- **Lưu ý:** Hàm này blocking (HTTPS call) nhưng được gọi trong context của Core 0, có WDT 8 giây
  và timeout 3 giây, nên an toàn.

---

### TRACK B — Tầng MQTT Client (mqtt_client.cpp)

#### Task B-1: Refactor handler lệnh `ota_update` thành fire-and-forget

**File:** `mushroom-iot-firmware/src/mqtt_client.cpp`
**Hàm/Phương thức:** `MqttClient::handleMqttCommand(const String& topic, const String& payload)` hoặc hàm tương đương xử lý command parsing.

**Chi tiết:**
- Thêm `#include "ota_manager.h"` vào phần includes của file.
- Tìm block xử lý command `"ota_update"` trong `handleMqttCommand()` (hoặc callback MQTT).
- Thay thế bất kỳ implementation blocking hiện tại bằng:
  ```cpp
  if (command == "ota_update") {
      const char* url = doc["url"];
      if (url != nullptr && strlen(url) > 0) {
          ota::request_ota_update(String(url));
          // Return NGAY — không block MQTT callback context
      } else {
          ScopedSerialLock guard(SerialLock::get_instance());
          Serial.println("[MQTT] ota_update command missing 'url' field. Ignored.");
      }
      return;  // <- QUAN TRỌNG: return ngay sau khi lưu URL
  }
  ```
- **Lý do fire-and-forget:** MQTT callback chạy trong context của `mqtt_client.loop()` trên
  Core 0. Nếu thực hiện OTA dài hạn trực tiếp trong callback, WDT sẽ không được feed và chip
  sẽ hard reset. Bằng cách chỉ lưu URL và return, ta chuyển việc thực thi sang Core 0 main loop.

---

### TRACK C — Tầng Core 0 Loop (core0_tasks.cpp)

#### Task C-1: Thêm include ota_manager.h

**File:** `mushroom-iot-firmware/src/core0_tasks.cpp`
**Hàm/Phương thức:** Phần includes ở đầu file.

**Chi tiết:**
- Thêm dòng `#include "ota_manager.h"` vào phần includes (có thể unconditional vì header đã có guard):
  ```cpp
  #include "definitions.h"
  #include "wifi_manager.h"
  #include "mqtt_client.h"
  #include "ota_manager.h"   // <- thêm dòng này
  #include "serial_mutex.h"
  ```

#### Task C-2: Thêm OTA trigger check vào vòng lặp chính

**File:** `mushroom-iot-firmware/src/core0_tasks.cpp`
**Hàm/Phương thức:** `taskCore0Communication()` — bên trong `while(1)` loop.

**Chi tiết:**
- Thêm bước mới (bước 5.5) **SAU** bước telemetry scan (bước 5) và **TRƯỚC** stack watermark (bước 6):
  ```cpp
  // 5.5. Check for pending OTA update trigger
  {
      String ota_url;
      if (ota::check_ota_trigger(ota_url)) {
          // perform_ota_update() là blocking và có thể reboot chip.
          // Nếu không reboot (failure), Core 1 đã được resume bên trong perform_ota_update().
          ota::perform_ota_update(ota_url);
      }
  }
  ```
- Đặt trong block `{}` riêng để `ota_url` có scope tối thiểu, tránh dùng nhầm biến.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **[BẢO MẬT] `ota::init()` phải được gọi TRƯỚC khi MQTT có thể nhận lệnh `ota_update`:**
   Thứ tự init: `ota::init()` trong `wifi::init_wifi()` → WiFi kết nối → MQTT init →
   MQTT subscribe. Nếu thứ tự bị đảo, `request_ota_update()` sẽ gọi với `otaMutex == nullptr`
   và sẽ bị từ chối (theo guard trong Task B-3 của Sprint 2).

2. **[BẢO MẶT] HTTPS `fetch_auth_token()` không được block quá `AUTH_HTTP_TIMEOUT_MS` (3000ms):**
   `http.setTimeout(AUTH_HTTP_TIMEOUT_MS)` phải được set TRƯỚC `http.begin()`. Nếu backend
   không phản hồi trong 3 giây, function phải return và log lỗi. Không được dùng blocking wait
   vô thời hạn.

3. **[HIỆU NĂNG] MQTT Callback PHẢI return trong thời gian ngắn (<10ms):**
   Hàm `handleMqttCommand()` khi xử lý `ota_update` chỉ được làm tối đa: parse JSON, extract URL,
   gọi `request_ota_update()` (acquire Mutex 100ms max). Không được thực hiện HTTPS, Flash write,
   hay bất kỳ I/O dài hạn nào trong callback.

4. **[TÍNH ĐÚNG ĐẮN] `config::network::MQTT_PASSWORD_VAL` phải là biến runtime có thể ghi:**
   Trước khi implement Task A-3, xác nhận rằng `MQTT_PASSWORD_VAL` trong `config.h` không phải
   `const String` hay `constexpr`. Nếu là `const`, cần refactor thành mutable runtime variable.

5. **[TÍNH ĐÚNG ĐẮN] OTA check chỉ thực hiện một lần mỗi trigger:**
   `check_ota_trigger()` phải clear `ota_pending = false` và `shared_ota_url = ""` ngay khi trả
   về `true`. Không được để cờ pending tồn tại qua nhiều iterations của Core 0 loop.

6. **[UNIT TEST] `pio test -e native` phải pass sau Sprint 3:**
   Tất cả `#include "ota_manager.h"` trong `mqtt_client.cpp` và `core0_tasks.cpp` phải được
   compile được trong native env. Kiểm tra rằng `ota_manager.h` không include bất kỳ Arduino
   hardware header nào ở top level (ngoài guard `#ifndef UNIT_TEST`).
