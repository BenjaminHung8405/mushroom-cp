# Sprint 3: Telemetry Module & Closed-Loop Fail-Safe — ❌ CHƯA BẮT ĐẦU

> **Status**: `[ ] Pending` — Đây là sprint tiếp theo cần implement. Blocker: Sprint 2 cần QA pass trước khi test end-to-end.
> Có thể bắt đầu implement song song trong khi Sprint 2 đang QA Review.

---

## 1. MỤC TIÊU & PHẠM VI

Triển khai lõi xử lý dữ liệu thời gian thực. Nhận telemetry từ ESP32 qua MQTT, chạy vòng lặp điều khiển khép kín (closed-loop): tính PWM cho cơ cấu chấp hành, lưu vào TimescaleDB, dispatch setpoints về phần cứng. Bảo vệ toàn bộ bằng Bio-safety Fail-Safe `try/catch/finally`.

**Prerequisite**:
- ✅ Sprint 1: `DatabaseService.query()` sẵn sàng
- ⏳ Sprint 2: `BatchService.getBatchContext()` cần QA pass
- ✅ EMQX ACL: `nestjs_backend` đã có quyền subscribe `mushroom/#`

**Files cần tạo/sửa:**

| File | Action |
|---|---|
| [`src/mqtt/mqtt.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts) | Sửa đổi — thêm subscribe telemetry + `dispatchSetpoint()` |
| `src/telemetry/entities/telemetry-log.entity.ts` | Tạo mới |
| `src/telemetry/services/telemetry.service.ts` | Tạo mới |
| `src/telemetry/telemetry.module.ts` | Tạo mới |
| `src/telemetry/telemetry.controller.ts` | Tạo mới |

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[ESP32 cảm biến]
     │
     │ MQTT: mushroom/device/{houseId}/telemetry
     │ Payload: { "temp_air": 28.5, "temp_substrate": 30.1, "humidity_air": 82.3, "co2_level": 950 }
     ▼
[mqtt.service.ts] ──subscribe──► handleIncomingMessage()
     │
     │ route telemetry topic
     ▼
[telemetry.service.ts: processTelemetry(houseId, measurements, timestamp)]
     │
     │ try block:
     ├──► [1] batchService.getBatchContext(houseId, timestamp)  ──► BatchContext
     ├──► [2] calculateControlOutputs(measurements, context, timestamp) ──► ControlActions
     │         │
     │         ├── Kiểm tra midday blackout (UTC+7 via date-fns-tz)
     │         ├── Tính mist_generator_pwm (proportional humidity control)
     │         ├── Tính convection_fan_pwm (CO2 + temp balance)
     │         └── Tính heating_lamp_active (temp < optimal_min)
     ├──► [3] saveTelemetryLog(houseId, measurements, context, controlActions, timestamp)
     │         └── DatabaseService.query() → INSERT telemetry_logs (raw SQL)
     │
     │ catch(error):
     ├──► Logger.error(message + stacktrace)
     └──► controlActions = EMERGENCY_FALLBACK (mist=0, fan=10, lamp=false)
     │
     │ finally (BẮT BUỘC, luôn chạy):
     └──► mqttService.dispatchSetpoint(houseId, controlActions)
               │
               │ MQTT: mushroom/device/{houseId}/setpoint
               ▼
         [ESP32 cơ cấu chấp hành] → Điều khiển Relay/PWM
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1 — MQTT Integration (H1)

#### Task 3.1 — Cập nhật `mqtt.service.ts`

**File sửa đổi**: [`src/mqtt/mqtt.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts)

**Hành động cụ thể**:

1. **Rename + mở rộng `subscribeToStatusTopics()`** → `subscribeToTopics()`:
   - Giữ nguyên subscribe `mushroom/device/+/status` (QoS 1)
   - Thêm subscribe `mushroom/device/+/telemetry` (QoS 1):
   ```typescript
   this.client.subscribe('mushroom/device/+/telemetry', { qos: 1 }, (err) => { ... });
   ```

