# Sprint 4: Simulation Module, Cleanup & System Integration — ❌ CHƯA BẮT ĐẦU

> **Status**: `[ ] Pending` — Bắt đầu sau khi Sprint 3 hoàn thành và QA pass.
> Sprint này không block MQTT pipeline production, có thể defer nếu cần deploy sớm.

---

## 1. MỤC TIÊU & PHẠM VI

Ba mục tiêu độc lập:
1. **Simulation Module**: Giả lập môi trường sinh học có tốc độ tua nhanh (fast-forward), tích hợp bulk insert để bảo vệ TimescaleDB hypertable chunks
2. **Cleanup**: Xóa `TelemetryQueryService` legacy, thay bằng `TelemetryService` chính thức
3. **System Integration**: Wire tất cả module mới vào `AppModule`

**Prerequisite**:
- ✅ Sprint 1: `DatabaseService` sẵn sàng
- ✅ Sprint 2: `BatchService.getBatchContext()` (hoặc `getFallbackContext()`)
- ✅ Sprint 3: `TelemetryService.processTelemetry()` hoạt động

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[POST /simulation/start { speedMultiplier: N }]
              │
              ▼
   [SimulationController] ──► [SimulationService]
                                      │
                          ┌───────────┴──────────────┐
                          ▼                           ▼
               speedMultiplier = 1x         speedMultiplier > 1x
                          │                           │
                          ▼                           ▼
          TelemetryService.processTelemetry()    bufferQueue.push(log)
          (real-time: 1 ghi/step, MQTT dispatch)        │
                                               (nếu size >= 100 OR 5s elapsed)
                                                         │
                                                         ▼
                                               DatabaseService.query(BULK INSERT)
                                               (1 SQL cho nhiều rows)
                                                         │
                                               [telemetry_logs hypertable]
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1 — Simulation Service (I1)

#### Task 4.1 — Tạo `simulation.service.ts`

**File tạo mới**: [`src/simulation/services/simulation.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/services/simulation.service.ts)

**State variables**:
```typescript
private isActive: boolean = false;
private speedMultiplier: number = 1;
private currentHouseId: string = '';
private simulatedTimestamp: Date = new Date();

// Simulated environment state (persists between steps)
private envTemp: number = 30.0;
private envHumid: number = 80.0;
private envCO2: number = 950;
private lastControlActions: ControlActions = { mist_generator_pwm: 0, convection_fan_pwm: 10, ... };

// Buffering for fast-forward mode
private bufferQueue: TelemetryLogInput[] = [];
private timerId: NodeJS.Timeout | null = null;
private flushTimerId: NodeJS.Timeout | null = null;
```

**`startSimulation(houseId, speed)`**:
- Dừng simulation cũ nếu đang chạy
- Reset `simulatedTimestamp` về `new Date()`
- Set `isActive = true`, `speedMultiplier = speed`, `currentHouseId = houseId`
- Tính `stepIntervalMs = (5 * 60 * 1000) / speed` (mỗi step = 5 phút thực → rút ngắn theo speed)
- Khởi động `timerId = setInterval(() => this.simulateStep(), stepIntervalMs)`
- Nếu `speed > 1`: Khởi động `flushTimerId = setInterval(() => this.flushBuffer(), 5000)`

**`stopSimulation()`**:
- `clearInterval(timerId)`, `clearInterval(flushTimerId)`
- Gọi `await this.flushBuffer()` (drain toàn bộ buffer còn lại vào DB)
- Set `isActive = false`

**`simulateStep()`** (async, private):
- Advance `simulatedTimestamp` += 5 phút ảo
- Tính thay đổi môi trường dựa trên `lastControlActions`:
  ```typescript
  // Độ ẩm
  if (this.lastControlActions.mist_generator_pwm > 0) {
    this.envHumid = Math.min(95, this.envHumid + 0.3 * (this.lastControlActions.mist_generator_pwm / 100));
  } else {
    this.envHumid = Math.max(50, this.envHumid - 0.1); // bay hơi tự nhiên
  }
  // Nhiệt độ
  if (this.lastControlActions.heating_lamp_active) {
    this.envTemp = Math.min(40, this.envTemp + 0.2);
  }
  if (this.lastControlActions.convection_fan_pwm > 10) {
    this.envTemp = Math.max(20, this.envTemp - 0.1);
  }
  // CO2: tăng tự nhiên, giảm khi fan chạy
  this.envCO2 = Math.max(400, Math.min(2000, this.envCO2 + 5 - this.lastControlActions.convection_fan_pwm * 0.1));
  ```
- Tạo `measurements: TelemetryEvent = { temp_air: this.envTemp, humidity_air: this.envHumid, co2_level: this.envCO2, ... }`
- **Nếu `speedMultiplier === 1`**: Gọi `TelemetryService.processTelemetry()` — full pipeline
- **Nếu `speedMultiplier > 1`**: Tính nhanh controlActions (không dispatch MQTT), đẩy vào `bufferQueue`, kiểm tra flush

**`flushBuffer()`** (async, private):
```typescript
async flushBuffer(): Promise<void> {
  if (this.bufferQueue.length === 0) return;
  
  // Anti race-condition: swap buffer trước khi async insert
  const dataToInsert = [...this.bufferQueue];
  this.bufferQueue = [];
  
  // Bulk INSERT một lần cho toàn bộ batch
  const placeholders = dataToInsert.map((_, i) => `($${i * 15 + 1}, $${i * 15 + 2}, ...)`).join(', ');
  const values = dataToInsert.flatMap(row => [row.time, row.batchId, ...]);
  await this.db.query(`INSERT INTO telemetry_logs (...) VALUES ${placeholders}`, values);
  
  this.logger.log(`Flushed ${dataToInsert.length} simulation records to DB`);
}
```

**`onModuleDestroy()`**:
- `clearInterval(timerId)`, `clearInterval(flushTimerId)`
- `await this.flushBuffer()` — bảo toàn data còn trong RAM khi app tắt

**`getSimulationState()`**:
- Return `{ isActive, speedMultiplier, currentHouseId, simulatedTimestamp, bufferSize: bufferQueue.length }`

---

### TRACK 2 — Simulation Controller (I2)

#### Task 4.2 — Tạo `simulation.controller.ts`

**File tạo mới**: [`src/simulation/controllers/simulation.controller.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/controllers/simulation.controller.ts)

