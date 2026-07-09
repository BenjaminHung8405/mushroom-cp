# Sprint 1: Thiết lập Database Module & Hợp nhất Connection Pool (TypeORM)

Sprint này tập trung vào cấu hình cơ sở hạ tầng cơ sở dữ liệu: cài đặt các thư viện cần thiết, thiết lập cấu hình TypeORM DataSource và cập nhật Database Service để chuyển từ pool `pg` thô sang pool hợp nhất của TypeORM.

---

## 1. PHẠM VI & MỤC TIÊU

- **Module tác động trực tiếp**:
  - Cấu hình dự án: `package.json`
  - Database Module: `src/database/typeorm.config.ts` (Tạo mới), `src/database/database.module.ts` (Sửa đổi), `src/database/database.service.ts` (Sửa đổi).
- **Mục tiêu**:
  - Cài đặt `@nestjs/typeorm`, `typeorm`, `date-fns-tz`.
  - Thiết lập cấu hình TypeORM hỗ trợ chạy Migrations từ CLI và chạy truy vấn SQL thô.
  - Loại bỏ hoàn toàn raw `pg` pool, chuyển hướng toàn bộ truy vấn qua TypeORM `DataSource.query()`.

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

```
[Môi trường (.env)]
       │
       ▼
[src/database/typeorm.config.ts] ──(Nạp cấu hình)──► [DataSource (TypeORM)]
       │                                                    │
       ▼ (Đăng ký)                                          ▼ (Thực thi)
[DatabaseModule / App] ──(Inject)──► [DatabaseService.query()] ──► [TimescaleDB]
```

Luồng dữ liệu diễn ra như sau:
1. Lúc ứng dụng khởi động, `TypeOrmModule` sẽ đọc cấu hình từ `typeorm.config.ts` để khởi tạo `DataSource`.
2. `DataSource` tự động quản lý một hồ chứa kết nối (Connection Pool) duy nhất đến TimescaleDB.
3. `DatabaseService` nhận dependency `DataSource` qua cơ chế Inject.
4. Mọi Service khác trong hệ thống khi cần truy vấn cơ sở dữ liệu thô sẽ gọi `DatabaseService.query(sql, params)`. Phương thức này thực thi lệnh SQL thông qua `DataSource.query()`.

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK 1: Cấu hình Dự án & CLI (Project Setup Track)

#### Task 1.1: Cập nhật dependency và scripts trong package.json
- **Tên file sửa đổi**: [package.json](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/package.json)
- **Hành động cụ thể**:
  - Thêm các dependency vào `dependencies`:
    - `"@nestjs/typeorm": "^10.0.2"` (hoặc phiên bản tương thích mới nhất)
    - `"typeorm": "^0.3.20"`
    - `"date-fns-tz": "^3.1.3"`
  - Thêm các CLI script vào `scripts`:
    - `"migration:run": "typeorm-ts-node-commonjs migration:run -d src/database/typeorm.config.ts"`
    - `"migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/database/typeorm.config.ts"`

---

### TRACK 2: Tầng Truy Cập Dữ Liệu (Data Access Layer Track)

#### Task 2.1: Khởi tạo file cấu hình typeorm.config.ts
- **Tên tệp tạo mới**: [typeorm.config.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/typeorm.config.ts)
- **Hành động cụ thể**:
  - Export cấu hình `DataSource` kết nối đến TimescaleDB bằng cách đọc trực tiếp biến môi trường `DATABASE_URL` (hoặc phân rã host, port, username, password, database).
  - Cấu hình pool limits: `extra.max = 20`, `extra.idleTimeoutMillis = 30000`, `extra.connectionTimeoutMillis = 2000`.
  - Cấu hình tự động đồng bộ hóa: `synchronize: false` (Bắt buộc).
  - Định nghĩa đường dẫn chứa entities: `entities: [__dirname + '/../**/*.entity{.ts,.js}']`.
  - Định nghĩa đường dẫn chứa migrations: `migrations: [__dirname + '/migrations/*{.ts,.js}']`.

#### Task 2.2: Refactor DatabaseModule để tích hợp TypeOrmModule
- **Tên file sửa đổi**: [database.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.module.ts)
- **Hành động cụ thể**:
  - Import `TypeOrmModule` từ `@nestjs/typeorm`.
  - Đăng ký `TypeOrmModule.forRootAsync` bằng cách import `DataSource` cấu hình từ `typeorm.config.ts`.
  - Khai báo export `TypeOrmModule` để các module khác có thể sử dụng `@InjectRepository()` nếu cần thiết.

#### Task 2.3: Refactor DatabaseService để loại bỏ pg Pool
- **Tên file sửa đổi**: [database.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/database/database.service.ts)
- **Hành động cụ thể**:
  - Xóa import `Pool` từ thư viện `pg`.
  - Inject `DataSource` (từ `typeorm`) thông qua constructor:
    ```typescript
    constructor(private readonly dataSource: DataSource) {}
    ```
  - Thay đổi logic `onModuleInit()`:
    - Loại bỏ việc khởi tạo `new Pool(...)` cũ.
    - Thực hiện kiểm tra kết nối bằng cách chạy thử một truy vấn đơn giản thông qua `this.dataSource.query('SELECT NOW()')`.
  - Thay đổi logic `onModuleDestroy()` hoặc để NestJS tự quản lý việc đóng kết nối.
  - Sửa đổi phương thức `query(text: string, params?: any[])`:
    - Gọi trực tiếp `this.dataSource.query(text, params)` để thay thế cho `this.pool.query`.
  - Xóa bỏ phương thức `getPool()`.

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

1. **Không trùng lặp Pool**: Đảm bảo sau khi refactor, ứng dụng không còn tạo bất kỳ instance nào của `pg.Pool` thủ công. Chỉ có duy nhất một connection pool do `DataSource` của TypeORM quản lý.
2. **An toàn Schema (No Auto-Sync)**: Thuộc tính `synchronize` trong cấu hình TypeORM phải được thiết lập cứng thành `false` ở mọi môi trường. Mọi thay đổi cấu trúc bảng bắt buộc phải đi qua tệp di cư (migrations).
3. **Quản lý biến môi trường**: Tệp `typeorm.config.ts` phải đọc cấu hình cơ sở dữ liệu từ biến môi trường `DATABASE_URL` hoặc thông qua các biến cấu hình chuẩn (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`). Không được chứa chuỗi nhạy cảm hardcode.
