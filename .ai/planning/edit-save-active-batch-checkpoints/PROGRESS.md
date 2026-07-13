# Progress Tracking: Edit and Save Active Batch Checkpoints

## Started
- **Start Time**: 2026-07-13T17:09:08+07:00
- **Executing Agent**: Gemini

## Reference Plan
- **Directory**: `.ai/planning/edit-save-active-batch-checkpoints/`
- **Sprint 1 File**: [.ai/planning/edit-save-active-batch-checkpoints/sprint_1.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/edit-save-active-batch-checkpoints/sprint_1.md)
- **Sprint 2 File**: [.ai/planning/edit-save-active-batch-checkpoints/sprint_2.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/edit-save-active-batch-checkpoints/sprint_2.md)

## Addition Plan
- Chưa có.

---

## Track A: Backend Endpoint & Database Transaction Updates (Sprint 1)

| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| **A1** | Tạo DTO validation cho danh sách các checkpoint đầu vào.<br>• **File**: [update-checkpoints.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/update-checkpoints.dto.ts)<br>• **Class/Hàm**: `CheckpointDto`, `UpdateCheckpointsDto` | [ ] QA Review | - Sử dụng `class-validator` decorator (`@IsEnum`, `@IsInt`, `@Min`, `@Max`, `@IsNumber`, `@ValidateNested`, `@IsArray`).<br>- Bắt buộc dùng `@Type(() => CheckpointDto)` từ `class-transformer` để đảm bảo validate nested array hoạt động.<br>- Nghiêm cấm dùng `any`. Validate chặt chẽ miền giá trị: `cropDay` (1-45), `targetValue` (0-100), `metricType` (chỉ nhận đúng enum TEMPERATURE/HUMIDITY). |
| **A2** | Cập nhật DTO phản hồi trạng thái vụ để mang theo danh sách checkpoint.<br>• **File**: [active-batch-response.dto.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/dto/active-batch-response.dto.ts)<br>• **Class/Hàm**: `ActiveBatchResponseDto` | [ ] QA Review | - Không import thực thể database (`CurveCheckpoint` entity) trực tiếp làm kiểu dữ liệu trong DTO để tránh lộ cấu trúc DB và tránh circular dependency.<br>- Sử dụng `@Expose()` để kiểm soát các trường dữ liệu trả về client.<br>- Kiểu dữ liệu checkpoints nên là mảng các đối tượng DTO đơn giản đại diện cho checkpoint. |
| **A3** | Cập nhật hàm truy vấn trạng thái vụ để lấy kèm checkpoints của vụ đó.<br>• **File**: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)<br>• **Hàm**: `getActiveBatchStatusByHouseId` | [ ] QA Review | - Tránh N+1 query: Sử dụng eager loading hoặc join query tối ưu nếu cần. Đảm bảo trường `batchId` trong bảng `curve_checkpoints` đã có index.<br>- Sắp xếp checkpoints tăng dần theo `cropDay` (hoặc `cropDay` và `metricType`) ngay từ câu query (`order: { cropDay: 'ASC' }`).<br>- Xử lý case an toàn: Nếu không tìm thấy checkpoints, gán mảng rỗng `[]` thay vì để `undefined` hoặc `null` gây lỗi runtime cho React UI. |
| **A4** | Triển khai hàm lưu/cập nhật danh sách checkpoints trong một Transaction.<br>• **File**: [batch.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/services/batch.service.ts)<br>• **Hàm**: `updateBatchCheckpoints` | [ ] QA Review | - **ACID Transaction**: Bắt buộc thực hiện xóa checkpoints cũ và lưu checkpoints mới qua `EntityManager` của transaction (`transactionalEntityManager.delete` và `transactionalEntityManager.save`). Không dùng repository gốc trực tiếp.<br>- **Active Batch Restriction**: Chỉ cho phép cập nhật khi batch có trạng thái `ACTIVE`. Nếu không, ném ra `BadRequestException` hoặc `ConflictException`. Lỗi phải được rollback sạch sẽ.<br>- **Dữ liệu tối thiểu**: Validate có ít nhất 2 checkpoints cho mỗi metricType (một cho day 1, một cho day N) trước khi thực hiện lưu. |
| **A5** | Định nghĩa endpoint PUT để cập nhật checkpoints.<br>• **File**: [batch.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/batch/controllers/batch.controller.ts)<br>• **Hàm**: `updateCheckpoints` | [ ] QA Review | - Sử dụng decorators NestJS chuẩn: `@Put(':id/checkpoints')`, `@Param('id', ParseIntPipe)`, `@Body()`.<br>- Tích hợp ghi log hệ thống (không dùng `console.log`).<br>- Đảm bảo kiểm tra phân quyền (Guard): chỉ tài khoản quản trị hoặc chủ nấm sở hữu nhà nấm chứa batch mới được thay đổi cấu hình checkpoints. |