```typescript
@Controller('simulation')
export class SimulationController {
  // POST /simulation/start — khởi chạy giả lập
  @Post('start')
  @HttpCode(202)
  start(@Body() dto: StartSimulationDto) {
    // dto: { houseId: string, speedMultiplier: number (1-100) }
    this.simulationService.startSimulation(dto.houseId, dto.speedMultiplier);
    return { message: `Simulation started for house '${dto.houseId}' at ${dto.speedMultiplier}x speed.` };
  }

  // POST /simulation/stop — dừng giả lập
  @Post('stop')
  @HttpCode(202)
  async stop() {
    await this.simulationService.stopSimulation();
    return { message: 'Simulation stopped. Buffer flushed to DB.' };
  }

  // GET /simulation/state — trạng thái hiện tại
  @Get('state')
  getState() { return this.simulationService.getSimulationState(); }
}
```

**`StartSimulationDto`**:
- `@IsString() @IsNotEmpty() houseId: string`
- `@IsNumber() @Min(1) @Max(100) speedMultiplier: number`

---

### TRACK 3 — Simulation Module (I3)

#### Task 4.3 — Tạo `simulation.module.ts`

**File tạo mới**: [`src/simulation/simulation.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/simulation.module.ts)

```typescript
@Module({
  imports: [TelemetryModule, BatchModule],  // inject TelemetryService + BatchService
  providers: [SimulationService],
  controllers: [SimulationController],
  exports: [SimulationService],
})
export class SimulationModule {}
```

---

### TRACK 4 — Cleanup & System Integration (J1, J2)

#### Task 4.4 — Xóa `TelemetryQueryService` legacy (J1)

> ⚠️ **Thực hiện sau** khi `TelemetryService` (Sprint 3) đã replace hoàn toàn chức năng của `TelemetryQueryService`.

**Hành động**:
- Xóa file: [`src/database/telemetry-query.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts)
- Cập nhật [`src/database/database.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.module.ts):
  - Xóa import `TelemetryQueryService`
  - Xóa khỏi `providers: [...]`
  - Xóa khỏi `exports: [...]`
- Tìm kiếm và xóa toàn bộ import của `TelemetryQueryService` trong các file khác (nếu có)

**Verify**:
```bash
grep -r "TelemetryQueryService" src/ --include="*.ts"
# Phải trả về kết quả rỗng
```

#### Task 4.5 — Wire tất cả module vào `AppModule` (J2)

**File sửa đổi**: [`src/app.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/app.module.ts)

