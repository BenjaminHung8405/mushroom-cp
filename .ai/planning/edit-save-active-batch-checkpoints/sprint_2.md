# Sprint 2: Frontend Context Synchronisation & Equalizer UI

## 1. PHẠM VI & MỤC TIÊU
- **Module tác động**: `mushroom-ui` (batch-api, batch-context, batch-status-panel, fuzzy-logic-equalizer).
- **Mục tiêu**:
  - Tải cấu hình checkpoints thực tế của vụ đang hoạt động từ backend khi khởi động trang Dashboard.
  - Đồng bộ hóa các checkpoints này vào React State của `BatchProvider` để đồ thị Equalizer hiển thị đúng cấu hình thực tế thay vì cấu hình preset.
  - Bổ sung nút **"Lưu thay đổi vụ đang chạy"** trên đồ thị Equalizer khi đang trong vụ và gọi API cập nhật lên backend.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
```text
[User drags graph checkpoint]
             │
             ▼
[State updates in BatchContext (temp/humid checkpoints)]
             │
             ▼ (Nếu activeBatchId != null: Hiển thị nút "Lưu thay đổi")
[User clicks "Lưu thay đổi vụ đang chạy"]
             │
             ▼ (Gọi API PUT /batches/:id/checkpoints)
[updateBatchCheckpoints] ──► [NestJS Backend DB update]
             │
             ▼ (Cập nhật UI state & Thông báo thành công)
[Success message banner displays]
```

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### Track 1: Tầng Kết nối API (Client)
- **Task 1.1**: Cập nhật kiểu dữ liệu `ActiveBatch` và khai báo API caller để cập nhật checkpoints.
  - **Tên File**: `mushroom-ui/lib/batch-api.ts`
  - **Hàm/Interface**: `ActiveBatch`, `CheckpointInput`, `updateBatchCheckpoints`
  - **Nhiệm vụ**:
    1. Mở rộng interface `ActiveBatch` để có thêm trường `checkpoints` cấu trúc trùng khớp với backend.
    2. Viết hàm `updateBatchCheckpoints` gọi PUT HTTP request tới `${API_BASE}/batches/${batchId}/checkpoints`.

### Track 2: Tầng Quản lý Trạng thái (Context)
- **Task 2.1**: Bổ sung hàm đồng bộ dữ liệu vụ nuôi thực tế vào Context State.
  - **Tên File**: `mushroom-ui/lib/batch-context.tsx`
  - **Hàm/Interface**: `BatchContextType`, `syncFromActiveBatch`
  - **Nhiệm vụ**:
    1. Bổ sung `activeBatchId` và `syncFromActiveBatch` vào kiểu context.
    2. Triển khai logic `syncFromActiveBatch` để đồng bộ toàn bộ cài đặt vụ nuôi và checkpoints từ DB vào React state. Nếu không có vụ, reset `activeBatchId` về null.

### Track 3: Tầng UI Components & Event Handlers
- **Task 3.1**: Đồng bộ dữ liệu vụ nuôi khi load trang Dashboard.
  - **Tên File**: `mushroom-ui/components/batch-status-panel.tsx`
  - **Hàm**: `refresh`
  - **Nhiệm vụ**: Sau khi gọi `fetchActiveBatch`, thực hiện gọi `syncFromActiveBatch(activeBatch)` để nạp toàn bộ cấu hình thực tế của vụ nuôi vào context toàn cục.
- **Task 3.2**: Thiết kế nút bấm và viết handler lưu checkpoints tại đồ thị.
  - **Tên File**: `mushroom-ui/components/fuzzy-logic-equalizer.tsx`
  - **Hàm/Component**: `handleSaveChanges`, `FuzzyLogicEqualizer` render
  - **Nhiệm vụ**:
    1. Đọc `activeBatchId` từ context.
    2. Khởi tạo state: `isSavingCheckpoints` và `saveStatus` để hiển thị trạng thái và thông báo phản hồi.
    3. Triển khai `handleSaveChanges` gọi `updateBatchCheckpoints`.
    4. Thêm UI nút bấm "Lưu thay đổi vụ đang chạy" được styled đẹp (emerald gradient) xuất hiện ngay cạnh phần tên profile nếu `activeBatchId` khác null.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. **No State Mutation Desync**: Khi kéo đồ thị, state của context phải cập nhật bình thường nhưng không được tự động gửi API lưu liên tục. Chỉ gửi duy nhất khi người dùng nhấn nút "Lưu thay đổi vụ đang chạy".
2. **Double-Click Prevention**: Nút lưu phải bị `disabled` và hiển thị trạng thái loading ("Đang lưu...") trong lúc API request đang bay để tránh người dùng nhấn click nhiều lần liên tiếp gây xung đột dữ liệu.
3. **TypeScript Compliance**: Đảm bảo không sử dụng kiểu `any` ở các file context và API, thực hiện cast kiểu dữ liệu và sắp xếp thứ tự checkpoints chẵn theo ngày (`sort((a, b) => a.day - b.day)`) trước khi render hoặc gửi lên backend.
