# Sprint 2: Batch Module & Nghiệp Vụ Vụ Nuôi — ⏳ PENDING QA REVIEW

> **Status**: `[ ] QA Review` — Code đã implement xong (2026-07-10T09:40), đang chờ QA duyệt.
> Toàn bộ 7 tasks (C1–C5, D1, E1) đã được implement và tự-test pass.

---

## 1. MỤC TIÊU & PHẠM VI

Xây dựng đầy đủ `BatchModule` — nền tảng nghiệp vụ quản lý vụ nuôi nấm. Bao gồm 5 TypeORM entities ánh xạ schema PostgreSQL, thuật toán nội suy tuyến tính tính setpoints động theo ngày tuổi, và REST API CRUD.

**Các file tác động (tất cả đã implement):**

| File | Action | Status |
|---|---|---|
| [`src/batch/entities/mushroom-house.entity.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/mushroom-house.entity.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/entities/growth-profile.entity.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/growth-profile.entity.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/entities/crop-batch.entity.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/crop-batch.entity.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/entities/curve-checkpoint.entity.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/curve-checkpoint.entity.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/entities/light-schedule-block.entity.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/services/batch.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/controllers/batch.controller.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/batch.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/batch.module.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/dto/create-batch.dto.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/create-batch.dto.ts) | Tạo mới | ⏳ Pending QA |
| [`src/batch/dto/update-batch.dto.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/update-batch.dto.ts) | Tạo mới | ⏳ Pending QA |

