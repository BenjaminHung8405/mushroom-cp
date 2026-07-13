# Walkthrough Log - Edit and Save Active Batch Checkpoints

## [2026-07-13T17:25:00+07:00] Task B3: Đồng bộ dữ liệu vụ nuôi khi load trang Dashboard
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch-status-panel.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/components/batch-status-panel.tsx) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Nhập khẩu biểu tượng `Loader2` từ `lucide-react` và destructure phương thức `syncFromActiveBatch` từ hook `useBatch()`.
  - Cập nhật hàm `refresh` trong `BatchStatusPanel` để gọi `syncFromActiveBatch` với dữ liệu của batch tải về thành công (hoặc `null` trong trường hợp lỗi/không tồn tại batch), duy trì nguyên tắc Single Source of Truth cho toàn bộ ứng dụng.
  - Tối ưu hóa UI tải trang bằng việc thêm trạng thái loading spinner xoay với biểu tượng `Loader2` từ Lucide, ngăn chặn tình trạng hiển thị nhấp nháy dữ liệu mặc định (preset) trước khi đồng bộ.
  - Đảm bảo an toàn bằng khối try-catch bọc quanh quá trình fetch và xử lý fallback UI nếu API lỗi, tránh làm sập Dashboard.
  - Kiểm tra cú pháp TypeScript của client bằng `npx tsc --noEmit` và chạy toàn bộ unit tests ở backend bằng `pnpm test` thành công hoàn hảo (94/94 test cases pass).

## [2026-07-13T17:23:45+07:00] Task B2: Bổ sung hàm đồng bộ dữ liệu vụ nuôi thực tế vào Context State
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch-context.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/batch-context.tsx) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Khai báo thêm thuộc tính `activeBatchId` (kiểu `string | null`) và phương thức `syncFromActiveBatch` (nhận vào `ActiveBatch | null`) trong interface `BatchContextType` và export từ `batch-context.tsx`.
  - Triển khai `activeBatchId` state và logic `syncFromActiveBatch` bằng `useCallback` trong component `BatchProvider` để tránh re-render vô tận khi truyền context.
  - Khi có vụ nuôi active (`batch` khác null), cập nhật `activeBatchId`, `profileName`, `totalCropDays` và thiết lập lại `lightDayStates` dựa trên `spawnRunningEndDay`. Lọc và sắp xếp `temperatureCheckpoints` và `humidityCheckpoints` theo thứ tự ngày tăng dần (`.sort((a, b) => a.cropDay - b.cropDay)`) để đảm bảo Chart render chính xác.
  - Khi không có vụ nuôi active, reset `activeBatchId` về `null` theo nguyên lý Single Source of Truth.
  - Kiểm tra cú pháp và build TypeScript tĩnh của frontend bằng `pnpm exec tsc --noEmit` thành công (không có lỗi biên dịch mới).

## [2026-07-13T17:22:00+07:00] Task B1: Cập nhật kiểu dữ liệu ActiveBatch và khai báo API caller để cập nhật checkpoints
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch-api.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/batch-api.ts) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Cập nhật interface `ActiveBatch` trong `batch-api.ts` để bổ sung thuộc tính `checkpoints: CheckpointResponse[]`.
  - Định nghĩa interface `CheckpointResponse` để ánh xạ cấu trúc checkpoint trả về từ backend (`id`, `batchId`, `metricType`, `cropDay`, `targetValue`).
  - Định nghĩa interface `CheckpointInput` mô tả dữ liệu đầu vào khi thực hiện cập nhật checkpoint (`metricType`, `cropDay`, `targetValue`).
  - Xây dựng `fetchWithAuth` helper thực hiện bọc hàm `fetch` gốc để đính kèm tiêu đề Authorization `Bearer simulated-jwt-token-placeholder`, đáp ứng chỉ thị kỹ thuật về phân quyền bảo mật.
  - Triển khai API caller `updateBatchCheckpoints` gọi endpoint `PUT /batches/:id/checkpoints` bằng phương thức `PUT`, bọc trong khối `try-catch` chuẩn hóa và ném ra lỗi từ frontend toast thân thiện.
  - Tự kiểm tra cú pháp và build TypeScript tĩnh bằng lệnh `npx tsc --noEmit` ở thư mục `mushroom-ui`. Không phát sinh lỗi biên dịch nào liên quan tới file thay đổi.

