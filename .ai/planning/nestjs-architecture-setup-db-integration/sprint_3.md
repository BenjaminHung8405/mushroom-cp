# Sprint 3: Telemetry, ON/OFF Control, System Integration & Cleanup — ❌ CHƯA BẮT ĐẦU

> **Status**: `[ ] Pending` — Đây là sprint tiếp theo cần implement.
> **Scope**: Tích hợp dữ liệu thời gian thực từ cảm biến SHT30 (nhiệt độ & độ ẩm) và SCD30 (CO2), chạy vòng điều khiển ON/OFF khép kín (ON/OFF Control Loop), bảo vệ thiết bị bằng cơ chế An toàn Sinh học (Bio-safety Fail-Safe), dọn dẹp code cũ và tích hợp toàn hệ thống vào AppModule.

---

## 1. MỤC TIÊU & PHẠM VI

1. **SHT30 làm cảm biến chính**: Loại bỏ hoàn toàn cảm biến phụ DS18B20. SHT30 sẽ chịu trách nhiệm đo cả nhiệt độ không khí (`temperature_measured`) và độ ẩm không khí (`humidity_measured`).
2. **Điều khiển ON/OFF (Không dùng PWM)**: Thay thế toàn bộ PWM bằng các trạng thái bật/tắt (boolean: `true`/`false`) cho máy phun sương siêu âm (`mist_generator_active`) và quạt đối lưu (`convection_fan_active`).
3. **Cơ chế Idle Guard & Emergency Fallback**:
   - **Idle Guard**: Khi nhà nấm trống (không có vụ nuôi `ACTIVE`), tắt toàn bộ thiết bị chấp hành để tiết kiệm năng lượng.
   - **Emergency Fallback**: Khi xảy ra lỗi hệ thống/DB đột ngột trong lúc nuôi, tự động gán trạng thái an toàn khẩn cấp (`mist = false`, `fan = true`, `lamp = false`) để cứu nấm.
4. **Hủy rò rỉ bộ nhớ**: Tránh rò rỉ bộ nhớ RxJS bằng cách triển khai `OnModuleDestroy` trong `TelemetryService`.
5. **Dọn dẹp & Tích hợp**: Xóa bỏ `TelemetryQueryService` cũ, wire toàn bộ hệ thống vào `AppModule`.

**Các file tạo/sửa:**

