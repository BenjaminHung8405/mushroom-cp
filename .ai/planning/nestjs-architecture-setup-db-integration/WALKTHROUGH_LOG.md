# WALKTHROUGH_LOG.md

## [2026-07-10T16:25:00+07:00] - Task F1: Tạo thực thể TelemetryLog ánh xạ hypertable
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [telemetry-log.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/entities/telemetry-log.entity.ts)
  - Tạo mới: [telemetry-log.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/telemetry/entities/telemetry-log.entity.spec.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/PROGRESS.md)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `TelemetryLog` tương ứng với bảng TimescaleDB hypertable `telemetry_logs`.
  - Thiết lập `@Entity('telemetry_logs', { synchronize: false })` để ngăn chặn TypeORM tự động đồng bộ hóa/thay đổi cấu trúc bảng TimescaleDB.
  - Định nghĩa khóa chính phức hợp (Composite PK) gồm `@PrimaryColumn({ name: 'time', type: 'timestamptz' })` và `@PrimaryColumn({ name: 'batch_id', type: 'varchar', length: 50 })` theo đúng schema thực tế.
  - Sử dụng `numericTransformer` cho các trường kiểu `numeric` (`humidity_measured`, `temperature_measured`, `humidity_setpoint`, `temperature_setpoint`, `humidity_error_delta`, `temperature_error_delta`) để tự động chuyển đổi chuỗi từ PostgreSQL driver thành kiểu `number` an toàn hoặc trả về `null` nếu dữ liệu trống.
  - Khai báo đúng các cột trạng thái ON/OFF kiểu `boolean` cho thiết bị chấp hành (`mist_generator_active`, `convection_fan_active`, `heating_lamp_active`) thay cho cấu hình PWM cũ, khớp chuẩn xác với database.
  - Viết bộ unit test đầy đủ trong `telemetry-log.entity.spec.ts` nhằm đảm bảo việc gán và đọc dữ liệu hoạt động chính xác.
  - Tự kiểm tra: Đã chạy `pnpm run lint`, `pnpm run build` và `pnpm test` thành công 100% không phát sinh bất kỳ warning hay lỗi nào.

## [2026-07-10T15:30:00+07:00] - QA Review Round 2: Tasks C4 + C5 — ✅ LGTM
- **Trạng thái**: LGTM (Duyệt)
- **Reviewer**: Claude (Security Auditor & Senior Code Reviewer)
- **Kết quả rà soát**:
  - **C4 CurveCheckpoint**: ✅ LGTM — Finding C4-1 đã fix. `@Index('idx_checkpoints_batch', ['batchId', 'metricType'])` khớp chính xác schema SQL `CREATE INDEX idx_checkpoints_batch ON curve_checkpoints (batch_id, metric_type)`. PK bigint, numeric transformer null-safe, cascade delete đúng.
  - **C5 LightScheduleBlock**: ✅ LGTM — Finding C5-1 đã fix. `@BeforeInsert()` + `@BeforeUpdate()` validate: (1) XOR origin `(profileId == null) === (batchId == null)` → throw BadRequestException; (2) `startDay > endDay` → throw. Khớp constraints `check_light_origin` + `check_days_order` trong schema SQL. Unit tests cover 4 validation cases + 2 happy paths.
  - **Kiến trúc & Conventions**: Entity layer đúng Clean Architecture, SRP, naming kebab/Pascal/camel/snake nhất quán. Hàm `validate()` 9 dòng — dưới ngưỡng 50.
  - **Bảo mật**: Không hardcode secret. Defense-in-depth: entity-level validation + DB CHECK constraints. BadRequestException message an toàn (không leak internals).
  - **Logic & Edge-cases**: Null-safe (`== null` bao gồm undefined). Error handling kín — throw rõ ràng, không silent fail. Cascade delete đúng.
  - **Độ tối ưu**: Validation pure in-memory O(1), không query DB. Không N+1.
  - **Test**: 8/8 pass (curve-checkpoint + light-schedule-block). Lint + build sạch.
  - **Minor (không chặn)**: `== null` loose equality thay vì `=== null || === undefined` — intentional & safe.
- **Quyết định**: Duyệt C4 + C5. Sprint 2 (C1–C5, D1, E1) hoàn thành 100%. Cho phép cập nhật Task C4, C5 sang `[x] Done` trong PROGRESS.md.

## [2026-07-10T15:18:00+07:00] - QA Fix Round 2: Tasks C4 + C5 (Findings C4-1 & C5-1)
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Task ID**: C4, C5
- **Danh sách file đã sửa**:
  - Sửa đổi: [curve-checkpoint.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/curve-checkpoint.entity.ts)
  - Sửa đổi: [light-schedule-block.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.ts)
  - Sửa đổi: [light-schedule-block.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.spec.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/PROGRESS.md)
