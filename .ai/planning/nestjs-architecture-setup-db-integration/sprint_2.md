# Sprint 2: Thiết lập BatchModule & Nghiệp Vụ Vụ Nuôi (Crop Batches)

Sprint này tập trung thiết lập các thực thể (Entities) liên quan đến quản lý vận hành nông nghiệp thực tế bao gồm nhà nấm, profile nuôi trồng, vụ nuôi hiện tại, các điểm mốc đồ thị sinh trưởng và lịch điều phối ánh sáng. Triển khai dịch vụ `BatchService` để xác định ngữ cảnh vụ nuôi và nội suy biên độ điều khiển tối ưu.

---

## 1. PHẠM VI & MỤC TIÊU

- **Module tác động trực tiếp**:
  - `src/batch/batch.module.ts` (Tạo mới)
  - Thực thể dữ liệu: `src/batch/entities/mushroom-house.entity.ts`, `src/batch/entities/growth-profile.entity.ts`, `src/batch/entities/crop-batch.entity.ts`, `src/batch/entities/curve-checkpoint.entity.ts`, `src/batch/entities/light-schedule-block.entity.ts` (Tạo mới tất cả)
  - Tầng nghiệp vụ: `src/batch/services/batch.service.ts` (Tạo mới)
  - Tầng API điều khiển: `src/batch/controllers/batch.controller.ts` (Tạo mới)
- **Mục tiêu**:
  - Khởi tạo đầy đủ cấu trúc TypeORM Entity ánh xạ chính xác với Schema quan hệ hiện hữu của TimescaleDB (ngoại trừ bảng telemetry dạng hypertable).
  - Triển khai thuật toán nội suy tuyến tính (Linear Interpolation) để tính toán điểm tối ưu động (setpoints) của Nhiệt độ và Độ ẩm dựa trên ngày tuổi thực tế của vụ nuôi.
  - Phơi bày các API CRUD cơ bản để vận hành vụ nuôi từ Dashboard.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[Yêu cầu ngữ cảnh vụ nuôi (houseId, timestamp)]
                   │
                   ▼
     [batch.service.ts: getBatchContext]
                   │
                   ├─► Tìm CropBatch đang ACTIVE gắn với houseId
                   ├─► Tính số ngày nuôi thực tế: cropDay = timestamp - start_date
                   ├─► Lấy danh sách checkpoints nhiệt độ/độ ẩm của Batch đó
                   │         │
                   │         ▼ (Thực hiện thuật toán nội suy tuyến tính)
                   ├─► Nội suy: TargetTemp = Interpolate(cropDay, TEMP checkpoints)
                   ├─► Nội suy: TargetHumid = Interpolate(cropDay, HUMID checkpoints)
                   │
                   ▼ (Trả về đối tượng BatchContext)
{ batchId, cropDay, targetTemp, targetHumid, optimalRanges, thermalShockProtection }
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Tầng Thực Thể Cơ Sở Dữ Liệu (Entities Track)

