# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-09T21:25:38+07:00
- **Cập nhật lần cuối**: 2026-07-10T15:30:00+07:00
- **Agent thực thi**: Gemini
- **Agent rà soát / khởi tạo PROGRESS**: Claude (Senior Solution Architect)

## Reference Plan
- **Thư mục kế hoạch**: [nestjs-architecture-setup-db-integration](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/)
- **Sprints tham chiếu**:
  1. [sprint_1.md (Database Module & Connection Pool) — ✅ HOÀN THÀNH](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_1.md)
  2. [sprint_2.md (Batch Module & Nghiệp Vụ Vụ Nuôi) — ✅ HOÀN THÀNH](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_2.md)
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

### SPRINT 2: BATCH MODULE & NGHIỆP VỤ VỤ NUÔI — ✅ HOÀN THÀNH
> QA duyệt: 2026-07-10T15:30:00+07:00 · LGTM (C1–C5, D1, E1)

#### Track C: Tầng Thực Thể Cơ Sở Dữ Liệu Vụ Nuôi (Crop Batch Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| C1 | Tạo entity `MushroomHouse` | [x] Done | - **LGTM 2026-07-10**. Mapping schema chính xác. Snake_case đúng. Test pass. |
| C2 | Tạo entity `GrowthProfile` | [x] Done | - **LGTM 2026-07-10**. Timestamps timestamptz đúng. Test pass. |
| C3 | Tạo entity `CropBatch` | [x] Done | - **LGTM 2026-07-10**. Numeric transformer fallback an toàn. FK RESTRICT đúng. Minor: status nên typed enum (không chặn). |
| C4 | Tạo entity `CurveCheckpoint` | [x] Done | - **LGTM 2026-07-10 Round 2**. Index `@Index('idx_checkpoints_batch', ['batchId', 'metricType'])` khớp schema SQL. PK bigint, numeric transformer, cascade delete đúng. |
| C5 | Tạo entity `LightScheduleBlock` | [x] Done | - **LGTM 2026-07-10 Round 2**. `@BeforeInsert/@BeforeUpdate` validate XOR origin + days order. PK bigint, union type status, cascade delete đúng. |

#### Track D: Tầng Nghiệp Vụ Vụ Nuôi (Crop Batch Business Logic Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| D1 | Triển khai `BatchService` (core methods) | [x] Done | - **Fixed (Round 2)**: F1 extracted `calculateCropDay` + `assembleContext`; F2 extracted `safeTargetValue`; F4 now throws `ConflictException` on multiple ACTIVE batches.<br>- **Single Source of Truth**: Chỉ 1 batch `ACTIVE` / `house_id`. `createBatch()` dùng transaction + `pessimistic_write` lock; throw `ConflictException` nếu đã có ACTIVE.<br>- **Interpolation**: Linear `V1 + (cropDay-D1)/(D2-D1)*(V2-V1)`, làm tròn bội 0.5. Biên: cropDay ≤ first → first; ≥ last → last; rỗng → midpoint `[optimalMin, optimalMax]` hoặc fallback an toàn.<br>- **Timezone**: `cropDay = floor((now - start_date) / 86400000) + 1` qua `toZonedTime(..., 'Asia/Ho_Chi_Minh')` — kết quả phải giống nhau dù server TZ=UTC hay UTC+7. Clamp `[1, totalCropDays]`.<br>- **`BatchContext` dual format**: Export cả camelCase + snake_case — Sprint 3 `TelemetryService` consume.<br>- **Fallback bio-safety**: Không có active batch → `getFallbackContext()` (temp 28–35°C, humidity 70–90%, thermal shock ON 11:00–13:30).<br>- **Methods bắt buộc**: `getActiveBatchByHouseId`, `getBatchContext`, `interpolate` (private), `createBatch`, `endBatch`, `getFallbackContext` (private).<br>- **File**: `src/batch/services/batch.service.ts`. |