- **Giải trình sửa lỗi theo feedback QA**:
  - **Finding C4-1 (Index mismatch)**: Đổi `@Index('idx_checkpoints_batch', ['batch'])` thành `@Index('idx_checkpoints_batch', ['batchId', 'metricType'])` để khớp chuẩn xác với chỉ mục phức hợp `idx_checkpoints_batch` trên database SQL schema thực tế (`batch_id`, `metric_type`).
  - **Finding C5-1 (Missing constraints)**: Thêm các TypeORM lifecycle hooks `@BeforeInsert()` và `@BeforeUpdate()` trên entity `LightScheduleBlock` để tự động kích hoạt hàm validation thực thi 2 ràng buộc CHECK ở tầng database: (1) `check_light_origin` (yêu cầu XOR: `profileId` hoặc `batchId` phải được chỉ định, không được đồng thời set cả 2 và không được null cả 2), và (2) `check_days_order` (yêu cầu `startDay <= endDay`). Đồng thời bổ sung đầy đủ unit tests kiểm định các case vi phạm ràng buộc này.

## [2026-07-10T15:10:00+07:00] - QA Review Track C (Entities C1–C5) — ⚠️ 2 FINDINGS
- **Trạng thái**: Từ chối duyệt C4 + C5 · C1–C3 LGTM
- **Reviewer**: Claude (Security Auditor & Senior Code Reviewer)
- **Kết quả rà soát**:
  - **C1 MushroomHouse**: ✅ LGTM — mapping schema chính xác, snake_case đúng, test đủ.
  - **C2 GrowthProfile**: ✅ LGTM — mapping schema chính xác, timestamps đúng, không relation.
  - **C3 CropBatch**: ✅ LGTM — mapping schema chính xác, numeric transformer fallback an toàn, FK RESTRICT đúng. Minor: `status` field nên dùng enum TypeORM thay vì `string` (không chặn).
  - **C4 CurveCheckpoint**: ⚠️ **Finding C4-1 (Medium)** — Index `@Index('idx_checkpoints_batch', ['batch'])` sai column name. Schema SQL tạo index trên `batch_id` (snake_case) + `metric_type` với `INCLUDE (crop_day, target_value)`. Entity đang index trên `batch` (camelCase) — TypeORM sẽ tạo index trùng tên trên column không tồn tại. **Fix**: Đổi thành `@Index('idx_checkpoints_batch', ['batchId', 'metricType'])`.
  - **C5 LightScheduleBlock**: ⚠️ **Finding C5-1 (Medium)** — Thiếu validation CHECK constraints của schema SQL: (1) `check_light_origin`: profile_id XOR batch_id (không null cả 2, không có cả 2); (2) `check_days_order`: start_day ≤ end_day. Entity không validate → client gửi dữ liệu vi phạm → DB reject với error khó debug. **Fix**: Thêm validation trong BatchService hoặc DTO.
  - **Kiến trúc & Conventions**: Tất cả 5 entities tuân thủ Clean Architecture, naming conventions đúng, không DRY violation.
  - **Bảo mật**: Không hardcode secret. Input validation nằm ở DTO/controller layer (đã cover D1/E1).
  - **Logic & Edge-cases**: Numeric transformer null-safe. Relations cascade delete đúng. Tests pass 7/7.
  - **Test**: 5 suites pass, 7 tests pass. Build + lint sạch.
- **Quyết định**: Từ chối duyệt C4 + C5. Fix 2 findings rồi submit lại. C1–C3 đã LGTM.

## [2026-07-10T15:00:00+07:00] - QA Review Final: Tasks D1 + E1 — ✅ LGTM
- **Trạng thái**: LGTM (Duyệt)
- **Reviewer**: Claude (Security Auditor & Senior Code Reviewer)
- **Kết quả rà soát**:
  - **Kiến trúc & Conventions**: Phân tầng Clean Architecture đúng — DTO → Controller → Service → Entity. Không có sai layer. Hàm ngắn (<50 dòng), DRY tuân thủ. Naming conventions (kebab-case, PascalCase, camelCase, snake_case DB) nhất quán.
  - **Bảo mật**: Không hardcode secret. Input validate toàn diện: route params `@Matches` regex + `@MaxLength(50)`, DTO bounded numeric (`@Min/@Max`), time format `@Matches`, enum status. Query parameterized qua TypeORM ORM — không SQL injection.
  - **Logic & Edge-cases**: Error handling kín — `NotFoundException`, `ConflictException`, null-safe `?? null`. State machine guard `endBatch` (chỉ ACTIVE mới end được). Race condition `createBatch` dùng transaction + `pessimistic_write`. Timezone `Asia/Ho_Chi_Minh` clamp `[1, totalCropDays]`. Interpolation xử lý đầy đủ biên (empty, before-first, after-last, equal-days). Bio-safety fallback an toàn.
  - **Độ tối ưu**: Không N+1 query (4 queries cho 1 batch context là chấp nhận được). Sorting trong interpolate overhead thấp với checkpoint count nhỏ.
  - **Minor observations (không chặn)**: (1) `endBatch` TOCTOU gap — có thể thêm `@VersionColumn` optimistic locking. (2) `createBatch` house check ngoài transaction — rủi ro thấp. (3) `interpolate` linear scan thay vì binary search — OK cho dataset nhỏ.
  - **Test**: 35/35 pass (batch.controller.spec.ts + batch.service.spec.ts).