**Trạng thái hiện tại** (hiện chỉ có):
```typescript
imports: [DatabaseModule, MqttModule, DeviceModule]
```

**Sau khi hoàn thành Sprint 2, 3, 4**:
```typescript
imports: [
  DatabaseModule,    // @Global — TypeORM pool, DatabaseService
  MqttModule,        // MqttService — MQTT connectivity
  DeviceModule,      // /devices/* REST + SSE status endpoints
  BatchModule,       // /batches/* REST — crop batch management  ← Thêm (Sprint 2)
  TelemetryModule,   // /devices/:id/telemetry/* REST + SSE      ← Thêm (Sprint 3)
  SimulationModule,  // /simulation/* REST — sandbox dev tool    ← Thêm (Sprint 4)
]
```

> ⚠️ **Kiểm tra circular dependency**: Nếu có lỗi `Nest can't resolve dependencies`, dùng `forwardRef()`:
> ```typescript
> imports: [forwardRef(() => TelemetryModule)]
> ```

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

| # | Tiêu chí | Cách verify |
|---|---|---|
| 1 | **Không Memory Leak** | Stop simulation → `clearInterval` phải được gọi. Dùng Jest fake timers để kiểm tra |
| 2 | **Không mất data buffer khi tắt** | Trigger `onModuleDestroy` thủ công → `bufferQueue` phải được flush xuống DB |
| 3 | **Bulk Insert hiệu quả** | Một lần flush 100 records = 1 SQL query (không phải 100 queries riêng lẻ) |
| 4 | **Sandbox cô lập** | Simulation chỉ insert data vào house/batch được chỉ định, không ảnh hưởng house thật |
| 5 | **Không TelemetryQueryService reference** | `grep -r "TelemetryQueryService" src/ --include="*.ts"` trả về rỗng |
| 6 | **AppModule khởi động sạch** | `pnpm start:dev` không có lỗi DI hoặc module not found |
| 7 | **Fast-forward không block MQTT** | Khi `speedMultiplier > 1`, MQTT callback vẫn xử lý bình thường (simulation chạy riêng interval) |

---

## 5. CHECKLIST TRIỂN KHAI

- [ ] **I1**: Tạo `simulation.service.ts` — state management, `simulateStep()`, `flushBuffer()`, `onModuleDestroy()`
- [ ] **I2**: Tạo `simulation.controller.ts` — start/stop/state endpoints + `StartSimulationDto`
- [ ] **I3**: Tạo `simulation.module.ts` — wire imports/providers/exports
- [ ] **J1**: Xóa `telemetry-query.service.ts` + clean `database.module.ts`
- [ ] **J2**: Cập nhật `app.module.ts` — import `BatchModule`, `TelemetryModule`, `SimulationModule`
- [ ] Verify: `pnpm lint && pnpm build && pnpm test` — 0 errors
- [ ] Verify: `pnpm start:dev` khởi động không lỗi DI

---

## 6. GHI CHÚ TRIỂN KHAI

### Về Thứ Tự Tasks trong Sprint 4

```
J1 (Cleanup TelemetryQueryService) phải làm TRƯỚC J2 (wire AppModule)
Vì nếu xóa file nhưng chưa clean module imports → DI lỗi khi khởi động
```

### Về Buffer Queue Thread Safety

Node.js là single-threaded nên **không cần Mutex**. Tuy nhiên, vẫn cần swap buffer trước `await` để tránh data mới bị overwrite trong lúc async insert đang chạy:
```typescript
// ĐÚNG: swap ngay lập tức (synchronous) trước khi await
const dataToInsert = [...this.bufferQueue];
this.bufferQueue = [];
await this.db.query(bulkInsertSQL, ...);

// SAI: sẽ mất data nếu setInterval push thêm trong lúc await
await this.db.query(bulkInsertSQL, ...);
this.bufferQueue = [];
```

### Về `speedMultiplier` và Timestamp

Khi `speedMultiplier > 1`, `simulatedTimestamp` được advance theo `5_minutes * speedMultiplier` mỗi real-second. Insert vào TimescaleDB với timestamp giả này → TimescaleDB sẽ tạo chunk theo thời gian giả lập, không phải thời gian thực. Đây là hành vi mong muốn cho sandbox.