> ⚠️ **Lưu ý**: `BatchModule` chưa được import vào [`app.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/app.module.ts) — sẽ wire vào ở Sprint 4 Task J2.

---

## 2. KIẾN TRÚC ĐÃ TRIỂN KHAI

```
[API Request: POST /batches | GET /batches/active/:houseId | PATCH /batches/:id/end]
                    │
                    ▼
         [BatchController] ──(Validation DTO)──► [BatchService]
                                                       │
                    ┌──────────────────────────────────┤
                    ▼                                  ▼
         [CropBatchRepository]              [CurveCheckpointRepository]
         [MushroomHouseRepository]          [LightScheduleBlockRepository]
                    │
                    ▼
         [getBatchContext(houseId, timestamp)]
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
 [Linear Interpolation]  [Timezone UTC+7]
 (CurveCheckpoints)      (date-fns-tz)
          │
          ▼
 [BatchContext] ─► (consumed by TelemetryService in Sprint 3)
```

---

## 3. CHI TIẾT ĐÃ IMPLEMENT

### TRACK 1 — Entities (C1–C5)

#### Task C1 — MushroomHouse entity ✅
- `@PrimaryColumn() id: string` (VARCHAR 50)
- Fields: `name`, `areaMeters` (`area_meters`), `pillarCount` (`pillar_count`), `@CreateDateColumn() createdAt`
- Unit test: `mushroom-house.entity.spec.ts`

#### Task C2 — GrowthProfile entity ✅
- `@PrimaryColumn() id: string` (VARCHAR 50)
- Fields: `name`, `description` (nullable TEXT)
- `@CreateDateColumn({ type: 'timestamptz' })`, `@UpdateDateColumn({ type: 'timestamptz' })`
- Unit test: `growth-profile.entity.spec.ts`

#### Task C3 — CropBatch entity ✅
- `@PrimaryColumn() id: string`
- Numeric transformer trên tất cả cột `numeric`: tự động `parseFloat()` để tránh lỗi tính toán khi PostgreSQL trả về string
- Quan hệ `@ManyToOne(MushroomHouse) @JoinColumn({ name: 'house_id' })`
- Fields: `status` (default `'ACTIVE'`), `startDate`, `totalCropDays`, `spawnRunningEndDay`, `tempOptimalMin/Max`, `humidityOptimalMin/Max`, `thermalShockProtection`, `thermalShockStart/End` (TIME type)
- Unit test: `crop-batch.entity.spec.ts`

#### Task C4 — CurveCheckpoint entity ✅
- `@PrimaryGeneratedColumn({ type: 'bigint' })` — tương thích BIGSERIAL
- `metricType: 'TEMPERATURE' | 'HUMIDITY'`
- `targetValue` dùng numeric transformer
- `@ManyToOne` với cả `GrowthProfile` và `CropBatch` (cascade delete)
- `@Index('idx_checkpoints_batch', ['batch'])` — tối ưu query theo vụ nuôi
- Unit test: `curve-checkpoint.entity.spec.ts`

#### Task C5 — LightScheduleBlock entity ✅
- `@PrimaryGeneratedColumn({ type: 'bigint' })`
- `status: 'ON' | 'OFF'`, `startDay`, `endDay`
- `@ManyToOne` với `GrowthProfile` và `CropBatch` (cascade delete)
- Unit test: `light-schedule-block.entity.spec.ts`

### TRACK 2 — Business Logic (D1)

#### Task D1 — BatchService ✅

**`getActiveBatchByHouseId(houseId)`**:
- Truy vấn `status = 'ACTIVE'` theo house, warn nếu phát hiện > 1 batch ACTIVE cùng lúc, trả về batch đầu tiên

**`getBatchContext(houseId, timestamp)`**:
- Tính `cropDay` theo timezone `Asia/Ho_Chi_Minh` bằng `toZonedTime()` từ `date-fns-tz`
- Giới hạn cropDay trong `[1, totalCropDays]`
- Fetch CurveCheckpoints, tách theo `TEMPERATURE`/`HUMIDITY`
- Fallback target = trung điểm của `[optimalMin, optimalMax]` nếu checkpoints rỗng
- Gọi `interpolate()` cho từng metric
- Query LightScheduleBlock theo `cropDay` với `LessThanOrEqual` / `MoreThanOrEqual`
- Return `BatchContext` đầy đủ cả camelCase lẫn snake_case (hỗ trợ Sprint 3)
- Nếu không có active batch → `getFallbackContext()` (bio-safety defaults)

**`interpolate(cropDay, checkpoints, defaultVal)`** (private):
- Sort checkpoints ascending
- Xử lý 3 biên: `cropDay <= first`, `cropDay >= last`, nằm giữa
- Công thức: `V1 + (cropDay - D1) / (D2 - D1) * (V2 - V1)`
- Làm tròn về bội số 0.5 gần nhất

**`createBatch(dto)`**:
- Verify `house_id` tồn tại trong DB
- Transaction + `pessimistic_write` lock để chống race condition khi tạo batch
- Throw `ConflictException` nếu đã có ACTIVE batch

**`endBatch(id, status)`**:
- Update status → `'COMPLETED'` hoặc `'ABORTED'`
- Throw `NotFoundException` nếu batch không tồn tại

**`getFallbackContext()`** (private):
- Trả về context an toàn sinh học mặc định: temp 28–35°C, humidity 70–90%, thermal shock protection ON (11:00–13:30)

#### `interface BatchContext` (exported):
- Dual format: cả `camelCase` lẫn `snake_case` cho toàn bộ fields
- Consumed by `TelemetryService.processTelemetry()` ở Sprint 3

### TRACK 3 — API & Module (E1)

#### Task E1 — BatchController + BatchModule ✅

**BatchController** (`@Controller('batches')`):
- `POST /batches` — gọi `createBatch(dto)`, return `CropBatch`
- `PATCH /batches/:id/end` — gọi `endBatch(id, status)`, return `CropBatch`
- `GET /batches/active/:houseId` — gọi `getActiveBatchByHouseId(houseId)`, return `CropBatch | null`

**DTOs**:
- `CreateBatchDto`: validate ID length, dải ngày 10–45 ngày, định dạng time `HH:MM:SS`, enum status
- `UpdateBatchDto`: validate `status: 'COMPLETED' | 'ABORTED'`

**BatchModule**:
- `TypeOrmModule.forFeature([CropBatch, MushroomHouse, CurveCheckpoint, LightScheduleBlock, GrowthProfile])`
- Export `BatchService` — để Sprint 3 `TelemetryService` inject

**Unit Tests**:
- `batch.service.spec.ts`: 25/25 test cases pass — bao gồm race condition, biên interpolation, fallback, timezone
- `batch.controller.spec.ts`: test đầy đủ 3 endpoint

---

## 4. TIÊU CHUẨN RÀ SOÁT (CHO QA)

| # | Tiêu chí | Cách verify |
|---|---|---|
| 1 | **Duy nhất ACTIVE batch/house** | Test race condition: gửi 2 `POST /batches` đồng thời với cùng `houseId` → chỉ 1 thành công |
| 2 | **Numeric transformer hoạt động** | Query `getActiveBatch` → các field `tempOptimalMin/Max` phải là `number`, không phải `string` |
| 3 | **Interpolation biên đúng** | Unit test coverage: `cropDay` < first checkpoint, > last checkpoint, danh sách rỗng |
| 4 | **Timezone UTC+7 độc lập server** | Tính `cropDay` khi server UTC+0 và server UTC+7 phải ra cùng kết quả |
| 5 | **Index `idx_checkpoints_batch`** | `EXPLAIN ANALYZE` query checkpoint theo `batch_id` phải thấy index scan |
| 6 | **ESLint + Build** | `pnpm lint && pnpm build` — 0 errors, 0 warnings |
| 7 | **Unit tests** | `pnpm test` — tất cả suites pass |

---

## 5. DEPENDENCY CHO SPRINT 3

Sprint 3 (`TelemetryService`) cần `BatchService` để:
- Gọi `getBatchContext(houseId, timestamp)` trong `processTelemetry()`
- Inject `BatchService` qua constructor (import `BatchModule` vào `TelemetryModule`)

**Blocker**: Sprint 3 có thể bắt đầu song song với QA Review Sprint 2, nhưng test end-to-end cần Sprint 2 được merge trước.