2. **Thêm `Subject<TelemetryEvent>` public stream**:
   ```typescript
   export interface TelemetryEvent {
     deviceId: string;
     temp_air: number | null;
     temp_substrate: number | null;
     humidity_air: number | null;
     co2_level: number | null;
     timestamp: string;  // ISO string
   }
   public readonly telemetry$ = new Subject<TelemetryEvent>();
   private readonly telemetryCache = new Map<string, TelemetryEvent>();
   ```

3. **Cập nhật `handleIncomingMessage()`** — thêm routing cho telemetry:
   ```typescript
   // Phân loại topic theo segment thứ 4
   const eventType = topicParts[3]; // 'status' hoặc 'telemetry'
   if (eventType === 'status') { /* logic hiện tại */ }
   if (eventType === 'telemetry') { this.handleTelemetryMessage(deviceId, payload); }
   ```

4. **Thêm method `handleTelemetryMessage(deviceId, payload)`** (private):
   - Parse JSON payload
   - Validate numeric fields (null-safe)
   - Tạo `TelemetryEvent`, update `telemetryCache`, emit `telemetry$.next(event)`

5. **Thêm method `dispatchSetpoint(houseId, controlPayload)`**:
   ```typescript
   dispatchSetpoint(houseId: string, controlPayload: object): void {
     const topic = `mushroom/device/${houseId}/setpoint`;
     this.client.publish(topic, JSON.stringify(controlPayload), { qos: 1 }, ...);
   }
   ```

6. **Thêm `getAllTelemetry()`**: Trả về `telemetryCache` values — dùng để seed SSE client mới kết nối.

> ⚠️ **Tránh Circular Dependency**: `MqttService` **KHÔNG** inject `TelemetryService` trực tiếp. Thay vào đó: `MqttService` emit `telemetry$` Subject. `TelemetryService` subscribe Subject này trong `onModuleInit()`. Pattern này đảm bảo dependency graph là một chiều.

---

### TRACK 2 — DB Entity (F1)

#### Task 3.2 — Tạo `telemetry-log.entity.ts`

**File tạo mới**: `src/telemetry/entities/telemetry-log.entity.ts`

**Hành động cụ thể**:
```typescript
@Entity('telemetry_logs', { synchronize: false })  // KHÔNG để TypeORM sync hypertable
export class TelemetryLog {
  @PrimaryColumn({ type: 'timestamptz', name: 'time' })
  time: Date;

  @PrimaryColumn({ name: 'batch_id' })
  batchId: string;

  @Column({ name: 'house_id' })
  houseId: string;

  @Column({ name: 'crop_day_int' })
  cropDayInt: number;

  // Sensor measurements (nullable — có thể thiếu nếu sensor lỗi)
  @Column('numeric', { nullable: true, transformer: numericTransformer })
  humidityMeasured: number | null;

  @Column('numeric', { nullable: true, transformer: numericTransformer })
  temperatureMeasured: number | null;

  @Column({ nullable: true })
  co2Measured: number | null;

  // Control setpoints
  @Column('numeric', { nullable: true, transformer: numericTransformer })
  humiditySetpoint: number | null;

  @Column('numeric', { nullable: true, transformer: numericTransformer })
  temperatureSetpoint: number | null;

  // Error deltas
  @Column('numeric', { nullable: true, transformer: numericTransformer })
  humidityErrorDelta: number | null;

  @Column('numeric', { nullable: true, transformer: numericTransformer })
  temperatureErrorDelta: number | null;

  // Actuator outputs
  @Column({ nullable: true })
  mistGeneratorPwm: number | null;

  @Column({ nullable: true })
  convectionFanPwm: number | null;

  @Column({ default: false })
  heatingLampActive: boolean;

  @Column({ default: false })
  middayBlackoutActive: boolean;
}
```

> ⚠️ `synchronize: false` là bắt buộc — tránh TypeORM tạo bảng thường đè lên TimescaleDB hypertable.
> Composite Primary Key (`time` + `batch_id`) tương thích cơ chế phân mảnh chunk của TimescaleDB.

---

### TRACK 3 — Business Logic (G1, G2, G3)

#### Task 3.3 — Tạo `telemetry.service.ts`

**File tạo mới**: `src/telemetry/services/telemetry.service.ts`