---

## Track B: Frontend Context Synchronisation & Equalizer UI (Sprint 2)

| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| **B1** | Cập nhật kiểu dữ liệu `ActiveBatch` và khai báo API caller để cập nhật checkpoints.<br>• **File**: [batch-api.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/batch-api.ts)<br>• **Hàm/Interface**: `ActiveBatch`, `CheckpointInput`, `updateBatchCheckpoints` | [ ] QA Review | - Khai báo kiểu TypeScript rõ ràng, không sử dụng `any` hay `unknown`. Sử dụng `Axios` (hoặc fetch wrapper) đã tích hợp Bearer Token bảo mật.<br>- Xử lý lỗi chuẩn: bọc trong `try-catch`, ném ra Exception định dạng chuẩn để Frontend Toast có thể nhận diện và hiển thị thông báo lỗi chi tiết. |
| **B2** | Bổ sung hàm đồng bộ dữ liệu vụ nuôi thực tế vào Context State.<br>• **File**: [batch-context.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/batch-context.tsx)<br>• **Hàm/Interface**: `BatchContextType`, `syncFromActiveBatch` | [ ] QA Review | - Sử dụng `useCallback` cho hàm `syncFromActiveBatch` để tránh việc re-render vô tận khi truyền context.<br>- **Single Source of Truth**: Đồng bộ dữ liệu vụ nuôi và checkpoints từ DB vào React state. Nếu không có vụ, reset `activeBatchId` về null.<br>- Sắp xếp mảng checkpoints theo thứ tự ngày tăng dần (`.sort((a, b) => a.cropDay - b.cropDay)`) trước khi cập nhật vào state nhằm đảm bảo SVG/Chart.js render chính xác. |
| **B3** | Đồng bộ dữ liệu vụ nuôi khi load trang Dashboard.<br>• **File**: [batch-status-panel.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/components/batch-status-panel.tsx)<br>• **Hàm**: `refresh` | [ ] Pending | - Gọi `syncFromActiveBatch` ngay sau khi tải thành công thông tin batch trong useEffect hoặc hàm refresh.<br>- Thêm Loading spinner/state để tránh nhấp nháy hoặc hiển thị dữ liệu cũ (preset) trong lúc đồng bộ.<br>- Đảm bảo có fallback UI khi việc fetch thông tin batch bị lỗi để không làm sập toàn bộ trang dashboard. |
| **B4** | Thiết kế nút bấm và viết handler lưu checkpoints tại đồ thị.<br>• **File**: [fuzzy-logic-equalizer.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/components/fuzzy-logic-equalizer.tsx)<br>• **Hàm/Component**: `handleSaveChanges`, `FuzzyLogicEqualizer` render | [ ] Pending | - **Double-Click Prevention**: Nút bấm phải chuyển sang trạng thái disabled và hiển thị spinner/text "Đang lưu..." trong khi gọi API.<br>- **Dirty Check**: Chỉ cho phép bấm nút "Lưu thay đổi" khi người dùng thực sự kéo sửa điểm trên đồ thị (so sánh state hiện tại với initial checkpoints của active batch).<br>- Phản hồi người dùng: Hiển thị Toast (emerald cho thành công, red cho thất bại).<br>- Đảm bảo thiết kế Responsive trên Desktop & Mobile, sử dụng Tailwind CSS emerald gradient và bo góc chuẩn Shadcn UI. |