#### Track E: Tầng Giao Tiếp API Vụ Nuôi (Crop Batch API Controller Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| E1 | Xây dựng `BatchController` + `BatchModule` + DTOs | [x] Done | - **Fixed (Round 2)**: F3 added `@MaxLength(50)` on `id` and `houseId`; F5 added `@Min(0)/@Max(60)` on temp fields, `@Min(0)/@Max(100)` on humidity fields.<br>- **Validation**: `CreateBatchDto` / `UpdateBatchDto` + global ValidationPipe. Validate ID length, crop days 10–45, time `HH:MM:SS`, enum status.<br>- **Endpoints**: `POST /batches`, `PATCH /batches/:id/end`, `GET /batches/active/:houseId`.<br>- **Race condition**: Tạo batch phải qua transaction + lock (xem D1) — không chỉ check-then-insert.<br>- **Module**: `TypeOrmModule.forFeature([...5 entities])`; **export `BatchService`** cho Sprint 3 inject.<br>- **Chưa wire AppModule**: Import `BatchModule` vào `AppModule` chỉ ở Sprint 4 J2 — tránh nửa vời DI.<br>- **Files**: `batch.controller.ts`, `batch.module.ts`, `dto/create-batch.dto.ts`, `dto/update-batch.dto.ts`. |

---

### SPRINT 3: TELEMETRY MODULE, CLOSED-LOOP ON/OFF CONTROL & SYSTEM INTEGRATION — ❌ NEXT TO DO
> Prerequisite: Sprint 1 ✅ · Sprint 2 ✅ · EMQX ACL `mushroom/#` ✅

#### Track F: Tầng Thực Thể Cơ Sở Dữ Liệu Telemetry (Telemetry DB Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| F1 | Tạo entity `TelemetryLog` ánh xạ hypertable | [ ] QA Review | - **Không Auto-Sync Hypertable**: `@Entity('telemetry_logs', { synchronize: false })` — cấm TypeORM tự tạo/sửa đổi bảng.<br>- **Composite PK**: `@PrimaryColumn time: timestamptz` + `@PrimaryColumn batchId`.<br>- **SHT30 Only**: Lưu `humidityMeasured` và `temperatureMeasured` (đều lấy từ SHT30, loại bỏ DS18B20).<br>- **ON/OFF Boolean**: Lưu `mistGeneratorActive` (boolean) và `convectionFanActive` (boolean) thay thế cho các cột PWM cũ.<br>- **File**: `src/telemetry/entities/telemetry-log.entity.ts`. |

