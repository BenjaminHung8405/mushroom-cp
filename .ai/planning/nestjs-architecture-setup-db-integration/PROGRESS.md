# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-09T21:16:23+07:00
- **Agent thực thi**: Gemini

## Reference Plan
- **Thư mục kế hoạch**: [nestjs-architecture-setup-db-integration](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/)
- **Sprint hiện tại**: [sprint_4.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/nestjs-architecture-setup-db-integration/sprint_4.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có

## Tracks

### Track A: Tầng Giả Lập & Đệm Dữ Liệu (Simulation Track)

| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| A1 | Triển khai SimulationService và cơ chế ghi Bulk Insert | [ ] Pending | - **Chống rò rỉ bộ nhớ (Memory Leak Prevention)**: Khi dừng mô phỏng hoặc hủy module, tất cả các timer liên quan đến mô phỏng (`timerId`, `flushTimerId`) phải được hủy bỏ triệt để thông qua `clearInterval` / `clearTimeout` tại `stopSimulation` và hook `onModuleDestroy`. <br>- **Bảo toàn dữ liệu đệm (No Data Loss)**: Khai báo triển khai `OnModuleDestroy`. Bắt buộc thực hiện `await this.flushBuffer()` trong hook này để đảm bảo toàn bộ dữ liệu đệm trong RAM được ghi thành công xuống TimescaleDB trước khi tiến trình backend Node.js dừng hẳn.<br>- **Chống tranh chấp tài nguyên (Race Condition Prevention)**: Khi bắt đầu `flushBuffer()`, lập tức sao chép hàng đợi đệm sang một mảng tạm thời và xóa rỗng mảng hàng đợi gốc (`this.bufferQueue = []`) trước khi chạy tác vụ chèn dữ liệu bất đồng bộ. Điều này đảm bảo dữ liệu mới sinh ra trong quá trình chèn không bị mất hoặc chèn trùng lặp.<br>- **Tối ưu hóa Bulk Insert**: Câu lệnh SQL Bulk Insert phải được định dạng chèn hàng loạt (nhiều cụm `VALUES`) trong duy nhất một truy vấn, hạn chế tối đa việc lặp qua từng phần tử để gọi insert đơn lẻ gây nghẽn Connection Pool. |
| A2 | Triển khai SimulationController để quản lý sandbox từ API | [ ] Pending | - **Cô lập Sandbox**: Đảm bảo các API quản lý giả lập kiểm tra kỹ tham số đầu vào. Dữ liệu giả lập sinh ra chỉ được phép gắn với mã vụ nuôi Sandbox chuyên biệt, tuyệt đối không ghi đè hoặc gây nhiễu dữ liệu vận hành thực tế của các nhà nấm vật lý.<br>- **Validation đầu vào**: Validate nghiêm ngặt `speedMultiplier` (ví dụ: chỉ cho phép số dương, giới hạn giá trị tối đa để tránh quá tải CPU/RAM hệ thống). |
| A3 | Thiết lập SimulationModule | [ ] Pending | - **Chống nợ kỹ thuật**: Tổ chức import sạch (clean imports) các module liên quan (`DatabaseModule`, `TelemetryModule`). Đảm bảo không tạo ra vòng lặp import chéo giữa các Module. |

### Track B: Dọn Dẹp & Đồng Bộ Hệ Thống (Cleanups Track)

| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| B1 | Xóa bỏ TelemetryQueryService cũ | [ ] Pending | - **Dọn dẹp mã nguồn**: Xóa bỏ hoàn toàn tệp `telemetry-query.service.ts` cũ khỏi thư mục `src/database/`. Gỡ bỏ toàn bộ khai báo và import của service này khỏi `DatabaseModule` cũng như bất kỳ nơi nào khác trong ứng dụng để loại bỏ mã chết (dead code removal). |
| B2 | Khai báo các Module mới trong AppModule | [ ] Pending | - **Tích hợp đồng bộ**: Nhúng các module mới (`DatabaseModule`, `BatchModule`, `TelemetryModule`, `SimulationModule`) vào mảng `imports` của `AppModule`. Kiểm tra kỹ lưỡng lỗi dependency injection khi khởi tạo ứng dụng NestJS. Đảm bảo toàn bộ ứng dụng build TypeScript thành công, không gặp lỗi runtime liên quan đến import. |