| File | Action | Description |
|---|---|---|
| [`src/mqtt/mqtt.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts) | Sửa đổi | Subscribe topic telemetry SHT30, emit qua Subject và gửi lệnh setpoint ON/OFF |
| `src/telemetry/entities/telemetry-log.entity.ts` | Tạo mới | Entity ánh xạ bảng `telemetry_logs` hypertable với các cột ON/OFF mới |
| `src/telemetry/services/telemetry.service.ts` | Tạo mới | Closed-loop ON/OFF control, xử lý Midday Blackout, Idle Guard và Fail-safe |
| `src/telemetry/telemetry.controller.ts` | Tạo mới | Controller cho endpoints REST API & SSE live stream |
| `src/telemetry/telemetry.module.ts` | Tạo mới | Module wire các thành phần Telemetry |
| `src/database/database.module.ts` | Sửa đổi | Loại bỏ legacy `TelemetryQueryService` |
| `src/database/telemetry-query.service.ts` | Xóa | Xóa bỏ hoàn toàn code query cũ |
| `src/app.module.ts` | Sửa đổi | Đăng ký `BatchModule` và `TelemetryModule` vào luồng ứng dụng chính |

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[SHT30 / SCD30 Cảm biến trên ESP32]
      │
      │ MQTT: mushroom/device/{houseId}/telemetry
      │ Payload: { "temp_air": 28.5, "humidity_air": 82.3, "co2_level": 950 }
      ▼
[mqtt.service.ts] ──subscribe──► handleIncomingMessage() ──emit──► telemetry$ Subject
      │
      ▼
[telemetry.service.ts: processTelemetry(houseId, event, timestamp)]
      │
      │ try block:
      ├──► [1] batchService.getBatchContext(houseId, timestamp)  ──► BatchContext
      │
      ├──► [2] calculateControlOutputs(event, context, timestamp) ──► ControlActions
      │         │
      │         ├── Idle Guard: Nếu context.batchId === null (nhà trống) → tắt tất cả thiết bị (false)
      │         ├── Kiểm tra midday blackout (UTC+7 qua date-fns-tz)
      │         ├── Mist Active: !blackout && humidity_measured < target_humid
      │         ├── Fan Active: temp_air > target_temp || co2_level > 1000
      │         └── Heating Lamp Active: temp_air < temp_optimal_min
      │
      ├──► [3] saveTelemetryLog(houseId, event, context, controlActions, timestamp)
      │         └── Raw SQL INSERT thô qua DatabaseService.query()
      │
      │ catch(error):
      ├──► Logger.error(error.stack)
      └──► controlActions = EMERGENCY_FALLBACK (mist=false, fan=true, lamp=false)
      │
      │ finally:
      └──► mqttService.dispatchSetpoint(houseId, controlActions) (Bọc trong try/catch an toàn)
                │
                ▼ MQTT: mushroom/device/{houseId}/setpoint
          [ESP32 điều khiển Relay Bật/Tắt]
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1 — MQTT Integration (H1)

#### Task 3.1 — Cập nhật `mqtt.service.ts`
- **Topic Telemetry**: Subscribe `mushroom/device/+/telemetry` QoS 1.
- **Subject Stream**: Khai báo `telemetry$` nhận `TelemetryEvent`:
  ```typescript
  export interface TelemetryEvent {
    deviceId: string;
    temp_air: number | null;     // Nhiệt độ không khí từ SHT30
    humidity_air: number | null; // Độ ẩm không khí từ SHT30
    co2_level: number | null;    // CO2 từ SCD30
    timestamp: string;           // ISO string
  }
  public readonly telemetry$ = new Subject<TelemetryEvent>();
  ```
- **Error Handling**: Wrap logic JSON parsing của tin nhắn đến trong block `try/catch`. Nếu parse lỗi hoặc format sai, chỉ ghi log cảnh báo (`this.logger.warn`) thay vì ném exception gây crash MQTT client.
- **`dispatchSetpoint(houseId, controlPayload)`**: Publish lệnh trạng thái ON/OFF:
  ```typescript
  dispatchSetpoint(houseId: string, payload: {
    mist_generator_active: boolean;
    convection_fan_active: boolean;
    heating_lamp_active: boolean;
    midday_blackout_active: boolean;
  }): void {
    const topic = `mushroom/device/${houseId}/setpoint`;
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
  }
  ```

---

### TRACK 2 — DB Entity & Migrations (F1)

#### Task 3.2 — Tạo `telemetry-log.entity.ts`
- **File tạo mới**: `src/telemetry/entities/telemetry-log.entity.ts`
- Định nghĩa schema trùng khớp với `schema.sql` (sử dụng kiểu `boolean` cho các actuator):
  ```typescript
  @Entity('telemetry_logs', { synchronize: false })
  export class TelemetryLog {
    @PrimaryColumn({ type: 'timestamptz', name: 'time' })
    time: Date;

    @PrimaryColumn({ name: 'batch_id' })
    batchId: string;

    @Column({ name: 'house_id' })
    houseId: string;

    @Column({ name: 'crop_day_int' })
    cropDayInt: number;

    @Column('numeric', { name: 'humidity_measured', nullable: true, transformer: numericTransformer })
    humidityMeasured: number | null;

    @Column('numeric', { name: 'temperature_measured', nullable: true, transformer: numericTransformer })
    temperatureMeasured: number | null;

    @Column({ name: 'co2_measured', nullable: true })
    co2Measured: number | null;

    @Column('numeric', { name: 'humidity_setpoint', nullable: true, transformer: numericTransformer })
    humiditySetpoint: number | null;

    @Column('numeric', { name: 'temperature_setpoint', nullable: true, transformer: numericTransformer })
    temperatureSetpoint: number | null;

    @Column('numeric', { name: 'humidity_error_delta', nullable: true, transformer: numericTransformer })
    humidityErrorDelta: number | null;

    @Column('numeric', { name: 'temperature_error_delta', nullable: true, transformer: numericTransformer })
    temperatureErrorDelta: number | null;

    @Column({ name: 'mist_generator_active', default: false })
    mistGeneratorActive: boolean;

    @Column({ name: 'convection_fan_active', default: false })
    convectionFanActive: boolean;

    @Column({ name: 'heating_lamp_active', default: false })
    heatingLampActive: boolean;

    @Column({ name: 'midday_blackout_active', default: false })
    middayBlackoutActive: boolean;
  }
  ```

---

### TRACK 3 — Business Control Loop (G1, G2, G3)

#### Task 3.3 — Tạo `telemetry.service.ts`
- **RxJS Vòng đời**: Subscribe `mqttService.telemetry$` trong `onModuleInit()`. Bắt buộc implement `onModuleDestroy()` để `unsubscribe()` các luồng nhằm tránh rò rỉ bộ nhớ khi chạy thử nghiệm hoặc Hot Reload.
- **`processTelemetry`**: Lõi try-catch-finally khép kín:
  - **Idle Guard**: Kiểm tra nếu `context.batchId === null` (nhà trống) → lập tức set `controlActions` về trạng thái IDLE (tắt toàn bộ thiết bị) và lưu log, bỏ qua tính toán vòng lặp sinh học.
  - **Emergency Fallback (catch)**: Nếu CSDL bị sập hoặc lỗi logic, bắt exception, log chi tiết kèm stacktrace, và tự động đặt `controlActions` về an toàn khẩn cấp (`mist = false`, `fan = true`, `lamp = false`).
  - **Finally dispatch**: Luôn thực hiện `dispatchSetpoint()`. Bao bọc lời gọi này trong một khối `try/catch` con để ngăn cản việc lỗi gửi MQTT làm nuốt mất exception gốc của khối `try` chính.
- **`calculateControlOutputs` (ON/OFF Logic)**:
  - **Khóa sốc nhiệt giữa trưa (UTC+7)**: Kiểm tra nếu `thermalShockProtection === true` và thời gian thuộc `[11:00, 13:30]` → bật cờ `midday_blackout_active = true`.
  - **Mist Generator**: Nếu blackout → `false`. Nếu thiếu ẩm (`humidityMeasured < targetHumid`) → `true`. Ngược lại → `false`.
  - **Convection Fan**: Nếu `temperatureMeasured > targetTemp` hoặc `co2Measured > 1000` → `true`. Ngược lại → `false`.
  - **Heating Lamp**: Nếu `temperatureMeasured < tempOptimalMin` → `true`. Ngược lại → `false`.

---

### TRACK 4 — REST, SSE & History API (G4, G5)

#### Task 3.4 — Tạo `telemetry.controller.ts` & Module
- **Endpoints**:
  - `GET /devices/:id/telemetry`: Lấy dữ liệu snapshot mới nhất từ in-memory cache.
  - `SSE /devices/:id/telemetry/stream`: Đẩy luồng dữ liệu thời gian thực. Sử dụng snapshot cache làm event đầu tiên (seed event) để giao diện UI hiển thị tức thì không bị trễ.
  - `GET /devices/:id/telemetry/history?from=&to=`: Truy xuất dữ liệu lịch sử thô phục vụ vẽ biểu đồ (sử dụng query SQL thô qua `DatabaseService.query()`).
- **Module**: Khởi tạo `TelemetryModule` đăng ký `TelemetryService` và `TelemetryController`. Export `TelemetryService`.

---

### TRACK 5 — Dọn Dẹp & Đồng Bộ Hệ Thống (G6, G7)

#### Task 3.5 — Xóa `TelemetryQueryService` cũ (J1)
- Xóa bỏ tệp tin legacy [`src/database/telemetry-query.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts).
- Clean `DatabaseModule`: gỡ bỏ các khai báo import/export và provider liên quan đến `TelemetryQueryService`.