#### Track G: Tầng Nghiệp Vụ & Điều Khiển Telemetry (Telemetry Control & Timezone Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| G1 | `processTelemetry()` + Bio-safety Fail-Safe & Idle Guard | [ ] QA Review | - **try/catch/finally BẮT BUỘC**: (1) `try`: lấy context → tính đầu ra ON/OFF → lưu DB → cập nhật in-memory cache. (2) `catch`: ghi log lỗi + đặt emergency fallback (`mist_active=false`, `fan_active=true`, `lamp_active=false`). (3) `finally`: **luôn** gọi `dispatchSetpoint` (bọc trong try-catch riêng để tránh nuốt exception).<br>- **Idle Guard**: Nếu `context.batchId === null` (nhà trống, không có vụ nuôi active), đặt tất cả actuator về `false` (tắt toàn bộ) thay vì chạy fallback khẩn cấp để tiết kiệm điện nước.<br>- **Unsubscribe**: Đảm bảo `TelemetryService` implement `OnModuleDestroy` để hủy subscribe `telemetry$` tránh rò rỉ bộ nhớ.<br>- **File**: `src/telemetry/services/telemetry.service.ts`. |
| G2 | `calculateControlOutputs()` ON/OFF + Midday Blackout | [ ] In Progress | - **Timezone độc lập**: Đưa timestamp về `Asia/Ho_Chi_Minh` để tính `minutesSinceMidnight`. Khóa sốc nhiệt (blackout) khi `thermalShockProtection` bật và thời gian nằm trong khung `[startMin, endMin]` (11:00-13:30).<br>- **Mist Active**: `!blackout` và `humidityMeasured < targetHumid`. Ngược lại tắt (`false`).<br>- **Fan Active**: Khi `temperatureMeasured > targetTemp` để hạ nhiệt hoặc `co2Measured > 1000`. Ngược lại tắt (`false`).<br>- **Heating Lamp**: Khi `temperatureMeasured < targetTemp` (hoặc < `tempOptimalMin`). Ngược lại tắt (`false`). |
| G3 | `saveTelemetryLog` + REST queries + `latestCache` | [ ] Pending | - **Raw SQL INSERT**: Dùng `DatabaseService.query()` lưu dữ liệu. Các trạng thái actuator là boolean.<br>- **In-memory cache**: `latestCache: Map<string, Snapshot>` lưu cache thời gian thực sub-ms phục vụ REST/SSE.<br>- **History**: Query `time BETWEEN $from AND $to` ORDER BY time ASC vẽ biểu đồ lịch sử. |
| G4 | Tạo `TelemetryController` (REST + SSE + history) | [ ] Pending | - **Endpoints**: `GET /devices/:id/telemetry` (snapshot cache), `SSE /devices/:id/telemetry/stream` (stream live + seed ban đầu), `GET /devices/:id/telemetry/history`. |
| G5 | Tạo `TelemetryModule` wire dependencies | [ ] Pending | - **Imports**: `MqttModule`, `BatchModule`. `DatabaseService` dùng `@Global() DatabaseModule`. |
| G6 | Xóa `TelemetryQueryService` legacy (Dọn dẹp) | [ ] Pending | - **Cleanup**: Xóa file `src/database/telemetry-query.service.ts` và loại bỏ hoàn toàn các re-export / provider khai báo trong `database.module.ts`. |
| G7 | Wire `BatchModule` & `TelemetryModule` vào `AppModule` | [ ] Pending | - **Integration**: Import cả 2 module vào `AppModule`. Chạy thử `pnpm start:dev` để đảm bảo không lỗi DI hay circular dependencies. |
| G8 | Verify lint / build / test | [ ] Pending | - **Gate**: `pnpm lint && pnpm build && pnpm test` đạt 0 errors, 0 warnings. |

#### Track H: Tầng Tích Hợp MQTT (MQTT Integration Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| H1 | Cập nhật `MqttService` nhận tin & dispatch setpoint | [ ] Pending | - **Subject Pattern**: `telemetry$` stream một chiều, tránh inject chéo.<br>- **Routing**: Lắng nghe `mushroom/device/+/telemetry`. Parse JSON an toàn (try-catch, không crash khi nhận tin sai định dạng). Đọc `temp_air` (nhiệt độ) và `humidity_air` (độ ẩm) từ SHT30.<br>- **`dispatchSetpoint`**: Gửi payload điều khiển dạng ON/OFF (`mist_generator_active`, `convection_fan_active`, `heating_lamp_active`) tới topic `mushroom/device/{houseId}/setpoint` QoS 1. |

---

## Dependency Map (tóm tắt)

```
Sprint 1 [x] Done
    │
    ▼
Sprint 2 [x] Done ──export BatchService──┐
    │                                     │
    └─────────────────────────────────────┴─► Sprint 3 [ ] Pending
                                                MQTT & Telemetry ON/OFF → Integration & Cleanup
```

## Status Legend
| Ký hiệu | Ý nghĩa |
| :--- | :--- |
| `[ ] Pending` | Task chưa chạm vào |
| `[ ] In Progress` | Execution Agent đang viết code |
| `[ ] QA Review` | Code xong, chờ rà soát chất lượng |
| `[x] Done` | Đã qua review nghiêm ngặt và được duyệt |
