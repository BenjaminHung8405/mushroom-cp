# Sprint 4: Triển Khai SimulationModule & Dọn Dẹp Tổng Thể

Sprint này tập trung xây dựng Sandbox giả lập môi trường cho nhà nấm dành cho các nhà phát triển. Triển khai cơ chế đệm dữ liệu (Buffering) khi tốc độ giả lập vượt quá 1x (Fast-Forward), cho phép tích lũy và thực hiện ghi hàng loạt (BULK INSERT) để bảo vệ hiệu năng phân mảnh bảng (hypertable chunks) của TimescaleDB. Cuối cùng, thực hiện dọn dẹp các service cũ bị thay thế và liên kết toàn bộ hệ thống vào AppModule.

---

## 1. PHẠM VI & MỤC TIÊU

- **Module tác động trực tiếp**:
  - `src/simulation/simulation.module.ts` (Tạo mới)
  - `src/simulation/services/simulation.service.ts` (Tạo mới)
  - `src/simulation/controllers/simulation.controller.ts` (Tạo mới)
  - `src/database/telemetry-query.service.ts` (Xóa bỏ hoàn toàn)
  - `src/app.module.ts` (Sửa đổi để đấu nối các Module mới)
- **Mục tiêu**:
  - Xây dựng một trình giả lập môi trường sinh học biến thiên (nhiệt độ, độ ẩm dao động quanh mức nền và chịu tác động gián tiếp từ trạng thái phun sương, quạt đối lưu, đèn sưởi).
  - Triển khai thuật toán buffering: Khi mô phỏng tua nhanh (> 1x), lưu trữ tạm thời các bản ghi telemetry cảm biến vào hàng đợi RAM và định kỳ chạy lệnh SQL BULK INSERT (sau mỗi 100 bản ghi hoặc mỗi 5 giây) để giảm áp lực tạo chunk của TimescaleDB.
  - Xóa bỏ dịch vụ truy vấn telemetry cũ `TelemetryQueryService` và liên kết tất cả Module mới vào lõi ứng dụng.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[Vòng lặp Giả lập Sandbox (Interval)]
                │
                ▼
      [simulation.service.ts]
                │
    Nếu speedMultiplier > 1x?
    ├── [Đúng] ──► Lưu tạm vào `bufferQueue` (Mảng tạm)
    │                │
    │                ▼ (Nếu size >= 100 hoặc trôi qua 5 giây)
    │             [Thực hiện BULK INSERT qua TypeORM] ──► [Bảng telemetry_logs]
    │
    └── [Sai] ───► Gọi `TelemetryService.processTelemetry` để ghi đơn lẻ và phản hồi MQTT
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Tầng Giả Lập & Đệm Dữ Liệu (Simulation Track)

#### Task 4.1: Triển khai SimulationService và cơ chế ghi Bulk Insert
- **Tên tệp tạo mới**: [simulation.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/services/simulation.service.ts)
- **Hành động cụ thể**:
  - Khai báo class `SimulationService` triển khai `OnModuleDestroy`.
  - Định nghĩa biến trạng thái: `isActive: boolean`, `speedMultiplier: number`, `bufferQueue: any[]`, `timerId: NodeJS.Timeout | null`, `flushTimerId: NodeJS.Timeout | null`.
  - Viết phương thức `startSimulation(speed: number): void`:
    - Dừng các timer cũ nếu đang chạy.
    - Đặt trạng thái `isActive = true` và `speedMultiplier = speed`.
    - Thiết lập vòng lặp giả lập `simulateStep()` chạy theo chu kỳ thời gian (ví dụ: chu kỳ mặc định 5 phút ảo được thu hẹp lại tương ứng với hệ số `speedMultiplier`).
    - Nếu `speedMultiplier > 1`, thiết lập thêm một timer quét hàng đợi sau mỗi 5 giây (`flushTimerId`) để định kỳ ghi đệm xuống CSDL.
  - Viết phương thức `stopSimulation(): void`:
    - Hủy các timer (`timerId`, `flushTimerId`).
    - Gọi phương thức `flushBuffer()` để đẩy hết dữ liệu còn lại trong hàng đợi vào CSDL.
    - Đặt `isActive = false`.
  - Viết phương thức `simulateStep(): Promise<void>`:
    - Mô phỏng thay đổi môi trường:
      - Tăng độ ẩm nếu máy siêu âm bật (`mist_generator_pwm > 0`), ngược lại giảm độ ẩm tự nhiên.
      - Tăng nhiệt độ nếu đèn sưởi bật (`heating_lamp_active = true`), giảm nhiệt độ nếu bật quạt đối lưu.
    - Tạo đối tượng telemetry ghi nhận dữ liệu cảm biến giả lập.
    - Nếu `speedMultiplier > 1`:
      - Đẩy đối tượng này vào hàng đợi: `this.bufferQueue.push(log)`.
      - Nếu `this.bufferQueue.length >= 100`: Gọi `this.flushBuffer()`.
    - Nếu `speedMultiplier === 1`:
      - Gọi trực tiếp `TelemetryService.processTelemetry(houseId, sensors, timestamp)` để xử lý theo chu trình thời gian thực.
  - Viết phương thức `flushBuffer(): Promise<void>`:
    - Tránh race condition: Sao chép hàng đợi sang biến tạm và giải phóng mảng gốc ngay lập tức:
      ```typescript
      if (this.bufferQueue.length === 0) return;
      const dataToInsert = [...this.bufferQueue];
      this.bufferQueue = [];
      ```
    - Thực thi BULK INSERT: Sử dụng TypeORM QueryBuilder hoặc câu lệnh SQL thô định dạng nhiều cụm `VALUES` để chèn toàn bộ dữ liệu của `dataToInsert` vào bảng `telemetry_logs` trong một truy vấn duy nhất.
  - Viết phương thức `onModuleDestroy()`:
    - Đảm bảo thực thi `await this.flushBuffer()` để bảo toàn dữ liệu giả lập chưa lưu khi backend đột ngột tắt.