#### Task 3.6 — Tích hợp hệ thống vào `AppModule` (J2)
- Cập nhật [`src/app.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/app.module.ts):
  - Import `BatchModule` (đã hoàn thành từ Sprint 2).
  - Import `TelemetryModule`.
- Chạy thử nghiệm toàn hệ thống để đảm bảo việc tiêm phụ thuộc (Dependency Injection) diễn ra suôn sẻ, không phát sinh lỗi Circular Dependency.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

| # | Tiêu chí rà soát | Hướng dẫn kiểm tra |
|---|---|---|
| 1 | **Không sử dụng DS18B20** | Kiểm tra toàn bộ mã nguồn không được chứa biến `temp_substrate`, chỉ dùng `temp_air` cho mọi tác vụ nhiệt độ. |
| 2 | **Chỉ dùng ON/OFF (Boolean)** | Mọi trạng thái gửi setpoint và ghi DB phải là kiểu `boolean` (`true`/`false`), không còn xuất hiện các dải số PWM từ 0 đến 100. |
| 3 | **Idle Guard hoạt động chuẩn** | Khi không có vụ nuôi ACTIVE, gửi tin MQTT lên → xem log setpoint gửi về ESP32 phải tắt hết toàn bộ (false). |
| 4 | **Bảo vệ rò rỉ RxJS** | Tệp `telemetry.service.ts` phải gọi `unsubscribe()` trong hook `onModuleDestroy`. |
| 5 | **Không nuốt lỗi trong Finally** | Lời gọi `mqttService.dispatchSetpoint()` trong khối `finally` phải được bọc trong try/catch con độc lập. |
| 6 | **Build và Test chạy thông suốt** | Lệnh `pnpm lint && pnpm build && pnpm test` phải hoàn thành thành công mà không có cảnh báo nghiêm trọng nào. |