- **Quyết định**: Duyệt. Cho phép cập nhật Task D1 và E1 sang `[x] Done` trong PROGRESS.md.

## [2026-07-10T14:50:00+07:00] - QA Fix Round 2: Tasks D1 + E1 (Findings Finding 1 - Finding 2)
- **Trạng thái**: Đã được fix và submit lại cho QA Review (Lần 2)
- **Task ID**: D1, E1
- **Danh sách file đã sửa**:
  - Tạo mới: [batch.params.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/batch.params.dto.ts)
  - Sửa đổi: [batch.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts)
  - Sửa đổi: [batch.controller.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.spec.ts)
  - Sửa đổi: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)
  - Sửa đổi: [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/PROGRESS.md)
- **Giải trình sửa lỗi theo feedback QA**:
  - **Finding 1 (Route params không validate)**: Tạo mới file `batch.params.dto.ts` để định nghĩa DTO validate cho route parameters `id` (`BatchIdParamsDto`) và `houseId` (`HouseIdParamsDto`) bằng cách dùng các validator `@IsString()`, `@Matches()`, `@MaxLength(50)`. Cập nhật `BatchController` và test case tương ứng để dùng các DTO này.
  - **Finding 2 (endBatch không enforce state machine)**: Thêm logic guard kiểm tra trạng thái trước khi cho phép cập nhật trạng thái trong `endBatch` tại `batch.service.ts`. Ném `ConflictException` nếu trạng thái hiện tại khác `ACTIVE`. Bổ sung unit test để kiểm định trường hợp này.

## [2026-07-10T14:15:00+07:00] - QA Fix Round 2: Tasks D1 + E1 (Findings F1–F5)
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Task ID**: D1, E1
- **Danh sách file đã sửa**:
  - Sửa đổi: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)
  - Sửa đổi: [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts)
  - Sửa đổi: [create-batch.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/create-batch.dto.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/PROGRESS.md)
- **Giải trình sửa lỗi theo feedback QA**:
  - **F1 (getBatchContext 98 dòng)**: Tách `calculateCropDay(activeBatch, timestamp)` và `assembleContext(activeBatch, cropDay, targetTemp, targetHumid, lightStatus)` thành private helpers — `getBatchContext` giờ chỉ điều phối, dưới 50 dòng.
  - **F2 (interpolate 58 dòng)**: Extract `safeTargetValue(cc)` để gộp 4 lần pattern `typeof v === 'string' ? parseFloat(v) : v`; `interpolate` còn ~45 dòng.
  - **F3 (Missing MaxLength)**: Thêm `@MaxLength(50)` trên `CreateBatchDto.id` và `houseId` — khớp VARCHAR(50) entity, chặn payload oversized trước khi hit DB.
  - **F4 (Silent degradation multi-ACTIVE)**: `getActiveBatchByHouseId` ném `ConflictException` + `logger.error` khi `length > 1` thay vì warn + return first — bảo vệ invariant "1 ACTIVE / house_id".
  - **F5 (Unbounded numeric)**: `tempOptimalMin/Max` → `@Min(0) @Max(60)`; `humidityOptimalMin/Max` → `@Min(0) @Max(100)`.
  - Unit test cập nhật: case multi-active giờ expect `ConflictException`.
  - Verify: `pnpm exec jest --testPathPatterns=batch` 34/34 pass · `pnpm lint` · `pnpm build` sạch.

## [2026-07-10T09:40:00+07:00] - Task E1: Xây dựng BatchController và BatchModule
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [create-batch.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/create-batch.dto.ts)
  - Tạo mới: [update-batch.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/update-batch.dto.ts)
  - Tạo mới: [batch.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts)
  - Tạo mới: [batch.controller.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.spec.ts)
  - Tạo mới: [batch.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/batch.module.ts)
  - Sửa đổi: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)
  - Sửa đổi: [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts)
