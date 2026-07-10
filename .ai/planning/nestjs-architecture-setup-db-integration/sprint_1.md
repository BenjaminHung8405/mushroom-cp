# Sprint 1: Database Module & Connection Pool — ✅ HOÀN THÀNH

> **Status**: `[x] Done` — Đã được QA Review và duyệt lúc 22:15 ngày 09/07/2026.

---

## 1. MỤC TIÊU & PHẠM VI

Thiết lập hạ tầng cơ sở dữ liệu: cài đặt TypeORM, cấu hình DataSource kết nối TimescaleDB, loại bỏ raw `pg` Pool, đảm bảo toàn bộ truy vấn đi qua một connection pool duy nhất do TypeORM quản lý.

**Các file tác động:**
- [`package.json`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/package.json) — ghim phiên bản thư viện
- [`src/database/typeorm.config.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts) — Tạo mới
- [`src/database/database.module.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.module.ts) — Sửa đổi
- [`src/database/database.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.service.ts) — Sửa đổi
- [`src/main.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/main.ts) — Bổ sung global ValidationPipe

---

## 2. KIẾN TRÚC ĐÃ TRIỂN KHAI

```
[.env / process.env]
       │
       ▼
[typeorm.config.ts] ──(parse .env + build DataSourceOptions)──► [DataSource (TypeORM)]
       │                                                               │
       ▼ (forRootAsync)                                                ▼ (Connection Pool)
[DatabaseModule / @Global()] ──(inject)──► [DatabaseService.query()] ──► [TimescaleDB]
                                                    │
                                                    ▼ (Adapter Pattern)
                                        [TelemetryQueryService] (còn giữ tạm, xóa ở Sprint 4)
```

---

## 3. CHI TIẾT ĐÃ IMPLEMENT

### Task A1 — package.json ✅
- Ghim cứng phiên bản: `@nestjs/typeorm: 11.0.3`, `typeorm: 1.0.0`, `date-fns-tz: 3.2.0`
- Thêm scripts: `migration:run`, `migration:revert` qua `typeorm-ts-node-commonjs`
- Ghim thêm: `class-validator`, `class-transformer` cho DTO validation

### Task B1 — typeorm.config.ts ✅
Cơ chế đọc cấu hình 2 tầng:
1. **Parse `.env` thông minh**: Xử lý quoted string, inline comment (`# ...`), không ghi đè biến env đã tồn tại trong system (hỗ trợ Docker/CI)
2. **Ưu tiên `DATABASE_URL`**: Nếu có → dùng ngay. Nếu không → dùng `POSTGRES_*` riêng lẻ
3. **Bảo vệ test environment**: `retryAttempts: 0` khi `NODE_ENV=test`, không throw error khi thiếu biến trong môi trường test
4. Pool limits: `max=20`, `idleTimeoutMillis=30000`, `connectionTimeoutMillis=2000`
5. `synchronize: false` — bắt buộc để bảo vệ hypertable chunks

### Task B2 — database.module.ts ✅
- `@Global()` decorator để tránh re-import ở các module con
- `TypeOrmModule.forRootAsync({ useFactory: () => typeOrmConfig })`
- Export `TypeOrmModule` để các feature module dùng `@InjectRepository()`
- Export `DatabaseService`, `TelemetryQueryService` (legacy, sẽ xóa ở Sprint 4)

### Task B3 — database.service.ts ✅
- Xóa hoàn toàn `pg.Pool` thô, thay bằng inject `DataSource` từ TypeORM
- `onModuleInit()`: chạy `SELECT NOW()` để kiểm tra kết nối, log structured qua NestJS Logger
- `query<T>(text, params)`: Adapter Pattern — wrap `DataSource.query()`, trả về `{ rows: T[] }` để tương thích ngược với `TelemetryQueryService`
- Parameterized queries — chống SQL injection
- Xử lý kiểu `unknown` trong catch block (TypeScript strict)

### Bổ sung — main.ts ✅
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — apply cho toàn bộ API
- Sửa E2E test: `retryAttempts: 0` trong test env, thêm null-check cho `app` trong cleanup

### Bổ sung — TelemetryQueryService ✅ (legacy, kept for Sprint 3 reference)
File [`src/database/telemetry-query.service.ts`](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts) — được giữ lại từ lần trước refactor, export đầy đủ interface `TelemetryLogInput`, `TelemetryLog`, các method:
- `insertTelemetry(input)` — INSERT vào hypertable `telemetry_logs`
- `getLatestTelemetryForHouse(houseId)` — lấy bản ghi mới nhất
- `getBatchHistory(batchId, start, end)` — query theo khoảng thời gian
- `getCurveCheckpointsForBatch(batchId, metricType?)` — lấy checkpoints
> ⚠️ Service này sẽ bị **xóa ở Sprint 4** khi `TelemetryService` chính thức thay thế.

---

## 4. QA REVIEW — KẾT QUẢ ✅ LGTM

**Ngày duyệt**: 2026-07-09T22:15:00+07:00

| Tiêu chí | Kết quả |
|---|---|
| Không hardcode credentials | ✅ Pass |
| `synchronize: false` bảo vệ hypertable | ✅ Pass |
| Connection pool không trùng lặp | ✅ Pass |
| Validation DTO toàn cục | ✅ Pass |
| E2E test không bị treo | ✅ Pass |
| ESLint không lỗi/warning | ✅ Pass |
| `pnpm build` thành công | ✅ Pass |

---

## 5. CÁC VẤN ĐỀ ĐÃ GIẢI QUYẾT TRONG QUÁ TRÌNH REVIEW

1. **E2E test bị treo**: Thêm `retryAttempts: 0` trong test env, null-check cho `app` trong `afterEach`
2. **TypeORM crash trong test do import-time throw**: Skip error throw khi `NODE_ENV=test`
3. **ESLint lỗi async/await**: Chuyển `onModuleInit`, `onModuleDestroy`, `connect` về sync khi không có `await`
4. **MQTT fallback env**: Thêm fallback đọc `MQTT_BACKEND_USER`/`MQTT_BACKEND_PASS` khi chạy local (không có `MQTT_USERNAME`/`MQTT_PASSWORD`)
5. **Parser `.env` bẻ gãy password chứa `#`**: Chỉ strip comment nếu `#` đứng sau whitespace, giữ nguyên `#` trong quoted strings
