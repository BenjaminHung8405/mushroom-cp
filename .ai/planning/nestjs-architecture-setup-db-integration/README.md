# NestJS Architecture Setup & DB Integration (Refactored for Production)

Dự án này thiết lập và hoàn thiện kiến trúc cho backend NestJS (`mushroom-backend`), tập trung vào việc tái cấu trúc kết nối cơ sở dữ liệu TimescaleDB (TypeORM), triển khai cơ chế an toàn sinh học (Bio-safety Closed-Loop Fail-Safe), lưu trữ đệm tối ưu hiệu năng mô phỏng (Hypertable Chunk Preservation), đồng bộ hóa múi giờ Việt Nam (Asia/Ho_Chi_Minh UTC+7), và quy hoạch hệ thống di cư cơ sở dữ liệu bằng migrations.

---

## 🎯 1. Mục Tiêu Kỹ Thuật Tổng Quát

1. **Hợp nhất hồ chứa kết nối (Consolidated Connection Pool)**:
   - Loại bỏ hoàn toàn thư viện `pg` thô khỏi ứng dụng.
   - Định cấu hình và quản lý kết nối tập trung qua một hồ chứa (pool) duy nhất của TypeORM `DataSource`.
   - Cung cấp phương thức `query()` dùng chung trên `DataSource` để chạy các câu lệnh SQL đặc thù của TimescaleDB (như `time_bucket`).

2. **Cơ chế An toàn Sinh học Vòng lặp Khép kín (Bio-safety Closed-Loop Fail-Safe)**:
   - Tránh hiện tượng phần cứng giữ nguyên trạng thái cũ (ví dụ: máy phun sương mở 100%, quạt đối lưu tắt) khi kết nối cơ sở dữ liệu bị sập hoặc gặp sự cố.
   - Thiết lập quy trình xử lý `try/catch/finally` trong việc ingestion telemetry. Nếu ghi cơ sở dữ liệu thất bại, hệ thống tự động fallback sang cấu hình khẩn cấp an toàn (`mist_generator_pwm = 0`, `convection_fan_pwm = 10`, `heating_lamp_active = false`).
   - Khối `finally` bắt buộc phải gửi MQTT lệnh setpoint phản hồi cho thiết bị.

3. **Bảo tồn phân mảnh bảng (Hypertable Chunk Preservation trong Simulation)**:
   - Khi chạy giả lập tua nhanh thời gian (> 1x), lượng dữ liệu telemetry đổ về liên tục làm kích hoạt TimescaleDB sinh chunk mới dồn dập, dẫn tới khóa bảng và nghẽn pool.
   - Thiết kế cơ chế đệm dữ liệu (buffer queue). Chỉ khi đạt ngưỡng số lượng bản ghi (ví dụ: 100 bản ghi) hoặc đạt khoảng thời gian cấu hình, hệ thống sẽ thực hiện một truy vấn **BULK INSERT** duy nhất.

4. **Đồng bộ hóa Múi giờ UTC+7 (Asia/Ho_Chi_Minh Timezone Safety)**:
   - Đảm bảo các quy tắc sinh học vận hành đúng khung giờ (như giờ cấm phun sương buổi trưa 11:00 - 13:30) độc lập với múi giờ của máy chủ host (UTC+0 trên Docker).
   - Sử dụng thư viện `date-fns-tz` để chuẩn hóa mốc thời gian telemetry về múi giờ `Asia/Ho_Chi_Minh` trước khi đối chiếu khoảng thời gian.

5. **Quản lý Migrations có kiểm soát (Version-Controlled DB Migrations)**:
   - Vô hiệu hóa cơ chế tự động đồng bộ hóa schema (`synchronize: false`).
   - Sử dụng TypeORM CLI để tạo và chạy các tệp Migration bằng SQL thô độc lập.

---

## 🛠️ 2. Tech Stack Cốt Lõi

- **Language**: TypeScript (v5+)
- **Framework**: NestJS (v10+)
- **Database**: TimescaleDB / PostgreSQL
- **Libraries**:
  - `typeorm` & `@nestjs/typeorm` (Quản trị ORM và Pool kết nối)
  - `pg` (Được bọc và quản lý tự động bởi TypeORM)
  - `date-fns` & `date-fns-tz` (Xử lý múi giờ UTC+7)
  - `mqtt` (Giao tiếp MQTT broker EMQX)
  - `rxjs` (Quản lý các luồng sự kiện trạng thái thiết bị)

---

## 📐 3. Quy Tắc Viết Code Toàn Cục (Coding Conventions)

### 3.1. Kiến Trúc & SOLID
- **Clean Architecture & Layered Architecture**: Phân tách rõ ràng giữa tầng dữ liệu (Entities, Migrations), tầng nghiệp vụ (Services), và tầng giao tiếp (Controllers, Gateways/MQTT Service).
- **Single Responsibility (SRP)**: Mỗi module, class, phương thức chỉ đảm nhận một trách nhiệm duy nhất. Ví dụ, `TelemetryService` xử lý nghiệp vụ telemetry và lưu trữ; `MqttService` chỉ xử lý giao thức kết nối và gửi/nhận MQTT thô.
- **Dependency Injection (DI)**: Luôn inject các service qua constructor, sử dụng decorator `@Injectable()`. Không khởi tạo thủ công (new) các service phụ thuộc.

### 3.2. Quy Tắc Đặt Tên (Naming Conventions)
- **Tập tin**: Đặt tên viết thường, cách nhau bằng dấu gạch ngang (kebab-case).
  - Ví dụ: `growth-profile.entity.ts`, `batch.service.ts`.
- **Lớp (Class)**: PascalCase.
  - Ví dụ: `TelemetryService`, `MushroomHouseEntity`.
- **Hàm & Biến**: camelCase.
  - Ví dụ: `processTelemetry()`, `isSimulationActive`, `emergencyPayload`.
- **Thư mục**: kebab-case.
  - Ví dụ: `src/batch/entities/`.
- **Bảng CSDL & Cột**: snake_case.
  - Ví dụ: `mushroom_houses`, `mist_generator_pwm`.

### 3.3. Quy Tắc Xử Lý Lỗi (Error Handling)
- **Nghiêm cấm "silent catch"**: Tuyệt đối không để trống catch-block hoặc catch mà chỉ in console thô sơ không có log có cấu trúc.
- **Sử dụng NestJS Logger**: Inject `Logger` của NestJS với context cụ thể của class để ghi nhận logs (Log levels: log, warn, error, debug).
- **Bio-safety Try-Catch-Finally**: Mọi luồng xử lý điều khiển thời gian thực nhận telemetry phải chạy qua try-catch để bắt ngoại lệ CSDL/Tính toán, thực hiện gán trị fallback khẩn cấp, và luôn dispatch setpoint tại block `finally`.

### 3.4. Ràng Buộc Múi Giờ (Timezone Constraint)
- Mọi thao tác so sánh giờ phải đưa về múi giờ `Asia/Ho_Chi_Minh`.
- Tránh sử dụng trực tiếp các hàm lấy giờ cục bộ của Node.js như `new Date().getHours()` vì nó phụ thuộc vào máy chủ.
- Chuyển đổi timestamp của telemetry sang UTC+7 bằng `utcToZonedTime` của `date-fns-tz` hoặc tính toán phút trôi qua kể từ nửa đêm (`minutes since midnight`) theo hệ múi giờ UTC+7.
