# Sprint 1: Backend Endpoint & Database Transaction Updates

## 1. PHẠM VI & MỤC TIÊU
- **Module tác động**: `mushroom-backend` (Batch Module, Telemetry Module).
- **Mục tiêu**:
  - Expose API để cập nhật checkpoints của vụ đang hoạt động.
  - Đồng bộ và trả về danh sách checkpoints hiện tại trong API truy vấn trạng thái vụ nuôi của nhà nấm.
  - Đảm bảo an toàn giao dịch dữ liệu (ACID) khi ghi đè checkpoints.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
```text
[Web UI PUT Request]
       │
       ▼ (Đầu vào: Array checkpoins)
[BatchController.updateCheckpoints]
       │
       ▼ (Validate: CheckpointDto & Active Batch Check)
[BatchService.updateBatchCheckpoints]
       │
       ├─► [EntityManager.transaction] (Bắt đầu Transaction)
       │         │
       │         ├─► [Delete old checkpoints] (Xóa checkpoints cũ của batch_id)
       │         │
       │         └─► [Insert new checkpoints] (Thêm checkpoints mới)
       │
       ▼ (Trả về kết quả thành công)
[Web UI / Database updated]
```

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### Track 1: Tầng Dữ liệu & DTO Validation
- **Task 1.1**: Tạo DTO validation cho danh sách các checkpoint đầu vào.
  - **Tên File**: `mushroom-backend/src/batch/dto/update-checkpoints.dto.ts`
  - **Class/Hàm**: `CheckpointDto`, `UpdateCheckpointsDto`
  - **Nhiệm vụ**: Xác thực từng thuộc tính (`metricType` thuộc enum TEMPERATURE/HUMIDITY, `cropDay` trong khoảng 1-45, `targetValue` là số thực từ 0-100).
- **Task 1.2**: Cập nhật DTO phản hồi trạng thái vụ để mang theo danh sách checkpoint.
  - **Tên File**: `mushroom-backend/src/batch/dto/active-batch-response.dto.ts`
  - **Class/Hàm**: `ActiveBatchResponseDto`
  - **Nhiệm vụ**: Thêm trường `checkpoints?: CurveCheckpoint[]`.

### Track 2: Tầng Nghiệp vụ (Service)
- **Task 2.1**: Cập nhật hàm truy vấn trạng thái vụ để lấy kèm checkpoints của vụ đó.
  - **Tên File**: `mushroom-backend/src/batch/services/batch.service.ts`
  - **Hàm**: `getActiveBatchStatusByHouseId`
  - **Nhiệm vụ**: Gọi `this.curveCheckpointRepository.find({ where: { batchId: activeBatch.id } })` và gán kết quả vào thuộc tính `checkpoints` của phản hồi trước khi trả về.
- **Task 2.2**: Triển khai hàm lưu/cập nhật danh sách checkpoints trong một Transaction.
  - **Tên File**: `mushroom-backend/src/batch/services/batch.service.ts`
  - **Hàm**: `updateBatchCheckpoints`
  - **Nhiệm vụ**:
    1. Kiểm tra sự tồn tại và trạng thái `ACTIVE` của batch.
    2. Chạy `this.curveCheckpointRepository.manager.transaction` để thực hiện xóa và ghi mới toàn bộ checkpoints cho `batchId` đầu vào.

### Track 3: Tầng API (Controller)
- **Task 3.1**: Định nghĩa endpoint PUT để cập nhật checkpoints.
  - **Tên File**: `mushroom-backend/src/batch/controllers/batch.controller.ts`
  - **Hàm**: `updateCheckpoints`
  - **Nhiệm vụ**: Bản đồ hóa phương thức `PUT /batches/:id/checkpoints` để nhận dữ liệu, gọi `batchService.updateBatchCheckpoints` và trả về kết quả.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. **Transaction Isolation**: Bắt buộc phải thực hiện xóa và lưu checkpoints mới của một `batch_id` trong cùng một transaction. Tuyệt đối không được xóa trước rồi lưu sau bằng 2 lệnh độc lập ngoài transaction.
2. **Active Batch Restriction**: Không cho phép cập nhật checkpoints cho bất kỳ vụ nuôi nào có trạng thái khác `ACTIVE` (ví dụ: `COMPLETED` hoặc `ABORTED`).
3. **Data Completeness**: Dữ liệu gửi lên phải chứa ít nhất 2 checkpoints cho mỗi loại metric (một cho ngày đầu tiên/Day 1, và một cho ngày cuối cùng/Day N) để tránh làm hỏng thuật toán nội suy.