- **Giải trình giải pháp**:
  - Triển khai `CreateBatchDto` và `UpdateBatchDto` bằng `class-validator` để kiểm soát dữ liệu đầu vào (độ dài ID, dải ngày nuôi từ 10 đến 45 ngày, định dạng thời gian bảo vệ sốc nhiệt, và Enum trạng thái).
  - Cập nhật `BatchService` để cung cấp 2 phương thức cốt lõi mới:
    - `createBatch`: Kiểm tra sự tồn tại của nhà nấm (`house_id`) trước khi tạo vụ nuôi. Sử dụng cơ chế Transaction kết hợp với khóa đọc ghi bi quan (`pessimistic_write` lock) để kiểm soát điều kiện cạnh tranh (race condition), đảm bảo tại một thời điểm mỗi nhà nấm chỉ có duy nhất một vụ nuôi ở trạng thái `ACTIVE`.
    - `endBatch`: Cập nhật trạng thái của vụ nuôi thành `COMPLETED` hoặc `ABORTED`.
  - Triển khai `BatchController` cung cấp các API:
    - `POST /batches` để tạo mới vụ nuôi với validation DTO chặt chẽ.
    - `PATCH /batches/:id/end` để kết thúc hoặc hủy vụ nuôi.
    - `GET /batches/active/:houseId` để lấy thông tin vụ nuôi đang chạy của một nhà nấm cụ thể.
  - Xây dựng `BatchModule` đăng ký các TypeORM entities cần thiết (`CropBatch`, `MushroomHouse`, `CurveCheckpoint`, `LightScheduleBlock`, `GrowthProfile`), khai báo `BatchController` và `BatchService`, export `BatchService` để tái sử dụng ở các module khác.
  - Bổ sung bộ unit test đầy đủ cho cả `BatchService` và `BatchController` bao gồm kiểm thử race conditions, kiểm thử validation biên, và cập nhật mock repository của `MushroomHouse`.
  - Tự kiểm tra: Chạy `npm run format`, `npm run lint`, `npm run build` và `npm test` thành công 100% không gặp bất kỳ lỗi nào.

## [2026-07-09T22:48:00+07:00] - Task D1: Triển khai các phương thức cốt lõi trong BatchService
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)
  - Tạo mới: [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts)
- **Giải trình giải pháp**:
  - Triển khai `BatchService` cung cấp 2 phương thức chính: `getActiveBatchByHouseId` và `getBatchContext`.
  - Thiết kế `getActiveBatchByHouseId` truy vấn vụ nuôi đang hoạt động (`ACTIVE`) cho nhà nấm và cảnh báo nếu phát hiện nhiều vụ nuôi đang `ACTIVE` đồng thời.
  - Thiết kế `getBatchContext` xử lý tính toán số ngày tuổi `cropDay` chính xác dựa trên múi giờ Việt Nam (`Asia/Ho_Chi_Minh`) và giới hạn từ `1` đến `totalCropDays`.
  - Triển khai thuật toán nội suy tuyến tính (Linear Interpolation) động từ dữ liệu checkpoints `CurveCheckpoint` đối với nhiệt độ (`TEMPERATURE`) và độ ẩm (`HUMIDITY`).
  - Xử lý các biên của thuật toán nội suy: lấy giá trị checkpoint biên gần nhất nếu ngày tuổi ngoài dải, fallback về trung điểm của optimal range của batch nếu danh sách checkpoints rỗng.
  - Tích hợp kiểm tra trạng thái ánh sáng của `LightScheduleBlock` cho `cropDay` hiện tại.
  - Trả về đối tượng `BatchContext` chứa đầy đủ thông tin hỗ trợ cả camelCase và snake_case cho các sprint sau.
  - Viết bộ unit test đầy đủ trong `batch.service.spec.ts` phủ toàn bộ các trường hợp logic, chạy kiểm thử nội bộ pass 100% (25/25 test cases thành công).

## [2026-07-09T22:41:00+07:00] - Task C5: Tạo thực thể LightScheduleBlock
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [light-schedule-block.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.ts)
  - Tạo mới: [light-schedule-block.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.spec.ts)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `LightScheduleBlock` tương ứng với bảng `light_schedule_blocks` trong schema PostgreSQL.
  - Sử dụng `@PrimaryGeneratedColumn({ type: 'bigint' })` cho khóa chính `id` để tương thích với cột kiểu BIGSERIAL trong DB.
  - Cấu hình quan hệ `@ManyToOne` với `GrowthProfile` và `CropBatch` sử dụng `@JoinColumn` tương ứng với `profile_id` và `batch_id`, đồng thời cài đặt cascade delete.
  - Ánh xạ chính xác các thuộc tính `startDay` và `endDay` kiểu integer, và thuộc tính `status` sử dụng union type `'ON' | 'OFF'`.
  - Viết unit test đầy đủ cho entity `LightScheduleBlock` bao gồm kiểm thử liên kết với `GrowthProfile` và `CropBatch`.
  - Tự kiểm tra: Chạy lệnh `pnpm test` thành công 100%, tất cả 6 test suites (bao gồm cả `light-schedule-block.entity.spec.ts`) đều pass.

