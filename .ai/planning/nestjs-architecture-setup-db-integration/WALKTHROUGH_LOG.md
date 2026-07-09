# WALKTHROUGH_LOG.md

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
