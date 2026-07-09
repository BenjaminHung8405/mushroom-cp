# WALKTHROUGH_LOG.md

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