#### Task 4.2: Triển khai SimulationController để quản lý sandbox từ API
- **Tên tệp tạo mới**: [simulation.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/controllers/simulation.controller.ts)
- **Hành động cụ thể**:
  - Khai báo class `SimulationController` với các API REST:
    - `POST /simulation/start`: Khởi chạy giả lập, nhận body `{ speedMultiplier: number }`.
    - `POST /simulation/stop`: Dừng giả lập.
    - `GET /simulation/state`: Trả về trạng thái giả lập hiện tại.

#### Task 4.3: Thiết lập SimulationModule
- **Tên tệp tạo mới**: [simulation.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/simulation/simulation.module.ts)
- **Hành động cụ thể**:
  - Khai báo `@Module()` cấu hình cung cấp `SimulationService` và phơi bày `SimulationController`.
  - Import `DatabaseModule` và `TelemetryModule`.

---

### TRACK 2: Dọn Dẹp & Đồng Bộ Hệ Thống (Cleanups Track)

#### Task 4.4: Xóa bỏ TelemetryQueryService cũ
- **Tên file xóa bỏ**: [telemetry-query.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/telemetry-query.service.ts)
- **Hành động cụ thể**:
  - Xóa bỏ tệp tin này khỏi thư mục `src/database/`.
  - Gỡ bỏ import và khai báo của `TelemetryQueryService` ra khỏi `database.module.ts`.

#### Task 4.5: Khai báo các Module mới trong AppModule
- **Tên file sửa đổi**: [app.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/app.module.ts)
- **Hành động cụ thể**:
  - Gỡ bỏ các module không còn tương thích (nếu có).
  - Thêm vào mảng `imports` của `@Module()` các module mới xây dựng bao gồm:
    - `DatabaseModule` (Đã refactor)
    - `BatchModule`
    - `TelemetryModule`
    - `SimulationModule`

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Chống rò rỉ bộ nhớ (Memory Leak Prevention)**: Khi dừng giả lập hoặc hủy module, tất cả các timer liên quan đến mô phỏng phải được hủy bỏ thông qua `clearInterval` / `clearTimeout`.
2. **Không mất mát dữ liệu đệm**: Phải kiểm thử kịch bản tắt ứng dụng (trigger `onModuleDestroy`). Hàng đợi buffer phải được ghi xuống DB thành công trước khi tiến trình Node.js hoàn tất tắt.
3. **Hiệu năng Bulk Insert**: Câu lệnh SQL Bulk Insert phải được thiết kế tối ưu, gộp toàn bộ bản ghi trong hàng đợi vào một truy vấn SQL duy nhất thay vì lặp qua từng phần tử để gọi insert lẻ tẻ.
4. **Cô lập Sandbox**: Đảm bảo dữ liệu do Sandbox sinh ra không làm ảnh hưởng đến luồng vận hành thực tế của các nhà nấm vật lý đang chạy (chỉ áp dụng trên dữ liệu cấu hình vụ nuôi Sandbox riêng biệt).