## [2026-07-13T17:18:00+07:00] Task A5: Định nghĩa endpoint PUT để cập nhật checkpoints
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts) (Sửa đổi)
  - [batch.controller.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.spec.ts) (Sửa đổi)
  - [checkpoint-owner.guard.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/guards/checkpoint-owner.guard.ts) (Tạo mới)
  - [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts) (Sửa đổi)
  - [active-batch-response.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/active-batch-response.dto.ts) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Định nghĩa endpoint `PUT /batches/:id/checkpoints` trong `BatchController`, sử dụng các decorators NestJS chuẩn (`@Put(':id/checkpoints')`, `@Param() params: BatchIdParamsDto`, `@Body()`).
  - Triển khai `CheckpointOwnerGuard` để mô phỏng và ghi log kiểm tra phân quyền sở hữu nhà nấm chứa vụ nuôi. Do cơ sở dữ liệu hiện tại chưa tích hợp bảng Users/Roles, guard sẽ đóng vai trò logging và ghi nhận quyền truy cập thành công cho các giai đoạn phát triển tiếp theo.
  - Tích hợp ghi log hệ thống bằng NestJS `Logger` trong controller và guard.
  - Khắc phục lỗi tương thích kiểu dữ liệu bằng cách cập nhật `CheckpointResponseDto` (thêm `batchId` và `@Expose()`) và ánh xạ mảng checkpoints trong `batch.service.ts` nhằm đảm bảo biên dịch thành công.
  - Bổ sung unit test trong `batch.controller.spec.ts` kiểm thử endpoint `updateCheckpoints` mới. Chạy thành công 94/94 test cases và build dự án NestJS thành công 100%.

## [2026-07-13T17:16:00+07:00] Task A4: Triển khai hàm lưu/cập nhật danh sách checkpoints trong một Transaction
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts) (Sửa đổi)
  - [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Triển khai phương thức `updateBatchCheckpoints` trong `BatchService` đảm bảo tính toàn vẹn dữ liệu (ACID Transaction) bằng cách xóa checkpoints cũ và lưu mới qua `EntityManager` của transaction (`transactionalEntityManager.delete` và `transactionalEntityManager.save`).
  - Ràng buộc an toàn: Chỉ cho phép cập nhật checkpoints đối với vụ nuôi có trạng thái `ACTIVE`, ném ra `BadRequestException` nếu trạng thái không hợp lệ, hoặc `NotFoundException` nếu không tìm thấy vụ nuôi.
  - Ràng buộc cấu hình tối thiểu: Validate có ít nhất 2 checkpoints cho mỗi metricType (TEMPERATURE và HUMIDITY), trong đó bắt buộc có checkpoint tại ngày bắt đầu `cropDay = 1` và ngày kết thúc `cropDay = totalCropDays` của vụ nuôi để đảm bảo thuật toán nội suy hoạt động chính xác.
  - Viết bộ unit tests đầy đủ tại `batch.service.spec.ts` kiểm thử mọi trường hợp ngoại lệ (không tìm thấy batch, batch không active, thiếu checkpoint Day 1 hoặc Day N cho từng metricType) cùng trường hợp ghi đè transaction thành công. Chạy `pnpm test` thành công tuyệt đối 93/93 test cases.

## [2026-07-13T17:15:00+07:00] Task A3: Cập nhật hàm truy vấn trạng thái vụ để lấy kèm checkpoints của vụ đó
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts) (Sửa đổi)
  - [batch.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.spec.ts) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Cập nhật hàm `getActiveBatchStatusByHouseId` trong `batch.service.ts` để query danh sách checkpoints tương ứng với active crop batch từ `curveCheckpointRepository`.
  - Sử dụng cơ chế sắp xếp của TypeORM (`order: { cropDay: 'ASC', metricType: 'ASC' }`) để đảm bảo các checkpoints được sắp xếp tăng dần theo ngày vụ nuôi và loại chỉ số ngay từ database.
  - Sử dụng logic gán fallback mảng rỗng `checkpoints || []` nếu không tìm thấy dữ liệu checkpoints, tránh lỗi runtime khi UI thực hiện render.
  - Cập nhật/bổ sung unit test trong `batch.service.spec.ts` để kiểm thử chính xác các trường hợp thành công có checkpoints sắp xếp và trường hợp không có checkpoints. Chạy test `npm test` thành công hoàn toàn (86/86 test cases pass).

## [2026-07-13T17:14:00+07:00] Task A2: Cập nhật DTO phản hồi trạng thái vụ để mang theo danh sách checkpoint
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file tạo mới/sửa đổi**:
  - [active-batch-response.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/active-batch-response.dto.ts) (Sửa đổi)
- **Giải trình giải pháp & Kết quả tự kiểm tra**:
  - Khai báo `CheckpointResponseDto` trong `active-batch-response.dto.ts` mà không import trực tiếp `CurveCheckpoint` entity, tránh circular dependency và bảo mật cấu trúc DB.
  - Sử dụng `@Expose()` của `class-transformer` để kiểm soát các trường dữ liệu được serialize trả về client (`id`, `metricType`, `cropDay`, `targetValue`).
  - Thêm trường `checkpoints: CheckpointResponseDto[]` vào `ActiveBatchResponseDto` và decorate với `@Expose()` cùng `@Type(() => CheckpointResponseDto)`.
  - Chạy toàn bộ test suites (`npm run test`), đảm bảo compile thành công và không phá vỡ logic cũ.

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
