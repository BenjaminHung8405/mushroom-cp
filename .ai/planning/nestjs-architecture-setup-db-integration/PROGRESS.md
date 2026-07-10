# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-09T21:25:38+07:00
- **Cập nhật lần cuối**: 2026-07-10T14:15:00+07:00
- **Agent thực thi**: Gemini
- **Agent rà soát / khởi tạo PROGRESS**: Claude (Senior Solution Architect)

## Reference Plan
- **Thư mục kế hoạch**: [nestjs-architecture-setup-db-integration](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/)
- **Sprints tham chiếu**:
  1. [sprint_1.md (Database Module & Connection Pool) — ✅ HOÀN THÀNH](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_1.md)
  2. [sprint_2.md (Batch Module & Nghiệp Vụ Vụ Nuôi) — 🔧 QA REVIEW (Round 2)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_2.md)
  3. [sprint_3.md (Telemetry Module & Closed-Loop Fail-Safe) — ❌ NEXT TO DO](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_3.md)
  4. [sprint_4.md (Simulation, Buffering & Cleanup) — ❌ LATER](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_4.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có
- **Ghi chú kiến trúc (từ cập nhật sprint 2026-07-10)**:
  - `BatchContext` dual format (camelCase + snake_case) phục vụ Sprint 3
  - Circular dependency MQTT ↔ Telemetry giải quyết bằng `Subject<TelemetryEvent>` (một chiều)
  - `TelemetryQueryService` legacy giữ đến Sprint 4 Task J1
  - `BatchModule` / `TelemetryModule` / `SimulationModule` wire vào `AppModule` chỉ ở J2

## Tracks Progress

---

### SPRINT 1: DATABASE MODULE & CONNECTION POOL HỢP NHẤT — ✅ HOÀN THÀNH
> QA duyệt: 2026-07-09T22:15:00+07:00 · LGTM

#### Track A: Cấu hình Dự án & CLI (Project Setup Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| A1 | Cập nhật dependency và scripts trong `package.json` | [x] Done | - **Quy tắc phiên bản**: Ghim cứng `@nestjs/typeorm: 11.0.3`, `typeorm: 1.0.0`, `date-fns-tz: 3.2.0`, `class-validator`, `class-transformer` — cấm `*` / `^` quá rộng.<br>- **CLI scripts**: `migration:run` / `migration:revert` phải chạy qua `typeorm-ts-node-commonjs` và trỏ đúng `typeorm.config.ts`.<br>- **Verify**: `pnpm build` + chạy thử migration script (dry) để tránh tech debt đường dẫn. |

#### Track B: Tầng Truy Cập Dữ Liệu (Data Access Layer Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| B1 | Khởi tạo `src/database/typeorm.config.ts` | [x] Done | - **Bảo mật**: Không hardcode credentials. Ưu tiên `DATABASE_URL`, fallback `POSTGRES_*`. Throw rõ ràng khi thiếu env (trừ `NODE_ENV=test`).<br>- **No Auto-Sync**: `synchronize: false` bắt buộc — bảo vệ TimescaleDB hypertable chunks.<br>- **Pool limits**: `extra.max=20`, `idleTimeoutMillis=30000`, `connectionTimeoutMillis=2000` — chống connection starvation.<br>- **Parse `.env` thông minh**: Hỗ trợ quoted string; chỉ strip comment `#` khi đứng sau whitespace (tránh bẻ password chứa `#`). Không ghi đè biến env system (Docker/CI).<br>- **Test env**: `retryAttempts: 0` khi `NODE_ENV=test`. |
| B2 | Refactor `DatabaseModule` tích hợp `TypeOrmModule` | [x] Done | - **DI + encapsulation**: `TypeOrmModule.forRootAsync({ useFactory: () => typeOrmConfig })`.<br>- **`@Global()`**: Tránh re-import ở module con.<br>- **Export**: Export `TypeOrmModule` + `DatabaseService` để feature module dùng `@InjectRepository()` / inject service.<br>- **Legacy**: Vẫn export `TelemetryQueryService` tạm thời — xóa ở Sprint 4 J1. |
| B3 | Refactor `DatabaseService` loại bỏ raw `pg` Pool | [x] Done | - **Adapter Pattern**: Wrap `DataSource.query()` thành `query<T>(text, params)` trả `{ rows: T[] }` — tương thích ngược `TelemetryQueryService`.<br>- **SQL Injection**: Bắt buộc parameterized queries; cấm cộng chuỗi SQL.<br>- **Lifecycle**: `onModuleInit()` chạy `SELECT NOW()`, log structured qua NestJS `Logger` (không `console.log`).<br>- **Cleanup**: Gỡ hoàn toàn import `pg`. Xử lý `unknown` trong catch (TS strict).<br>- **Bổ sung `main.ts`**: Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. |

---

### SPRINT 2: BATCH MODULE & NGHIỆP VỤ VỤ NUÔI — 🔧 IN PROGRESS (QA REVIEW ROUND 2)
> QA reject: 2026-07-10 · 5 findings (1 High, 3 Medium, 1 Low-Medium) · Fixed and resubmitted for review

#### Track C: Tầng Thực Thể Cơ Sở Dữ Liệu Vụ Nuôi (Crop Batch Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| C1 | Tạo entity `MushroomHouse` | [ ] QA Review | - **Mapping**: `@Entity` → bảng `mushroom_houses`. `@PrimaryColumn() id: string` (VARCHAR 50).<br>- **Snake_case**: Mọi cột DB map qua `@Column({ name: '...' })` (`area_meters`, `pillar_count`).<br>- **File**: `src/batch/entities/mushroom-house.entity.ts` + unit test. |
| C2 | Tạo entity `GrowthProfile` | [ ] QA Review | - **Timestamps**: `@CreateDateColumn({ type: 'timestamptz' })` + `@UpdateDateColumn({ type: 'timestamptz' })` — đồng bộ timezone hệ thống.<br>- **Fields**: `name`, `description` (nullable TEXT).<br>- **File**: `src/batch/entities/growth-profile.entity.ts` + unit test. |
| C3 | Tạo entity `CropBatch` | [ ] QA Review | - **Numeric transformer**: Mọi cột `numeric` dùng `transformer: { to: v => v, from: v => parseFloat(v) }` — PostgreSQL trả string sẽ phá tính toán nếu bỏ qua.<br>- **Relation**: `@ManyToOne(MushroomHouse) @JoinColumn({ name: 'house_id' })`.<br>- **Business fields**: `status` default `'ACTIVE'`, `startDate`, `totalCropDays`, `spawnRunningEndDay`, `tempOptimalMin/Max`, `humidityOptimalMin/Max`, `thermalShockProtection`, `thermalShockStart/End` (TIME).<br>- **File**: `src/batch/entities/crop-batch.entity.ts` + unit test. |
| C4 | Tạo entity `CurveCheckpoint` | [ ] QA Review | - **PK**: `@PrimaryGeneratedColumn({ type: 'bigint' })` tương thích BIGSERIAL.<br>- **Index**: `@Index('idx_checkpoints_batch', ['batch'])` — tránh full table scan khi filter theo vụ nuôi.<br>- **metricType**: `'TEMPERATURE' \| 'HUMIDITY'`. `targetValue` dùng numeric transformer.<br>- **Relations**: `@ManyToOne` với `GrowthProfile` + `CropBatch` (cascade delete).<br>- **File**: `src/batch/entities/curve-checkpoint.entity.ts` + unit test. |
| C5 | Tạo entity `LightScheduleBlock` | [ ] QA Review | - **PK**: `@PrimaryGeneratedColumn({ type: 'bigint' })`.<br>- **Union type**: `status: 'ON' \| 'OFF'`; fields `startDay`, `endDay`.<br>- **Relations**: `@ManyToOne` `GrowthProfile` + `CropBatch` (cascade delete).<br>- **File**: `src/batch/entities/light-schedule-block.entity.ts` + unit test. |

#### Track D: Tầng Nghiệp Vụ Vụ Nuôi (Crop Batch Business Logic Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| D1 | Triển khai `BatchService` (core methods) | [ ] QA Review | - **Fixed (Round 2)**: F1 extracted `calculateCropDay` + `assembleContext`; F2 extracted `safeTargetValue`; F4 now throws `ConflictException` on multiple ACTIVE batches.<br>- **Single Source of Truth**: Chỉ 1 batch `ACTIVE` / `house_id`. `createBatch()` dùng transaction + `pessimistic_write` lock; throw `ConflictException` nếu đã có ACTIVE.<br>- **Interpolation**: Linear `V1 + (cropDay-D1)/(D2-D1)*(V2-V1)`, làm tròn bội 0.5. Biên: cropDay ≤ first → first; ≥ last → last; rỗng → midpoint `[optimalMin, optimalMax]` hoặc fallback an toàn.<br>- **Timezone**: `cropDay = floor((now - start_date) / 86400000) + 1` qua `toZonedTime(..., 'Asia/Ho_Chi_Minh')` — kết quả phải giống nhau dù server TZ=UTC hay UTC+7. Clamp `[1, totalCropDays]`.<br>- **`BatchContext` dual format**: Export cả camelCase + snake_case — Sprint 3 `TelemetryService` consume.<br>- **Fallback bio-safety**: Không có active batch → `getFallbackContext()` (temp 28–35°C, humidity 70–90%, thermal shock ON 11:00–13:30).<br>- **Methods bắt buộc**: `getActiveBatchByHouseId`, `getBatchContext`, `interpolate` (private), `createBatch`, `endBatch`, `getFallbackContext` (private).<br>- **File**: `src/batch/services/batch.service.ts`. |

#### Track E: Tầng Giao Tiếp API Vụ Nuôi (Crop Batch API Controller Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| E1 | Xây dựng `BatchController` + `BatchModule` + DTOs | [ ] QA Review | - **Fixed (Round 2)**: F3 added `@MaxLength(50)` on `id` and `houseId`; F5 added `@Min(0)/@Max(60)` on temp fields, `@Min(0)/@Max(100)` on humidity fields.<br>- **Validation**: `CreateBatchDto` / `UpdateBatchDto` + global ValidationPipe. Validate ID length, crop days 10–45, time `HH:MM:SS`, enum status.<br>- **Endpoints**: `POST /batches`, `PATCH /batches/:id/end`, `GET /batches/active/:houseId`.<br>- **Race condition**: Tạo batch phải qua transaction + lock (xem D1) — không chỉ check-then-insert.<br>- **Module**: `TypeOrmModule.forFeature([...5 entities])`; **export `BatchService`** cho Sprint 3 inject.<br>- **Chưa wire AppModule**: Import `BatchModule` vào `AppModule` chỉ ở Sprint 4 J2 — tránh nửa vời DI.<br>- **Files**: `batch.controller.ts`, `batch.module.ts`, `dto/create-batch.dto.ts`, `dto/update-batch.dto.ts`. |

---

### SPRINT 3: TELEMETRY MODULE & CLOSED-LOOP FAIL-SAFE — ❌ NEXT TO DO
> Prerequisite: Sprint 1 ✅ · Sprint 2 QA (có thể code song song, E2E cần Sprint 2 pass) · EMQX ACL `mushroom/#` ✅

#### Track F: Tầng Thực Thể Cơ Sở Dữ Liệu Telemetry (Telemetry DB Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| F1 | Tạo entity `TelemetryLog` ánh xạ hypertable | [ ] Pending | - **Không Auto-Sync Hypertable**: `@Entity('telemetry_logs', { synchronize: false })` — tuyệt đối cấm TypeORM tạo/sửa bảng này (TimescaleDB hypertable, quản lý bằng SQL migration thủ công).<br>- **Composite PK**: `@PrimaryColumn time: timestamptz` + `@PrimaryColumn batchId` — tương thích chunk partitioning TimescaleDB.<br>- **Numeric transformer**: Sensor/setpoint/error_delta columns dùng cùng transformer như CropBatch.<br>- **Nullable sensors**: Sensor fields nullable (lỗi phần cứng) — không crash khi null.<br>- **File**: `src/telemetry/entities/telemetry-log.entity.ts`. |

#### Track G: Tầng Nghiệp Vụ & Điều Khiển Telemetry (Telemetry Control & Timezone Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| G1 | `processTelemetry()` + Bio-safety Fail-Safe closed-loop | [ ] Pending | - **try/catch/finally BẮT BUỘC**: (1) `try`: `getBatchContext` → `calculateControlOutputs` → `saveTelemetryLog` → `updateLatestCache`. (2) `catch`: `Logger.error(msg, stack)` + giữ emergency fallback (`mist=0`, `fan=10`, `lamp=false`). (3) `finally`: **luôn** gọi `mqttService.dispatchSetpoint(houseId, controlActions)` — hardware an toàn độc lập DB.<br>- **Subscribe một chiều**: `onModuleInit()` subscribe `mqttService.telemetry$` — **không** inject ngược MqttService → TelemetryService.<br>- **Null-safe**: Sensor null không được ném exception trong tính toán PWM.<br>- **File**: `src/telemetry/services/telemetry.service.ts`. |
| G2 | `calculateControlOutputs()` + timezone UTC+7 midday blackout | [ ] Pending | - **Timezone độc lập server**: `toZonedTime(timestamp, 'Asia/Ho_Chi_Minh')` → `minutesSinceMidnight`. Blackout khi `thermalShockProtection && minutes ∈ [startMin, endMin]` (mặc định 11:00–13:30 = 660–810).<br>- **Mist PWM**: Blackout → 0; thiếu ẩm → `min(100, round((target-humid)*5))`; đủ → 0.<br>- **Fan PWM**: Baseline 10% + tăng theo lệch nhiệt (cap 50%).<br>- **Heating lamp**: `temp < tempOptimalMin` → true.<br>- **Verify**: Chạy với `TZ=UTC` vẫn ra đúng khung midday VN. |
| G3 | `saveTelemetryLog` + `getLatestTelemetry` + `getTelemetryHistory` + `latestCache` | [ ] Pending | - **Raw SQL INSERT**: Dùng `DatabaseService.query()` parameterized — tránh ORM overhead tần suất cao. Tái sử dụng query shape từ legacy `TelemetryQueryService`.<br>- **Error deltas**: `humidityErrorDelta = target - measured`, tương tự temperature.<br>- **In-memory cache**: `latestCache: Map<string, Snapshot>` update sau process thành công — serve REST sub-ms; seed SSE client mới.<br>- **History**: `time BETWEEN $from AND $to` ORDER BY time ASC cho chart. |
| G4 | Tạo `TelemetryController` (REST + SSE + history) | [ ] Pending | - **Endpoints**: `GET /devices/:id/telemetry`, `SSE /devices/:id/telemetry/stream`, `GET /devices/:id/telemetry/history?from=&to=`.<br>- **SSE seed**: `merge(of(latestSnapshot), live$)` — client mới phải nhận snapshot ngay, không chờ event kế tiếp.<br>- **Filter**: Live stream filter theo `deviceId === params.id`.<br>- **DTO**: `DeviceParamsDto` validate id.<br>- **File**: `src/telemetry/telemetry.controller.ts`. |
| G5 | Tạo `TelemetryModule` wire dependencies | [ ] Pending | - **Imports**: `MqttModule`, `BatchModule` (export BatchService). `DatabaseService` qua `@Global() DatabaseModule`.<br>- **Providers/Controllers/Exports**: `TelemetryService`, `TelemetryController`, export service cho Sprint 4 Simulation.<br>- **Cấm circular**: Không import ngược gây cycle MQTT ↔ Telemetry. |
| G6 | Verify lint / build / test Sprint 3 | [ ] Pending | - **Gate**: `pnpm lint && pnpm build && pnpm test` — 0 errors, 0 warnings.<br>- **QA checklist sprint_3 §4**: finally luôn dispatch · timezone · synchronize:false · no circular · stacktrace log · null-safe · SSE seed. |

#### Track H: Tầng Tích Hợp MQTT (MQTT Integration Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| H1 | Cập nhật `MqttService`: subscribe telemetry + `dispatchSetpoint` + Subject stream | [ ] Pending | - **Subject Pattern (chống circular DI)**: `public readonly telemetry$ = new Subject<TelemetryEvent>()` + `telemetryCache: Map`. `MqttService` **KHÔNG** inject `TelemetryService`.<br>- **Subscribe**: Đổi `subscribeToStatusTopics` → `subscribeToTopics`; thêm `mushroom/device/+/telemetry` QoS 1 (giữ status QoS 1).<br>- **Routing SRP**: `handleIncomingMessage` phân loại segment[3] (`status` \| `telemetry`); telemetry → private `handleTelemetryMessage` (parse JSON, null-safe numbers, cache + emit).<br>- **`dispatchSetpoint(houseId, payload)`**: publish `mushroom/device/{houseId}/setpoint` QoS 1.<br>- **`getAllTelemetry()`**: seed SSE multi-device nếu cần.<br>- **File**: `src/mqtt/mqtt.service.ts`. |

---

### SPRINT 4: SIMULATION MODULE, DATA BUFFERING & CLEANUP — ❌ LATER
> Prerequisite: Sprint 3 QA pass · Có thể defer nếu cần ship MQTT production sớm · **Thứ tự bắt buộc: J1 trước J2**

#### Track I: Tầng Giả Lập & Đệm Dữ Liệu (Simulation & Buffering Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| I1 | Triển khai `SimulationService` + bulk insert buffer | [ ] Pending | - **Dual path**: `speedMultiplier === 1` → `TelemetryService.processTelemetry()` (full pipeline + MQTT). `speedMultiplier > 1` → push `bufferQueue`, **không** dispatch MQTT từng step (tránh nghẽn hypertable / MQTT).<br>- **Env model**: `simulateStep()` advance `simulatedTimestamp` +5 phút ảo; env phản ứng `lastControlActions` (mist↑ humid, lamp↑ temp, fan↓ temp/CO2, bay hơi tự nhiên).<br>- **Anti race-condition buffer**: **Swap đồng bộ trước await**: `const data = [...bufferQueue]; bufferQueue = []; await bulkInsert(data)`. Cấm clear sau await (mất data do interval push song song). Node single-thread → không cần Mutex nhưng swap là bắt buộc.<br>- **Flush triggers**: size ≥ 100 **hoặc** mỗi 5s (`flushTimerId`). Bulk = **1 SQL** multi-VALUES parameterized placeholders (`$1..$N`), không 100 query lẻ.<br>- **Lifecycle**: `onModuleDestroy` clearInterval cả 2 timer + `await flushBuffer()` — không mất data khi tắt app.<br>- **Timers**: `stepIntervalMs = (5*60*1000)/speed`. Stop simulation phải clear cả `timerId` + `flushTimerId` (chống memory leak).<br>- **File**: `src/simulation/services/simulation.service.ts`. |
| I2 | Triển khai `SimulationController` + `StartSimulationDto` | [ ] Pending | - **Endpoints**: `POST /simulation/start` (202), `POST /simulation/stop` (202, await flush), `GET /simulation/state`.<br>- **DTO validation**: `houseId` non-empty string; `speedMultiplier` number `@Min(1) @Max(100)`.<br>- **Sandbox isolation**: Chỉ ghi house/batch chỉ định — không đụng house production khác.<br>- **File**: `src/simulation/controllers/simulation.controller.ts` + DTO. |
| I3 | Thiết lập `SimulationModule` | [ ] Pending | - **Imports**: `TelemetryModule`, `BatchModule`.<br>- **Memory leak gate**: Mọi timer phải clear khi stop / destroy module — verify bằng Jest fake timers.<br>- **File**: `src/simulation/simulation.module.ts`. |

#### Track J: Dọn Dẹp & Đồng Bộ Hệ Thống (Cleanup & System Integration Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| J1 | Xóa `TelemetryQueryService` legacy + clean `DatabaseModule` | [ ] Pending | - **Thứ tự**: Làm **TRƯỚC J2**. Chỉ xóa sau khi `TelemetryService` (Sprint 3) thay thế 100% chức năng.<br>- **Actions**: Xóa `src/database/telemetry-query.service.ts`; gỡ import/providers/exports trong `database.module.ts`; grep sạch mọi reference.<br>- **Verify**: `grep -r "TelemetryQueryService" src/ --include="*.ts"` → rỗng.<br>- **Chống dead code**: Không để re-export stub hay comment "removed". |
| J2 | Wire `BatchModule` + `TelemetryModule` + `SimulationModule` vào `AppModule` | [ ] Pending | - **Thứ tự**: Sau J1. Imports cuối: `DatabaseModule`, `MqttModule`, `DeviceModule`, `BatchModule`, `TelemetryModule`, `SimulationModule`.<br>- **DI safety**: `pnpm start:dev` không circular / missing provider. Dùng `forwardRef()` chỉ khi thật sự có cycle (ưu tiên Subject pattern đã áp ở H1/G1 để tránh).<br>- **Gate cuối**: `pnpm lint && pnpm build && pnpm test` + boot sạch không DI error.<br>- **File**: `src/app.module.ts`. |

---

## Dependency Map (tóm tắt)

```
Sprint 1 [x] Done
    │
    ▼
Sprint 2 [ ] QA Review (Round 2) ──export BatchService──┐
    │                                          │
    │ (code song song OK)                      ▼
    └──────────────────────────────► Sprint 3 [ ] Pending
                                         │  H1 Subject$ → G1 closed-loop → F1/G3/G4/G5
                                         ▼
                                   Sprint 4 [ ] Pending
                                      I1/I2/I3 → J1 cleanup → J2 AppModule wire
```

## Status Legend
| Ký hiệu | Ý nghĩa |
| :--- | :--- |
| `[ ] Pending` | Task chưa chạm vào |
| `[ ] In Progress` | Execution Agent đang viết code |
| `[ ] QA Review` | Code xong, chờ rà soát chất lượng |
| `[x] Done` | Đã qua review nghiêm ngặt và được duyệt |
