# WALKTHROUGH_LOG.md

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