## [2026-07-09T22:40:00+07:00] - Task C4: Tạo thực thể CurveCheckpoint
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [curve-checkpoint.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/curve-checkpoint.entity.ts)
  - Tạo mới: [curve-checkpoint.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/curve-checkpoint.entity.spec.ts)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `CurveCheckpoint` tương ứng với bảng `curve_checkpoints` trong schema PostgreSQL.
  - Sử dụng `@PrimaryGeneratedColumn({ type: 'bigint' })` cho khóa chính `id` để tương thích với cột kiểu BIGSERIAL trong DB.
  - Cấu hình quan hệ `@ManyToOne` với `GrowthProfile` và `CropBatch` sử dụng `@JoinColumn` tương ứng với `profile_id` và `batch_id`, đồng thời cài đặt cascade delete.
  - Sử dụng transformer cho cột `targetValue` (numeric(4,1)) để tự động parse giá trị string trả về từ PostgreSQL driver sang số thực trong Javascript, tránh lỗi tính toán.
  - Thiết lập chỉ mục `@Index('idx_checkpoints_batch', ['batch'])` ở cấp độ entity nhằm tối ưu hóa hiệu năng truy vấn, tránh full table scan khi lọc checkpoints theo vụ nuôi.
  - Viết unit test đầy đủ cho entity `CurveCheckpoint` bao gồm kiểm thử liên kết với `GrowthProfile` và `CropBatch`.
  - Tự kiểm tra: Chạy lệnh `npm test` thành công 100%, tất cả 5 test suites (bao gồm cả `curve-checkpoint.entity.spec.ts`) đều pass.

## [2026-07-09T22:32:00+07:00] - Task C3: Tạo thực thể CropBatch
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [crop-batch.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/crop-batch.entity.ts)
  - Tạo mới: [crop-batch.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/crop-batch.entity.spec.ts)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `CropBatch` tương ứng với bảng `crop_batches` trong schema PostgreSQL.
  - Thiết lập mối quan hệ `@ManyToOne` với `MushroomHouse` dùng `@JoinColumn({ name: 'house_id' })` đảm bảo Foreign Key hoạt động tối ưu.
  - Sử dụng transformer cho các cột kiểu `numeric` để chuyển đổi tự động từ kiểu string trả về từ PostgreSQL sang kiểu float/number của Javascript, tránh lỗi tính toán.
  - Viết unit test cho entity `CropBatch` để kiểm thử cấu trúc và kiểm thử đơn vị thành công 100%.
  - Tự kiểm tra: Chạy thử nghiệm các unit test trong module batch thành công.


## [2026-07-09T22:30:00+07:00] - Task C2: Tạo thực thể GrowthProfile
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [growth-profile.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/growth-profile.entity.ts)
  - Tạo mới: [growth-profile.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/growth-profile.entity.spec.ts)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `GrowthProfile` tương ứng với bảng `growth_profiles` trong schema PostgreSQL.
  - Sử dụng `@PrimaryColumn()` cho thuộc tính `id` dạng string (VARCHAR(50)).
  - Ánh xạ chính xác các thuộc tính: `name` (VARCHAR(100)), `description` (TEXT, nullable).
  - Định cấu hình tự động cho các thuộc tính ngày tháng với `@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })` và `@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })` để đồng bộ timezone.
  - Viết unit test cho entity `GrowthProfile` để kiểm thử cấu trúc và kiểu dữ liệu.
  - Tự kiểm tra: Build ứng dụng (`pnpm run build`), chạy ESLint (`pnpm run lint`) và kiểm thử đơn vị (`pnpm test`) thành công 100%.

## [2026-07-09T22:26:00+07:00] - Task C1: Tạo thực thể MushroomHouse
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [mushroom-house.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/mushroom-house.entity.ts)
  - Tạo mới: [mushroom-house.entity.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/mushroom-house.entity.spec.ts)
- **Giải trình giải pháp**:
  - Khởi tạo TypeORM entity `MushroomHouse` tương ứng với bảng `mushroom_houses` trong schema PostgreSQL.
  - Sử dụng `@PrimaryColumn()` cho thuộc tính `id` dạng string (VARCHAR(50)).
  - Ánh xạ chính xác các trường snake_case: `area_meters` sang `areaMeters`, `pillar_count` sang `pillarCount`, `created_at` sang `createdAt` (sử dụng decorator `@CreateDateColumn()`).
  - Viết Unit Test cho entity `MushroomHouse` để đảm bảo thực thể được tạo ra hoạt động chính xác.
  - Tự kiểm tra: Build ứng dụng (`pnpm run build`), chạy ESLint (`pnpm run lint`) và kiểm thử đơn vị (`pnpm test`) thành công 100%.

## [2026-07-09T22:15:00+07:00] - QA Review: Duyệt hoàn thành Sprint 1 (Tasks A1, B1, B2, B3)
- **Trạng thái**: LGTM (Looks Good To Me)
- **Đánh giá kiểm toán**:
  - **Kiến trúc & Conventions**: Cấu trúc thư mục NestJS phân tầng rõ ràng, tách biệt layer Infrastructure (MQTT), Application, và Data Access (TypeORM). Các hàm đều được tách helper đảm bảo độ dài < 50 dòng theo Clean Code.
  - **Bảo mật**: Không hardcode password/credentials nhạy cảm. Input được validate chặt chẽ ở cấp độ DTO (DeviceParamsDto, DeviceSetpointDto) và endpoint với global ValidationPipe, triệt tiêu nguy cơ SQL Injection và Path Traversal.
  - **Logic & Edge-cases**: Bổ sung fallback biến môi trường local. Cơ chế check null/undefined cho các luồng dữ liệu thô đảm bảo không xảy ra sập ứng dụng (Null Pointer Exception).
  - **Độ tối ưu**: Consolidated Connection Pool của TypeORM hoạt động ổn định với các giới hạn tối ưu (`max = 20`, `idleTimeoutMillis = 30000`, `connectionTimeoutMillis = 2000`). Chạy E2E test ổn định không bị treo.
