# Sprint 3: Triển khai TelemetryModule & Quy trình Khép kín (Closed-loop Fail-Safe)

Sprint này tập trung vào xử lý dữ liệu thời gian thực. Triển khai tiếp nhận telemetry cảm biến từ thiết bị qua MQTT, chuyển đổi múi giờ sang UTC+7 để kiểm tra quy tắc cấm phun sương buổi trưa, thực hiện tính toán thiết bị chấp hành, lưu trữ dữ liệu vào TimescaleDB, và dispatch lệnh điều khiển (setpoints). Quy trình được thiết kế với cơ chế Bio-safety Fail-Safe để đảm bảo hệ thống luôn gửi lệnh điều khiển an toàn ngay cả khi cơ sở dữ liệu sập.

---

## 1. PHẠM VI & MỤC TIÊU

- **Module tác động trực tiếp**:
  - `src/telemetry/telemetry.module.ts` (Tạo mới)
  - `src/telemetry/entities/telemetry-log.entity.ts` (Tạo mới)
  - `src/telemetry/services/telemetry.service.ts` (Tạo mới)
  - `src/mqtt/mqtt.service.ts` (Sửa đổi)
- **Mục tiêu**:
  - Tạo thực thể `TelemetryLog` ánh xạ bảng hypertable `telemetry_logs` mà không tự động đồng bộ schema.
  - Xây dựng lõi điều khiển vòng lặp khép kín trong `TelemetryService.processTelemetry` được bảo vệ bằng cấu trúc `try/catch/finally`.
  - Thực hiện chuẩn hóa múi giờ Việt Nam (UTC+7 / `Asia/Ho_Chi_Minh`) cho logic khóa cấm phun sương giờ trưa (11:00 - 13:30).
  - Tích hợp luồng MQTT để định tuyến tin nhắn cảm biến và đẩy setpoints về phần cứng.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
  [ESP32 cảm biến] ──► (MQTT: .../telemetry) ──► [mqtt.service.ts]
                                                      │
                                                      ▼ (Định tuyến)
                                            [telemetry.service.ts]
                                                      │
                                           ┌──────────┴──────────┐
                                           ▼ (Khối TRY)          ▼ (Khối CATCH - Sự cố DB)
                                   [1. Lấy BatchContext]       [Ghi nhận log lỗi]
                                   [2. Đổi timezone UTC+7]     [Kích hoạt FALLBACK khẩn cấp]
                                   [3. Tính toán PWM thiết bị] [mist_generator_pwm = 0]
                                   [4. Lưu TimescaleDB]        [convection_fan_pwm = 10]
                                           │                   [heating_lamp_active = false]
                                           │                                 │
                                           └──────────┬──────────────────────┘
                                                      │
                                                      ▼ (Khối FINALLY - Bắt buộc chạy)
                                            [mqtt.service.ts: dispatchSetpoint]
                                                      │
                                                      ▼ (MQTT: .../setpoint) ──► [ESP32 cơ cấu]
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Tầng Thực Thể Cơ Sở Dữ Liệu (Entities Track)