**Constructor dependencies**:
```typescript
constructor(
  private readonly mqttService: MqttService,
  private readonly batchService: BatchService,
  private readonly db: DatabaseService,
) {}
```

**`onModuleInit()`** — Subscribe MQTT telemetry stream:
```typescript
onModuleInit(): void {
  this.mqttService.telemetry$.subscribe(async (event) => {
    await this.processTelemetry(event.deviceId, event, new Date(event.timestamp));
  });
}
```

**`processTelemetry(houseId, measurements, timestamp)`** — Lõi closed-loop:
```typescript
async processTelemetry(houseId: string, measurements: TelemetryEvent, timestamp: Date): Promise<void> {
  // Khởi tạo fallback an toàn
  let controlActions: ControlActions = {
    mist_generator_pwm: 0,
    convection_fan_pwm: 10,
    heating_lamp_active: false,
    midday_blackout_active: false,
  };

  try {
    const context = await this.batchService.getBatchContext(houseId, timestamp);
    controlActions = this.calculateControlOutputs(measurements, context, timestamp);
    await this.saveTelemetryLog(houseId, measurements, context, controlActions, timestamp);
    this.updateLatestCache(houseId, measurements, context, controlActions, timestamp);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    this.logger.error(`Control loop failed for house '${houseId}'. Emergency fallback. Error: ${msg}`, (error as Error)?.stack);
    // controlActions giữ nguyên giá trị fallback khẩn cấp
  } finally {
    // BẮT BUỘC: gửi setpoint bất kể DB thành công hay thất bại
    this.mqttService.dispatchSetpoint(houseId, controlActions);
  }
}
```

**`calculateControlOutputs(measurements, context, timestamp)`** (private):
- Lấy sensors: `temp = measurements.temp_air`, `humid = measurements.humidity_air`
- **Midday Blackout** (UTC+7):
  ```typescript
  const zonedDate = toZonedTime(timestamp, 'Asia/Ho_Chi_Minh');
  const minutesSinceMidnight = zonedDate.getHours() * 60 + zonedDate.getMinutes();
  const startMin = parseTimeToMinutes(context.thermalShockStart); // e.g., "11:00:00" → 660
  const endMin = parseTimeToMinutes(context.thermalShockEnd);     // e.g., "13:30:00" → 810
  const isBlackout = context.thermalShockProtection && minutesSinceMidnight >= startMin && minutesSinceMidnight <= endMin;
  ```
- **Mist PWM**: Nếu blackout → `0`. Nếu thiếu ẩm (`humid < targetHumid`) → `Math.min(100, Math.round((targetHumid - humid) * 5))`. Nếu đủ → `0`
- **Fan PWM**: Baseline `10`% + tăng nếu lệch nhiệt độ lớn (max `50`%)
- **Heating Lamp**: `temp < context.tempOptimalMin` → `true`

**`saveTelemetryLog(...)` (private)** — Raw SQL INSERT:
- Sử dụng `DatabaseService.query()` với INSERT SQL thô (không qua ORM)
- Tái sử dụng query string từ `TelemetryQueryService` hiện có (legacy reference)
- Tính `humidityErrorDelta = targetHumid - humid`, `temperatureErrorDelta = targetTemp - temp`

**`getLatestTelemetry(houseId)`** — public:
- Đọc từ in-memory `latestCache` Map trước (sub-millisecond)
- Fallback: `DatabaseService.query()` SELECT ORDER BY time DESC LIMIT 1

**`getTelemetryHistory(houseId, from, to)`** — public:
- Raw SQL với `time BETWEEN $2 AND $3`, ORDER BY time ASC
- Dùng cho chart endpoint

**`latestCache: Map<string, CombinedTelemetrySnapshot>`** — in-memory:
- Update sau mỗi `processTelemetry()` thành công
- Seed dữ liệu ban đầu khi SSE client mới kết nối

---

### TRACK 4 — Controller & SSE (G3 mở rộng)

#### Task 3.4 — Tạo `telemetry.controller.ts`

**File tạo mới**: `src/telemetry/telemetry.controller.ts`