- **Quyết định**: Duyệt và chuyển trạng thái Sprint 1 sang `[x] Done`.

## [2026-07-09T22:11:00+07:00] - Task B1: Khắc phục lỗi bộ phân tích cú pháp .env theo Feedback của QA
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Danh sách file thay đổi**:
  - Sửa đổi: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
- **Giải trình giải pháp**:
  - Cập nhật cơ chế phân tích cú pháp trong bộ tự chế `.env` để xử lý chuỗi thông minh hơn: Nếu giá trị bắt đầu bằng dấu nháy (`"` hoặc `'`), trích xuất nội dung giữa dấu nháy mở và đóng tương ứng, bỏ qua bất kỳ ký tự `#` nào bên trong. Nếu không có dấu nháy, chỉ coi `#` là inline comment nếu nó đứng sau một khoảng trắng (` # comment`), tránh bẻ gãy mật khẩu hoặc chuỗi kết nối chứa ký tự `#`.

## [2026-07-09T22:05:00+07:00] - Tasks A1, B1, B2, B3: Khắc phục lỗi và nợ kỹ thuật theo Feedback của QA (Lần 5 / Lần 3)
- **Trạng thái**: Đang chờ QA Review (Lần 3)
- **Danh sách file thay đổi**:
  - Sửa đổi: [mqtt.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts)
  - Sửa đổi: [telemetry-query.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts)
  - Sửa đổi: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
- **Giải trình giải pháp**:
  - **Sửa lỗi Cấu hình & Logic Vận hành (mqtt.service.ts)**: Cấu hình cơ chế fallback đọc từ biến môi trường local `MQTT_BACKEND_USER` và `MQTT_BACKEND_PASS` nếu `MQTT_USERNAME` hoặc `MQTT_PASSWORD` bị `undefined` khi chạy ứng dụng ở máy local (`pnpm run start:dev`).
  - **Sửa lỗi Convention về Độ dài Hàm (telemetry-query.service.ts)**: Trích xuất hằng số `INSERT_TELEMETRY_QUERY` ra ngoài phạm vi hàm (mức module) để giảm số lượng dòng của hàm `insertTelemetry` xuống còn 42 dòng (dưới giới hạn 50 dòng theo quy tắc Clean Code).
  - **Sửa lỗi Edge-case & Tiềm ẩn Crash (mqtt.service.ts)**: Bổ sung kiểm tra tính hợp lệ của `parsedPayload` trước khi truy cập thuộc tính `.status` (đảm bảo không null, là object và có key `'status'`) để ngăn chặn TypeError nếu thiết bị gửi payload chuỗi đặc biệt (ví dụ `"null"` thô).
  - **Sửa lỗi Bộ phân tích cú pháp .env (typeorm.config.ts)**: Cập nhật bộ parser để loại bỏ các comment cùng dòng (inline comment) chứa ký tự `#` khi trích xuất giá trị các biến môi trường từ file `.env`.

## [2026-07-09T21:58:00+07:00] - Tasks A1, B1, B2, B3: Khắc phục lỗi và nợ kỹ thuật theo Feedback của QA (Lần 4 / Lần 2)
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Danh sách file thay đổi**:
  - Sửa đổi: [package.json](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/package.json)
  - Sửa đổi: [main.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/main.ts)
  - Sửa đổi: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
  - Sửa đổi: [device.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/device/device.controller.ts)
  - Sửa đổi: [telemetry-query.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts)
  - Sửa đổi: [app.e2e-spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/test/app.e2e-spec.ts)
- **Giải trình giải pháp**:
  - **Khắc phục lỗi treo E2E Test**: Cấu hình `retryAttempts: 0` khi chạy trong môi trường kiểm thử (`NODE_ENV === 'test'`) và bổ sung kiểm tra an toàn cho biến `app` trong Jest cleanup block `afterEach`. Điều này ngăn chặn tình trạng Jest bị treo do tiến trình retry kết nối database ngầm.
  - **Bổ sung Validation & Bảo mật**: Cài đặt và ghim phiên bản của `class-validator` và `class-transformer` trong `package.json`. Kích hoạt global `ValidationPipe` trong `main.ts`. Định nghĩa DTO `DeviceParamsDto` và `DeviceSetpointDto` trong `device.controller.ts` để kiểm soát chặt chẽ kiểu dữ liệu, giới hạn ngưỡng an toàn sinh học của setpoint và định dạng của device ID, ngăn chặn các lệnh độc hại.
  - **Tối ưu hàm telemetry & an toàn dữ liệu**: Tách hàm helper `calculateDelta` trong `telemetry-query.service.ts` để đưa số lượng dòng của hàm `insertTelemetry` về dưới 50 dòng. Đồng thời, thêm kiểm tra an toàn dữ liệu trả về từ database để loại bỏ nguy cơ Null Pointer Exception.
  - **Tối ưu code DRY**: Gom các option chung của cấu hình DataSource thành `commonOptions` trong `typeorm.config.ts` để loại bỏ mã lặp.

