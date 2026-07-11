# SPRINT 2: HẠ TẦNG IOT, DELTA MQTT BASE64 VÀ WEB DASHBOARD (CORE 0)

## 1. PHẠM VI & MỤC TIÊU
Thực thi toàn bộ luồng giao tiếp bên ngoài của hệ thống nhà nấm, xử lý độc lập trên Core 0. Phạm vi bao gồm: Quản lý kết nối WiFi (Station + SoftAP mode), Thiết lập Local Web Server (UI giao diện trạng thái), Cơ chế kiểm tra biến thiên dữ liệu (Delta Threshold Check), Mã hóa JSON & Base64, và Truyền thông MQTT hai chiều an toàn.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
[Core 1 Shared Variables] -> (Thread-safe Read) -> [Delta Threshold Checker] -> (Nếu có thay đổi > Threshold OR cờ forceFullPublish == true) -> [JSON Document Builder] -> Chuỗi JSON thô -> [MbedTLS Base64 Encoder] -> Chuỗi Base64 Payload -> [MQTT Publish Topic] -> Phản hồi mạng -> (Loop).
Đồng thời: [MQTT Subscribe Topic] -> (Nhận lệnh "cmd":"full_sync") -> Phân tích JSON -> Bật cờ `forceFullPublish = true`.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK GIAO THỨC DỮ LIỆU (DATA PROTOCOL)
- **Tạo file:** `CryptoUtils.h` / `CryptoUtils.cpp`
  - *Hàm `encodeBase64String()`*: Nhận đầu vào là `String` hoặc `char*` thuần. Sử dụng API `mbedtls_base64_encode` phân bổ buffer cục bộ. Trả về String đã mã hóa chuẩn.
- **Tạo file:** `Telemetry.h` / `Telemetry.cpp`
  - *Hàm `evaluateDeltaThresholds()`*: So sánh mảng dữ liệu `lastPubState` với dữ liệu chia sẻ hiện tại (vd: lệch T > 0.2, lệch H > 1.0, lệch CO2 > 10). Trả về boolean `true` nếu có ít nhất 1 thay đổi.
  - *Hàm `buildDeltaPayload()`*: Khởi tạo `StaticJsonDocument`. Chỉ chèn các key (short-keys: `rT`, `rH`, `tCO2`...) nào được đánh dấu là thay đổi từ hàm evaluate. Trả về cấu trúc chuỗi JSON thu gọn.

### TRACK MẠNG & API ĐIỀU KHIỂN (NETWORK & WEB API)
- **Tạo file:** `NetworkTask.h` / `NetworkTask.cpp`
  - *Hàm `initWiFiModes()`*: Thiết lập `WIFI_AP_STA`. Khởi động SoftAP nội bộ và bắt đầu tiến trình kết nối Router ngoài không chặn (non-blocking loop attempts).
  - *Hàm `handleMQTTCallback()`*: Call-back bắt sự kiện nhận tin nhắn từ Broker. Giải mã JSON đến, kiểm tra key `cmd`, nếu bằng `full_sync` thì đổi state biến cờ `shared_forceFullPublish`.
  - *Hàm `maintainMQTTConnection()`*: Quản lý reconnect tự động, đăng ký subscribe topic lệnh khi kết nối lại thành công.
- **Tạo file:** `WebInterface.h` / `WebInterface.cpp`
  - *Hàm `serveDashboardHTML()`*: Lưu trữ chuỗi HTML nội bộ, phục vụ HTTP GET `/`.
  - *Hàm `apiGetRealtimeData()`*: Phục vụ HTTP GET `/data`. Trả về Full JSON dạng plain-text chứa toàn bộ trạng thái hệ thống cho Ajax request từ web nội bộ.

### TRACK HỆ THỐNG CHÍNH (SYSTEM MAIN)
- **Tạo/Sửa file:** `main.cpp`
  - *Hàm `setup()`*: Khởi tạo I2C, kích hoạt `initWiFiModes()`, `xTaskCreatePinnedToCore()` gọi Core1Task.
  - *Hàm `loop()`*: Định tuyến `server.handleClient()`, gọi `maintainMQTTConnection()`, và chu kỳ quét `evaluateDeltaThresholds()` mỗi 5000ms.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. **Kiểm soát nghẽn mạng:** Quá trình đàm phán kết nối WiFi và MQTT phải sử dụng State-machine không chặn. Không được phép xuất hiện vòng lặp `while(!connected)` chứa hàm `delay()` làm đóng băng Core 0 khiến Webserver không phản hồi.
2. **Kích thước Payload IoT:** Quá trình tạo Delta JSON phải sử dụng `StaticJsonDocument` cấp phát trên Stack với kích thước xác định (vd: 512 bytes), tuyệt đối không dùng `DynamicJsonDocument` để bảo vệ Heap memory.
3. **Bảo mật truyền thông:** Tất cả các bản tin đẩy lên topic `telemetry` chỉ được phép ở dạng Base64, không bao giờ gửi bản rõ JSON trực tiếp ra internet (trừ các request API nội bộ của WebServer Local).