#### Task 2.1: Tạo thực thể MushroomHouse
- **Tên tệp tạo mới**: [mushroom-house.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/mushroom-house.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `MushroomHouse` ánh xạ bảng `mushroom_houses`.
  - Mapped các thuộc tính: `@PrimaryColumn() id: string`, `@Column() name: string`, `@Column() area_meters: string`, `@Column() pillar_count: number`, `@CreateDateColumn() created_at: Date`.

#### Task 2.2: Tạo thực thể GrowthProfile
- **Tên tệp tạo mới**: [growth-profile.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/growth-profile.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `GrowthProfile` ánh xạ bảng `growth_profiles`.
  - Mapped các thuộc tính: `@PrimaryColumn() id: string`, `@Column() name: string`, `@Column() description: string`, `@CreateDateColumn() created_at: Date`, `@UpdateDateColumn() updated_at: Date`.

#### Task 2.3: Tạo thực thể CropBatch
- **Tên tệp tạo mới**: [crop-batch.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/crop-batch.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `CropBatch` ánh xạ bảng `crop_batches`.
  - Mapped các thuộc tính: `@PrimaryColumn() id: string`, `@Column() status: string` (mặc định `'ACTIVE'`), `@Column() start_date: Date`, `@Column() total_crop_days: number`, `@Column() spawn_running_end_day: number`, `@Column('numeric') temp_optimal_min: number`, `@Column('numeric') temp_optimal_max: number`, `@Column('numeric') humidity_optimal_min: number`, `@Column('numeric') humidity_optimal_max: number`, `@Column() thermal_shock_protection: boolean`, `@Column('time') thermal_shock_start: string`, `@Column('time') thermal_shock_end: string`, `@UpdateDateColumn() updated_at: Date`.
  - Mapped quan hệ: `@ManyToOne(() => MushroomHouse) @JoinColumn({ name: 'house_id' }) house: MushroomHouse`.

#### Task 2.4: Tạo thực thể CurveCheckpoint
- **Tên tệp tạo mới**: [curve-checkpoint.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/curve-checkpoint.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `CurveCheckpoint` ánh xạ bảng `curve_checkpoints`.
  - Mapped các thuộc tính: `@PrimaryGeneratedColumn()` id: number, `@Column() metric_type: 'TEMPERATURE' | 'HUMIDITY'`, `@Column() crop_day: number`, `@Column('numeric') target_value: number`.
  - Mapped quan hệ:
    - ManyToOne với `GrowthProfile` qua cột `profile_id`.
    - ManyToOne với `CropBatch` qua cột `batch_id`.

#### Task 2.5: Tạo thực thể LightScheduleBlock
- **Tên tệp tạo mới**: [light-schedule-block.entity.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/entities/light-schedule-block.entity.ts)
- **Hành động cụ thể**:
  - Khởi tạo class `LightScheduleBlock` ánh xạ bảng `light_schedule_blocks`.
  - Mapped các thuộc tính: `@PrimaryGeneratedColumn() id: number`, `@Column() start_day: number`, `@Column() end_day: number`, `@Column() status: 'ON' | 'OFF'`.
  - Mapped quan hệ: ManyToOne với `GrowthProfile` (`profile_id`) và `CropBatch` (`batch_id`).

---

### TRACK 2: Tầng Nghiệp Vụ (Business Logic Track)

#### Task 2.6: Triển khai các phương thức cốt lõi trong BatchService
- **Tên tệp tạo mới**: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)
- **Hành động cụ thể**:
  - Viết hàm `getActiveBatchByHouseId(houseId: string): Promise<CropBatch | null>`: Truy vấn cơ sở dữ liệu để tìm vụ nuôi có `house_id = houseId` và `status = 'ACTIVE'`.
  - Viết hàm `getBatchContext(houseId: string, timestamp: Date): Promise<BatchContext>`:
    1. Lấy Active Batch bằng `getActiveBatchByHouseId`. Nếu không tồn tại, trả về cấu hình an toàn sinh học mặc định (Nhiệt độ tối ưu: 28-35°C, Độ ẩm tối ưu: 70-90%, khóa bảo vệ sốc nhiệt kích hoạt).
    2. Tính toán ngày vụ nuôi: `cropDay = floor((timestamp - start_date) / (24 * 60 * 60 * 1000)) + 1`. Đảm bảo `cropDay` tối thiểu là 1 và tối đa là `total_crop_days`.
    3. Truy vấn tất cả `CurveCheckpoint` gắn với `batch_id` này.
    4. Triển khai thuật toán nội suy tuyến tính:
       - Gom nhóm các checkpoint theo loại metric (`TEMPERATURE`, `HUMIDITY`).
       - Sắp xếp checkpoint tăng dần theo `crop_day`.
       - Xác định hai điểm mốc bao quanh ngày `cropDay` (ví dụ: ngày `cropDay = 5` nằm giữa checkpoint ngày `4` và ngày `8`).
       - Nếu trùng khớp đúng ngày mốc: Trả về `target_value` của ngày đó.
       - Nếu không trùng: Tính toán tỷ lệ:
         $$\text{target\_value} = V_1 + \frac{(cropDay - D_1)}{(D_2 - D_1)} \times (V_2 - V_1)$$
         (Trong đó $D_1, D_2$ là các ngày mốc liền kề trước/sau, $V_1, V_2$ là giá trị tại các mốc đó).
       - Làm tròn kết quả về biên độ gần nhất 0.5.
    5. Kiểm tra trạng thái đèn chiếu sáng từ `light_schedule_blocks` dựa trên `cropDay`.
    6. Trả về cấu trúc `BatchContext` chứa đầy đủ thông tin: ID vụ nuôi, ngày tuổi hiện tại, nhiệt độ setpoint, độ ẩm setpoint, dải nhiệt độ tối ưu, dải độ ẩm tối ưu và khung giờ cấm phun sương.

---

### TRACK 3: Tầng Giao Tiếp API (API Controller Track)

#### Task 2.7: Xây dựng BatchController và BatchModule
- **Tên tệp tạo mới**: [batch.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts) & [batch.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/batch.module.ts)
- **Hành động cụ thể**:
  - `BatchController` phơi bày các API:
    - `POST /batches` để tạo vụ nuôi (`CreateBatchDto` chứa thông tin nhà nấm, profile_name, dải tối ưu động).
    - `PATCH /batches/:id/end` để cập nhật trạng thái kết thúc vụ nuôi (`COMPLETED` hoặc `ABORTED`).
    - `GET /batches/active/:houseId` lấy vụ nuôi đang chạy.
  - `BatchModule` đăng ký các TypeORM entity tương ứng thông qua `TypeOrmModule.forFeature([CropBatch, MushroomHouse, CurveCheckpoint, LightScheduleBlock, GrowthProfile])`. Cấu hình providers và exports `BatchService`.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Ràng buộc duy nhất vụ nuôi**: Nghiêm cấm tồn tại đồng thời 2 vụ nuôi có trạng thái `ACTIVE` trong cùng 1 nhà nấm (`house_id`). Logic API tạo vụ nuôi phải kiểm tra điều này trước khi insert.
2. **Biên kiểm thử thuật toán nội suy**: Thuật toán nội suy tuyến tính phải vượt qua các biên:
   - Ngày tuổi nằm ngoài rìa mốc (nhỏ hơn ngày mốc nhỏ nhất, lớn hơn ngày mốc lớn nhất) -> Phải lấy giá trị của mốc biên gần nhất.
   - Khi danh sách checkpoints rỗng -> Fallback về cấu hình mặc định trong `CropBatch` hoặc hằng số hệ thống.
3. **Chỉ mục CSDL (Database Index)**: Truy vấn tìm kiếm checkpoint theo vụ nuôi phải quét trúng index `idx_checkpoints_batch` để tránh full table scan khi lượng dữ liệu lớn.