## [2026-07-09T21:51:00+07:00] - Task B1: Khắc phục lỗi cấu hình và ESLint theo Feedback của QA (Lần 3)
- **Trạng thái**: Đang chờ QA Review (Lần 3)
- **Danh sách file thay đổi**:
  - Sửa đổi: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
  - Sửa đổi: [device.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/device/device.controller.ts)
  - Sửa đổi: [mqtt.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts)
  - Sửa đổi: [main.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/main.ts)
- **Giải trình giải pháp**:
  - **Sửa lỗi sập test E2E (Import-time Crash)**: Cập nhật `typeorm.config.ts` bỏ qua việc `throw new Error` khi thiếu các biến môi trường nếu đang chạy trong môi trường kiểm thử (`process.env.NODE_ENV === 'test'`). Điều này ngăn chặn crash tiến trình lúc parse/import module khi chạy Jest test.
  - **Sửa lỗi ESLint**:
    - [device.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/device/device.controller.ts): Xóa import unused `Res`.
    - [mqtt.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/mqtt.service.ts): Chuyển các hàm `onModuleInit`, `onModuleDestroy`, và `connect` từ `async` thành đồng bộ thông thường vì chúng không chứa bất kỳ từ khóa `await` nào; Ép kiểu `parsedPayload.status as string` để khắc phục lỗi `@typescript-eslint/restrict-template-expressions` khi dùng biến có kiểu `never` trong string template.
    - [main.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/main.ts): Thêm từ khóa `void` trước lệnh gọi `bootstrap()` để sửa lỗi floating promise.
  - **Xác thực phiên bản TypeORM**: Kiểm tra thông tin NPM cho thấy tại thời điểm năm 2026, tag `latest` chính thức của thư viện `typeorm` chính là phiên bản `1.0.0`, do đó phiên bản được ghim trong `package.json` là hoàn toàn chính xác và an toàn (không phải fork hay nhầm lẫn).
- **Kết quả tự kiểm tra**:
  - Lệnh `pnpm run lint` chạy thành công 100% không còn bất kỳ lỗi/cảnh báo nào.
  - Lệnh `pnpm run build` chạy thành công 100% hoàn thành biên dịch dự án.
  - Lệnh `pnpm test` chạy thành công 100%.
  - Lệnh `pnpm test:e2e` không còn bị lỗi crash ở import-time mà chuyển sang trạng thái cố gắng kết nối DB.

## [2026-07-09T21:43:00+07:00] - Task B1: Khắc phục lỗi cấu hình TypeORM theo Feedback của QA (Lần 2)
- **Trạng thái**: Đang chờ QA Review (Lần 2)
- **Danh sách file thay đổi**:
  - Sửa đổi: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