```typescript
@Controller('devices')
export class TelemetryController {
  // GET /devices/:id/telemetry — last known snapshot
  @Get(':id/telemetry')
  getLatestTelemetry(@Param() params: DeviceParamsDto) { ... }

  // SSE /devices/:id/telemetry/stream — real-time stream
  @Sse(':id/telemetry/stream')
  streamTelemetry(@Param() params: DeviceParamsDto): Observable<MessageEvent> {
    const seed$ = of(this.telemetryService.getLatestTelemetry(params.id));
    const live$ = this.mqttService.telemetry$.pipe(
      filter(event => event.deviceId === params.id)
    );
    return merge(seed$, live$).pipe(
      map(data => ({ type: 'telemetry', data }) satisfies MessageEvent)
    );
  }

  // GET /devices/:id/telemetry/history?from=&to= — time-series for chart
  @Get(':id/telemetry/history')
  getTelemetryHistory(
    @Param() params: DeviceParamsDto,
    @Query('from') from: string,
    @Query('to') to: string,
  ) { ... }
}
```

---

### TRACK 5 — Module Setup

#### Task 3.5 — Tạo `telemetry.module.ts`

```typescript
@Module({
  imports: [MqttModule, BatchModule],  // BatchModule export BatchService
  providers: [TelemetryService],
  controllers: [TelemetryController],
  exports: [TelemetryService],
})
export class TelemetryModule {}
```

> `BatchModule` export `BatchService` → `TelemetryService` inject được.
> `MqttModule` export `MqttService` → `TelemetryService` subscribe `telemetry$`.
> `DatabaseService` inject được qua `@Global() DatabaseModule`.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

| # | Tiêu chí | Mô tả |
|---|---|---|
| 1 | **`finally` luôn dispatch** | Dù DB fail hay tính toán throw, `dispatchSetpoint()` phải được gọi với emergency payload |
| 2 | **Timezone độc lập server** | Kiểm tra logic blackout khi `TZ=UTC` trên server → kết quả midday (11:00–13:30 VN) phải đúng |
| 3 | **`synchronize: false` trên entity** | Entity `TelemetryLog` không được có `synchronize: true` bất kể môi trường nào |
| 4 | **Không circular dependency** | `MqttService` không import `TelemetryService`. Dùng Subject pattern |
| 5 | **Log lỗi có stacktrace** | `Logger.error(message, stack)` — không để silent catch |
| 6 | **Null-safe sensor fields** | Sensor có thể null (lỗi phần cứng) → không crash khi tính toán |
| 7 | **SSE seed đúng** | Client mới connect vào `/telemetry/stream` phải nhận được snapshot hiện tại ngay lập tức |

---

## 5. PHÂN CÔNG & DEPENDENCY MAP

```
Sprint 1 (Done) ──────────────────────────────────────────────┐
                                                               │
Sprint 2 (QA)   ──► BatchService.getBatchContext() ──────────►│
                                                               │
                                                         Sprint 3 (THIS)
                                                               │
                    ┌──────────────────────────────────────────┘
                    │
          ┌─────────┼──────────────┐
          ▼         ▼              ▼
  mqtt.service  telemetry      telemetry
  (modified)    .service       .controller
                    │
                    ▼
             Sprint 4 (Next)
           SimulationService
        (dùng TelemetryService)
```

---

## 6. CHECKLIST TRIỂN KHAI

- [ ] **H1**: Cập nhật `mqtt.service.ts` — subscribe telemetry, `dispatchSetpoint()`, `telemetry$` Subject
- [ ] **F1**: Tạo `telemetry-log.entity.ts` — `synchronize: false`, composite key
- [ ] **G1**: Tạo `telemetry.service.ts` — `processTelemetry()` với try/catch/finally
- [ ] **G2**: Implement `calculateControlOutputs()` — midday blackout + PWM logic
- [ ] **G3**: Implement `saveTelemetryLog()` + `getLatestTelemetry()` + `getTelemetryHistory()`
- [ ] **G4**: Tạo `telemetry.controller.ts` — GET, SSE, History endpoints
- [ ] **G5**: Tạo `telemetry.module.ts` — wire dependencies
- [ ] **G6**: Verify `pnpm lint && pnpm build && pnpm test`
