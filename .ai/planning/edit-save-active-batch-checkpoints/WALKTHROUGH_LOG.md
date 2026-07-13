# Walkthrough Log - Edit and Save Active Batch Checkpoints

## [2026-07-13T17:13:00+07:00] Task A1: Tạo DTO validation cho danh sách các checkpoint đầu vào
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [update-checkpoints.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/update-checkpoints.dto.ts) (Tạo mới)
  - [update-checkpoints.dto.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/update-checkpoints.dto.spec.ts) (Tạo mới)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Tạo `CheckpointDto` với các decorators từ `class-validator` để validate các trường:
    - `metricType`: sử dụng enum `MetricType` (`TEMPERATURE` và `HUMIDITY`).
    - `cropDay`: số nguyên (`@IsInt()`) nằm trong khoảng 1-45 (`@Min(1)`, `@Max(45)`).
    - `targetValue`: số thực/số nguyên (`@IsNumber()`) nằm trong khoảng 0-100 (`@Min(0)`, `@Max(100)`).
  - Tạo `UpdateCheckpointsDto` chứa danh sách checkpoints với `@IsArray()`, `@ValidateNested({ each: true })` và `@Type(() => CheckpointDto)` để hỗ trợ kiểm tra mảng nested.
  - Viết unit tests đầy đủ cho `UpdateCheckpointsDto` tại `update-checkpoints.dto.spec.ts`.
  - Đã chạy thử nghiệm unit test nội bộ bằng Jest (`npm test`), tất cả 85 tests bao gồm các test cases validation mới đều pass hoàn toàn.