- **Giải trình giải pháp**:
  - Loại bỏ hoàn toàn các giá trị hardcode nhạy cảm (`admin`, `123456`, `localhost`, `5432`, `mushroom_iot_db`). Chương trình sẽ ném lỗi cụ thể và dừng khởi động nếu thiếu các biến môi trường bắt buộc (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`).
  - Tách biệt logic nạp biến môi trường từ file `.env` và pha dựng cấu hình từ `process.env`. Quá trình kiểm tra và dựng tham số kết nối được thực thi độc lập với sự tồn tại của file `.env` (hỗ trợ hoàn hảo môi trường container/Docker/K8s).
  - Sử dụng cấu hình thuộc tính nguyên tử (`host`, `port`, `username`, `password`, `database`) của TypeORM khi không có `DATABASE_URL` thay vì cộng chuỗi thủ công, ngăn ngừa rủi ro đứt gãy kết nối do ký tự đặc biệt trong mật khẩu.
- **Kết quả tự kiểm tra**:
  - Chạy `pnpm run build` thành công, biên dịch dự án hoàn hảo không lỗi.
  - Chạy `pnpm run test` thành công, các bài kiểm thử vượt qua.
  - Chạy `pnpm run lint` trên file `typeorm.config.ts` thành công không phát sinh bất kỳ lỗi/cảnh báo nào.

## [2026-07-09T21:35:00+07:00] - Task B3: Refactor DatabaseService để loại bỏ pg Pool
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [database.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.service.ts)
- **Giải trình giải pháp**:
  - Refactor `DatabaseService` loại bỏ hoàn toàn `pg` Pool và thay thế bằng TypeORM `DataSource`.
  - Sử dụng Adapter Pattern bằng cách bọc phương thức `query()` của TypeORM `DataSource` để giữ nguyên chữ ký hàm (interface) cũ (trả về đối tượng `{ rows: T[] }`), giúp các service đang phụ thuộc như `TelemetryQueryService` hoạt động bình thường mà không cần chỉnh sửa.
  - Ngăn chặn SQL Injection thông qua truyền các tham số parameterized query vào `this.dataSource.query(text, params)`.
  - Gỡ bỏ hoàn toàn thư viện `pg` thô khỏi phần imports của file.
  - Sử dụng NestJS built-in `Logger` thay cho `console.log` và gọi một câu lệnh query kiểm tra kết nối đơn giản `SELECT NOW()` trong `onModuleInit()` để xác thực kết nối database tại thời điểm startup.
  - Xử lý kiểu bắt lỗi `unknown` trong try-catch và kiểm tra kiểu mảng an toàn để sửa lỗi eslint (`no-unsafe-member-access`, `no-unsafe-assignment`).
- **Kết quả tự kiểm tra**:
  - Chạy `npm run build` thành công, biên dịch dự án hoàn hảo không lỗi.
  - Chạy `npm run test` thành công, các bài kiểm thử đơn vị đều vượt qua.
  - Chạy `npm run lint` thành công trên file `database.service.ts`, khắc phục hoàn toàn mọi lỗi eslint liên quan.

## [2026-07-09T21:32:00+07:00] - Task B2: Refactor DatabaseModule để tích hợp TypeOrmModule
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [database.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.module.ts)
- **Giải trình giải pháp**:
  - Tích hợp `TypeOrmModule` vào `DatabaseModule` thông qua `TypeOrmModule.forRootAsync`.
  - Cấu hình load bất đồng bộ (`useFactory`) sử dụng cấu hình database `typeOrmConfig` được import trực tiếp từ file `typeorm.config.ts`.
  - Export `TypeOrmModule` từ `DatabaseModule` để các module chức năng khác có thể dễ dàng sử dụng lại TypeORM Repositories mà không cần khai báo lại cấu hình.
- **Kết quả tự kiểm tra**:
  - Chạy `pnpm build` thành công, biên dịch NestJS không phát sinh lỗi.
  - Chạy `pnpm test` thành công, tất cả các bài test vượt qua tốt đẹp.

## [2026-07-09T21:28:45+07:00] - Task B1: Khởi tạo file cấu hình typeorm.config.ts
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Tạo mới: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
- **Giải trình giải pháp**:
  - Tạo file cấu hình TypeORM `DataSource` kết nối đến cơ sở dữ liệu TimescaleDB.
  - Hỗ trợ cả chạy runtime trong Docker (đọc qua `process.env.DATABASE_URL`) và chạy CLI trên máy host (tự động phát hiện và đọc tệp `.env` ở thư mục backend hoặc thư mục gốc, phân tích cú pháp để dựng chuỗi kết nối).
  - Tắt tự động đồng bộ hóa schema (`synchronize: false`) để tránh ảnh hưởng đến các TimescaleDB hypertable chunks, bảo vệ an toàn cho cơ sở dữ liệu.
  - Định cấu hình kết nối tối ưu tránh starvation: `max = 20`, `idleTimeoutMillis = 30000`, `connectionTimeoutMillis = 2000`.
  - Cấu hình đường dẫn cho các entity (`src/**/*.entity{.ts,.js}`) và các file migrations (`src/database/migrations/*{.ts,.js}`).
- **Kết quả tự kiểm tra**:
  - Chạy `pnpm run build` thành công, không gặp lỗi biên dịch.
  - Chạy `pnpm run test` thành công, toàn bộ 100% test case hiện tại vượt qua.

## [2026-07-09T21:28:00+07:00] - Task A1: Cập nhật dependency và scripts trong package.json
- **Trạng thái**: Đang chờ QA Review
- **Danh sách file thay đổi**:
  - Sửa đổi: [package.json](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/package.json)
- **Giải trình giải pháp**:
  - Ghim cứng phiên bản (pinned versions) các thư viện mới thêm để bảo đảm tính ổn định và nhất quán của build:
    - `@nestjs/typeorm`: `11.0.3` (tương thích NestJS v11 đang sử dụng)
    - `typeorm`: `1.0.0`
    - `date-fns-tz`: `3.2.0`
  - Thêm các script chạy TypeORM CLI qua `typeorm-ts-node-commonjs` để thực thi migrations:
    - `migration:run` để chạy các migration chưa áp dụng
    - `migration:revert` để hoàn tác migration cuối cùng
- **Kết quả tự kiểm tra**:
  - Chạy thành công lệnh `pnpm install` cập nhật dependencies.
  - Chạy `pnpm run build` thành công, không gặp lỗi biên dịch.
  - Chạy thử `npx typeorm-ts-node-commonjs -h` xác nhận TypeORM CLI hoạt động chính xác.
