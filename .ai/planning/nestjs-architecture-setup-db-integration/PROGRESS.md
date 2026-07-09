# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-09T21:25:38+07:00
- **Agent thực thi**: Gemini

## Reference Plan
- **Thư mục kế hoạch**: [nestjs-architecture-setup-db-integration](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/)
- **Sprints tham chiếu**: 
  1. [sprint_1.md (Database & Connection Pool)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_1.md)
  2. [sprint_2.md (Batch Management & Interpolation)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_2.md)
  3. [sprint_3.md (Telemetry & Closed-loop Bio-safety)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_3.md)
  4. [sprint_4.md (Simulation, Buffering & Cleanup)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_4.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có

## Tracks Progress

---

### SPRINT 1: DATABASE MODULE & CONNECTION POOL HỢP NHẤT

#### Track A: Cấu hình Dự án & CLI (Project Setup Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| A1 | Cập nhật dependency và scripts trong package.json | [ ] QA Review | - **Quy tắc phiên bản**: Ghim cứng phiên bản các thư viện mới thêm (`@nestjs/typeorm`, `typeorm`, `date-fns-tz`) để đảm bảo tính nhất quán của build, tránh sử dụng kí tự đại diện rộng như `*` hoặc `^` quá cao nếu không tương thích với NestJS v10.<br>- **Quản lý script**: Đảm bảo các script chạy TypeORM CLI qua `typeorm-ts-node-commonjs` được viết đúng cú pháp và trỏ chính xác đến file cấu hình `typeorm.config.ts`. Chạy thử lệnh để tránh tech debt lỗi đường dẫn. |

#### Track B: Tầng Truy Cập Dữ Liệu (Data Access Layer Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| B1 | Khởi tạo file cấu hình typeorm.config.ts | [ ] In Progress | - **Quy tắc bảo mật**: Không hardcode bất kỳ chuỗi nhạy cảm nào (credentials/password). Bắt buộc đọc từ biến môi trường `DATABASE_URL` hoặc cấu hình `process.env`. Cần ném lỗi cụ thể khi thiếu biến môi trường cấu hình tại thời điểm startup.<br>- **Quy tắc thiết kế CSDL (No Auto-Sync)**: Bắt buộc cấu hình `synchronize: false` để bảo vệ schema của database TimescaleDB, chống ghi đè schema tự động gây hỏng hypertable chunks. Mọi cấu trúc DB phải được kiểm soát qua Migrations.<br>- **Tối ưu hóa kết nối**: Định cấu hình extra pool limits rõ ràng (`extra.max = 20`, `extra.idleTimeoutMillis = 30000`, `extra.connectionTimeoutMillis = 2000`) để ngăn chặn cạn kiệt tài nguyên (connection starvation) khi tải cao. |
| B2 | Refactor DatabaseModule để tích hợp TypeOrmModule | [ ] QA Review | - **Design Pattern**: Áp dụng Dependency Injection và Module encapsulation. Đăng ký thông qua `TypeOrmModule.forRootAsync` để đảm bảo config được load đúng chu kỳ NestJS.<br>- **Chống nợ kỹ thuật**: Export `TypeOrmModule` từ `DatabaseModule` để các module chức năng khác có thể tái sử dụng dễ dàng khi inject repository mà không phải import lại cấu hình cơ sở dữ liệu. |
| B3 | Refactor DatabaseService để loại bỏ pg Pool | [ ] QA Review | - **Design Pattern**: Sử dụng Adapter Pattern bằng cách bọc lại phương thức `query()` của TypeORM `DataSource` để giữ nguyên chữ ký hàm (interface) cũ, tránh làm hỏng các service đang gọi `DatabaseService`. Không expose đối tượng kết nối thô nếu không cần thiết.<br>- **Ngăn chặn SQL Injection**: Bắt buộc các câu lệnh thực thi qua `query(text, params)` phải truyền params dưới dạng tham số hóa (parameterized queries). Nghiêm cấm cộng chuỗi SQL thô.<br>- **Chống nợ kỹ thuật & Lifecycle**: Gỡ bỏ hoàn toàn thư viện `pg` thô khỏi imports. Trong `onModuleInit()`, phải thực hiện một câu lệnh query kiểm tra kết nối đơn giản (`SELECT NOW()`) và sử dụng NestJS built-in `Logger` có cấu trúc để ghi nhận trạng thái (success/warn/error), thay vì dùng `console.log`. |

---

### SPRINT 2: BATCH MODULE & NGHIỆP VỤ VỤ NUÔI (CROP BATCHES)

#### Track C: Tầng Thực Thể Cơ Sở Dữ Liệu Vụ Nuôi (Crop Batch Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| C1 | Tạo thực thể MushroomHouse | [ ] Pending | - **Mapping Schema**: Lớp `MushroomHouse` phải ánh xạ chính xác bảng `mushroom_houses`. Đảm bảo `@PrimaryColumn() id: string` là dạng UUID hoặc string tùy theo schema DB hiện tại. Bắt buộc kiểm tra snake_case trên decorator `@Column({ name: '...' })` để khớp tuyệt đối với schema PostgreSQL hiện hữu. |
| C2 | Tạo thực thể GrowthProfile | [ ] Pending | - **Lifecycle timestamps**: Đảm bảo các trường ngày tháng sử dụng `@CreateDateColumn()` và `@UpdateDateColumn()`. Sử dụng timezone đồng bộ ở mức hệ thống NestJS để tránh sai lệch thời gian khởi tạo profile. |
| C3 | Tạo thực thể CropBatch | [ ] Pending | - **Xử lý số thực**: Định nghĩa kiểu dữ liệu `numeric` trong TypeORM: Sử dụng `@Column('numeric', { transformer: { to: (v) => v, from: (v) => parseFloat(v) } })` để tránh TypeORM trả về kiểu string cho kiểu numeric/decimal của PostgreSQL, gây lỗi tính toán học.<br>- **Mapping Quan hệ**: Thiết lập mối quan hệ `@ManyToOne` với `MushroomHouse` dùng `@JoinColumn({ name: 'house_id' })` để đảm bảo Foreign Key hoạt động tối ưu. |
| C4 | Tạo thực thể CurveCheckpoint | [ ] Pending | - **Tối ưu hóa Database Index**: Đảm bảo thiết lập index cho các khóa ngoại để tối ưu hiệu năng truy vấn. Sử dụng `@Index('idx_checkpoints_batch', ['batch'])` trên entity để đảm bảo cơ sở dữ liệu quét index khi lọc checkpoints theo vụ nuôi, tránh full table scan khi lượng checkpoints lớn. |
| C5 | Tạo thực thể LightScheduleBlock | [ ] Pending | - **Ràng buộc nghiệp vụ**: Cột thời gian của `light_schedule_blocks` phải map chính xác kiểu dữ liệu. Sử dụng Enum hoặc Union Types cho các trạng thái của block (ví dụ: `status: 'ON' | 'OFF'`). |

#### Track D: Tầng Nghiệp Vụ Vụ Nuôi (Crop Batch Business Logic Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| D1 | Triển khai các phương thức cốt lõi trong BatchService | [ ] Pending | - **Thuật toán nội suy**: Thực hiện tuyến tính hóa chuẩn xác. Phải xử lý các trường hợp biên: 1) Nếu ngày tuổi nhỏ hơn điểm mốc nhỏ nhất: Trả về giá trị mốc nhỏ nhất. 2) Nếu ngày tuổi lớn hơn điểm mốc lớn nhất: Trả về giá trị mốc lớn nhất. 3) Nếu không có checkpoint nào: Fallback về giá trị mặc định của Batch (`temp_optimal_min`, `temp_optimal_max`...) hoặc hằng số hệ thống an toàn.<br>- **Độ lệch ngày tuổi**: Tính toán ngày tuổi `cropDay = floor((now - start_date) / (24 * 60 * 60 * 1000)) + 1` dựa trên múi giờ Việt Nam. Chuyển đổi cả hai mốc thời gian về cùng một múi giờ trước khi tính hiệu số.<br>- **Đảm bảo tính nhất quán (Single Source of Truth)**: Chỉ cho phép duy nhất một vụ nuôi ở trạng thái `ACTIVE` cho một nhà nấm (`house_id`) tại một thời điểm. |

#### Track E: Tầng Giao Tiếp API Vụ Nuôi (Crop Batch API Controller Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| E1 | Xây dựng BatchController và BatchModule | [ ] Pending | - **Validation**: Sử dụng ValidationPipe và DTO (`CreateBatchDto`, `UpdateBatchDto`) để kiểm tra dữ liệu đầu vào.<br>- **Concurrency & Race Condition**: API tạo vụ nuôi phải thực hiện transaction hoặc kiểm tra sự tồn tại của vụ nuôi `ACTIVE` hiện tại trước khi tạo mới để tránh xung đột dữ liệu. |

---

### SPRINT 3: TELEMETRY MODULE & CLOSED-LOOP FAIL-SAFE

#### Track F: Tầng Thực Thể Cơ Sở Dữ Liệu Telemetry (Telemetry DB Entities Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| F1 | Tạo thực thể TelemetryLog ánh xạ bảng hypertable | [ ] Pending | - **Không Auto-Sync Hypertable**: Thiết lập `@Entity('telemetry_logs', { synchronize: false })`. Tuyệt đối không để TypeORM cố gắng tạo hoặc chỉnh sửa bảng này vì nó là TimescaleDB hypertable và được quản lý bởi SQL migration thủ công.<br>- **Composite Key**: Khai báo khóa chính là sự kết hợp của `time` và `batch_id`/`house_id` (composite key) để tương thích với cơ chế phân mảnh của TimescaleDB. |

#### Track G: Tầng Nghiệp Vụ & Điều Khiển Telemetry (Telemetry Control & Timezone Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| G1 | Triển khai phương thức processTelemetry và xử lý Bio-safety | [ ] Pending | - **Bio-safety Closed-loop**: Bắt buộc cấu trúc `try/catch/finally` trong việc xử lý telemetry: 1) Block `try`: Lấy context vụ nuôi, tính toán PWM cho thiết bị, và lưu telemetry. 2) Block `catch`: Log lỗi chi tiết với stack trace bằng `Logger.error`. Thiết lập trạng thái thiết bị ngoại vi về chế độ fallback an toàn khẩn cấp (`mist_generator_pwm = 0`, `convection_fan_pwm = 10`, `heating_lamp_active = false`). 3) Block `finally`: Bắt buộc gọi `mqttService.dispatchSetpoint()` để gửi payload setpoint cho ESP32. Lệnh điều khiển phải được gửi đi bất chấp kết nối DB có thành công hay không. |
| G2 | Triển khai logic tính toán điều khiển và múi giờ Việt Nam | [ ] Pending | - **Xử lý Múi giờ**: Sử dụng `date-fns-tz` để chuyển timestamp nhận từ telemetry sang múi giờ `Asia/Ho_Chi_Minh`. Tính toán số phút kể từ nửa đêm (`minutesSinceMidnight = hours * 60 + minutes`) để kiểm tra chính xác khung giờ cấm tưới (ví dụ: 11:00 - 13:30 tương đương 660 - 810 phút). |
| G3 | Triển khai ghi log và truy vấn dữ liệu | [ ] Pending | - **Chống nợ hiệu năng**: Sử dụng SQL chèn dữ liệu thô (raw query) qua `DatabaseService.query()` hoặc QueryBuilder để tối ưu tốc độ chèn dữ liệu telemetry. Tránh overhead không cần thiết của ORM ở tầng ghi dữ liệu thời gian thực có tần suất lớn. |

#### Track H: Tầng Tích Hợp MQTT (MQTT Integration Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| H1 | Cập nhật MqttService để định tuyến telemetry và dispatch setpoints | [ ] Pending | - **Định tuyến MQTT**: Đăng ký topic `mushroom/device/+/telemetry` động bằng wildcard. Xử lý bất đồng bộ (async/await) đúng cách khi nhận được tin nhắn để tránh nghẽn luồng MQTT client.<br>- **Độ tin cậy giao thức**: Sử dụng QoS 1 cho cả telemetry và setpoints để đảm bảo độ tin cậy truyền tin trong môi trường mạng IoT không ổn định. |

---

### SPRINT 4: SIMULATION MODULE, DATA BUFFERING & CLEANUP

#### Track I: Tầng Giả Lập & Đệm Dữ Liệu (Simulation & Buffering Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| I1 | Triển khai SimulationService và cơ chế ghi Bulk Insert | [ ] Pending | - **Cơ chế Buffering**: Khi `speedMultiplier > 1`, không gọi `TelemetryService.processTelemetry` vì nó sẽ thực hiện ghi DB đơn lẻ liên tục gây nghẽn hypertable chunk creation. Bắt buộc đẩy vào `bufferQueue` nằm trên RAM.<br>- **Bulk Insert**: Khi kích thước hàng đợi `>= 100` hoặc sau mỗi 5 giây, thực hiện Bulk Insert bằng một câu lệnh SQL duy nhất (chèn nhiều dòng VALUES) hoặc QueryBuilder bulk insert.<br>- **Chống race condition**: Sao chép hàng đợi sang biến tạm và gán `this.bufferQueue = []` đồng bộ trước khi gọi câu lệnh async insert để tránh mất mát dữ liệu do telemetry mới đẩy vào trong lúc ghi DB.<br>- **Lifecycle Cleanup**: Triển khai `OnModuleDestroy` để tự động flush sạch hàng đợi RAM xuống DB trước khi ứng dụng tắt để bảo toàn dữ liệu. |
| I2 | Triển khai SimulationController để quản lý sandbox từ API | [ ] Pending | - **Quản lý Sandbox**: Cung cấp API khởi chạy và kiểm soát tốc độ mô phỏng (`speedMultiplier`). Validate tốc độ đầu vào bằng DTO. |
| I3 | Thiết lập SimulationModule | [ ] Pending | - **Rò rỉ bộ nhớ (Memory Leak)**: Khai báo module độc lập, đảm bảo dọn dẹp các timer (`clearInterval`, `clearTimeout`) khi dừng mô phỏng hoặc hủy module. |

#### Track J: Dọn Dẹp & Đồng Bộ Hệ Thống (Cleanup & System Integration Track)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| J1 | Xóa bỏ TelemetryQueryService cũ | [ ] Pending | - **Dọn dẹp mã nguồn (Cleanup)**: Xóa bỏ hoàn toàn tệp `telemetry-query.service.ts` để tránh mã nguồn rác (dead code). Gỡ bỏ các tham chiếu cũ trong `DatabaseModule`. |
| J2 | Khai báo các Module mới trong AppModule | [ ] Pending | - **System Integration**: Khai báo tất cả các Module mới (`DatabaseModule` đã refactor, `BatchModule`, `TelemetryModule`, `SimulationModule`) vào `AppModule`. Đảm bảo ứng dụng khởi động bình thường mà không gặp lỗi Dependency Injection (circular dependency). Sử dụng `forwardRef` nếu có tham chiếu vòng. |