#### Task 3.1: Tạo thực thể TelemetryLog ánh xạ bảng hypertable
- **Tên tệp tạo mới**: [telemetry-log.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/entities/telemetry-log.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `TelemetryLog` với decorator `@Entity('telemetry_logs', { synchronize: false })`.
  - Mapped các thuộc tính:
    - `@PrimaryColumn({ type: 'timestamptz' }) time: Date` (TimescaleDB yêu cầu cột thời gian làm khóa chính/khóa phân mảnh).
    - `@Column() batch_id: string`, `@Column() house_id: string`, `@Column() crop_day_int: number`.
    - `@Column('numeric') humidity_measured: number`, `@Column('numeric') temperature_measured: number`, `@Column() co2_measured: number`.
    - `@Column('numeric') humidity_setpoint: number`, `@Column('numeric') temperature_setpoint: number`.
    - `@Column('numeric') humidity_error_delta: number`, `@Column('numeric') temperature_error_delta: number`.
    - `@Column() mist_generator_pwm: number`, `@Column() convection_fan_pwm: number`, `@Column() heating_lamp_active: boolean`, `@Column() midday_blackout_active: boolean`.

---

### TRACK 2: Tầng Nghiệp Vụ & Điều Khiển (Business Logic & Control Track)

#### Task 3.2: Triển khai phương thức processTelemetry và xử lý Bio-safety
- **Tên tệp tạo mới**: [telemetry.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/services/telemetry.service.ts)
- **Hành động cụ thể**:
  - Viết phương thức `processTelemetry(houseId: string, measurements: any, timestamp: Date): Promise<void>`:
    1. Khởi tạo giá trị mặc định cho lệnh điều khiển:
       `let controlActions = { mist_generator_pwm: 0, convection_fan_pwm: 10, heating_lamp_active: false, midday_blackout_active: false };`
    2. Cấu trúc `try`:
       - Gọi `batchService.getBatchContext(houseId, timestamp)` để nhận thông tin mục tiêu (setpoints).
       - Gọi `calculateControlOutputs(measurements, batchContext, timestamp)` để tính các giá trị điều chế thiết bị.
       - Gọi `saveTelemetryLog(...)` để thực hiện INSERT SQL ghi nhận thông tin.
    3. Cấu trúc `catch (error)`:
       - Log lỗi thông báo hệ thống sập cơ sở dữ liệu hoặc lỗi tính toán: `this.logger.error('Control loop failed, routing emergency fallback. Error: ' + error.message)`.
       - Ghi đè lại biến `controlActions` về cấu hình fallback khẩn cấp:
         `controlActions = { mist_generator_pwm: 0, convection_fan_pwm: 10, heating_lamp_active: false, midday_blackout_active: false };`
    4. Cấu trúc `finally`:
       - Gọi `mqttService.dispatchSetpoint(houseId, controlActions)` để cam kết gửi lệnh điều khiển xuống tủ thiết bị ngoại vi bất luận cơ sở dữ liệu có ghi được hay không.

#### Task 3.3: Triển khai logic tính toán điều khiển và múi giờ Việt Nam
- **Tên tệp tạo mới**: [telemetry.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/services/telemetry.service.ts)
- **Hành động cụ thể**:
  - Viết phương thức `calculateControlOutputs(measurements: any, batchContext: any, timestamp: Date)`:
    - Trích xuất thông tin cảm biến: `temp = measurements.temperature`, `humid = measurements.humidity`.
    - Lấy biên độ thiết lập từ `batchContext`: `targetTemp`, `targetHumid`.
    - Tính toán chênh lệch: `tempError = targetTemp - temp`, `humidError = targetHumid - humid`.
    - **Kiểm tra khóa cấm tưới sốc nhiệt (Midday Blackout)**:
      - Sử dụng `utcToZonedTime` từ `date-fns-tz` để chuyển đổi đối tượng `timestamp` sang múi giờ `'Asia/Ho_Chi_Minh'`.
      - Trích xuất giờ và phút: `const hours = zonedDate.getHours()`, `const minutes = zonedDate.getMinutes()`.
      - Chuyển thành số phút trong ngày: `const minutesSinceMidnight = hours * 60 + minutes`.
      - Parse khung giờ cấm tưới từ `batchContext` (Ví dụ: `11:00:00` -> `660` phút; `13:30:00` -> `810` phút).
      - Nếu `batchContext.thermal_shock_protection === true` và `minutesSinceMidnight` nằm trong khoảng cấm:
        - Đặt `mist_generator_pwm = 0`.
        - Đặt `midday_blackout_active = true`.
      - Nếu ngoài khoảng cấm hoặc tính năng bảo vệ tắt:
        - Tính toán phun sương: Nếu thiếu ẩm (`humidError > 0`), tỷ lệ hóa công suất máy siêu âm (`mist_generator_pwm = Math.min(100, Math.max(0, Math.round(humidError * 5)))`). Ngược lại đặt `0`.
        - Đặt `midday_blackout_active = false`.
    - **Tính toán quạt đối lưu (`convection_fan_pwm`)**:
      - Chạy tuần hoàn tối thiểu 10% để giữ thông thoáng khí CO2.
      - Tăng tốc lên 30% - 50% nếu chênh lệch nhiệt độ cao để cân bằng môi trường.
    - **Tính toán đèn sưởi (`heating_lamp_active`)**:
      - Bật `true` nếu nhiệt độ đo được nhỏ hơn nhiệt độ tối ưu tối thiểu (`temp < batchContext.temp_optimal_min`).

#### Task 3.4: Triển khai ghi log và truy vấn dữ liệu
- **Tên tệp tạo mới**: [telemetry.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/services/telemetry.service.ts)
- **Hành động cụ thể**:
  - Viết phương thức `saveTelemetryLog(houseId, measurements, controlActions, timestamp)`: Thực hiện truy vấn `INSERT` thô vào bảng `telemetry_logs` sử dụng `DatabaseService.query()`.
  - Viết phương thức `getLatestTelemetry(houseId)` và `getBatchHistory(batchId, startTime, endTime)` để hỗ trợ các API hiển thị đồ thị và dashboard.

---

### TRACK 3: Tầng Tích Hợp MQTT (MQTT Integration Track)

#### Task 3.5: Cập nhật MqttService để định tuyến telemetry và dispatch setpoints
- **Tên file sửa đổi**: [mqtt.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts)
- **Hành động cụ thể**:
  - Tại hàm `onModuleInit()`: Đăng ký subscribe thêm topic telemetry `mushroom/device/+/telemetry` với QoS 1.
  - Tại hàm `handleIncomingMessage(topic, payload)`:
    - Phân tích cú pháp topic để trích xuất `deviceId` (houseId) và phân loại sự kiện.
    - Nếu là topic `/telemetry`: Parse payload sang JSON và gọi `TelemetryService.processTelemetry(deviceId, parsedPayload, new Date())`.
  - Viết phương thức `dispatchSetpoint(houseId: string, controlPayload: any): void`:
    - Tạo topic: `mushroom/device/${houseId}/setpoint`.
    - Thực hiện `this.client.publish(topic, JSON.stringify(controlPayload), { qos: 1 })`.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Cam kết khối Finally**: Block `finally` trong `processTelemetry` phải được kiểm thử nghiêm ngặt. Dù có bất kỳ ngoại lệ nào xảy ra ở phần kết nối cơ sở dữ liệu, luồng MQTT publish setpoint an toàn khẩn cấp vẫn phải được kích hoạt và truyền tải thành công.
2. **Khớp múi giờ độc lập máy chủ**: Phép thử logic cấm phun sương buổi trưa phải trả về kết quả đúng đắn bất kể múi giờ hệ thống cục bộ (Node.js) là UTC+0, UTC+7 hay EST.
3. **Cú pháp Entity không đồng bộ hóa**: Tránh thiết lập `synchronize: true` trên Hypertable `telemetry_logs`. TypeORM sẽ tạo ra các xung đột nghiêm trọng với cấu trúc phân mảnh đặc thù của TimescaleDB.
4. **Log chi tiết lỗi**: Mọi sự cố trong vòng lặp catch phải được log chi tiết dạng `error` kèm stacktrace để Devops dễ dàng truy vết nguyên nhân sập pool hoặc nghẽn mạng DB.
