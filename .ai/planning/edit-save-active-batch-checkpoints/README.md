# Plan: Edit and Save Active Batch Checkpoints

Mục tiêu của plan này là cho phép người dùng thay đổi và lưu trực tiếp đường cong sinh trưởng (các checkpoint nhiệt độ, độ ẩm mục tiêu) của một vụ nuôi đang hoạt động (`ACTIVE`) trực tiếp từ giao diện Web UI mà không cần phải kết thúc và khởi động lại vụ nuôi.

## 1. Mục tiêu kỹ thuật tổng quát
- **Real-Time Setpoint Dispatch**: Cập nhật tức thời giá trị nội suy cài đặt gửi xuống ESP32 trong vòng 5-10 giây ngay sau khi lưu.
- **Data Integrity**: Đảm bảo các checkpoint của từng vụ được cách ly và lưu trữ an toàn trong cơ sở dữ liệu thông qua cơ chế database transaction (ACID).
- **UX Synchronization**: Đồng bộ tức thời trạng thái đồ thị hiển thị trong `FuzzyLogicEqualizer` với cấu hình checkpoints của vụ đang hoạt động trong database.

## 2. Techstack cốt lõi
- **Backend (NestJS)**:
  - Framework: NestJS (TypeScript)
  - ORM: TypeORM
  - Database: PostgreSQL (với TimescaleDB extension)
  - Validation: `class-validator`, `class-transformer`
- **Frontend (Next.js)**:
  - Framework: Next.js 14 (App Router, React Server Components & Client Components)
  - Styling: Tailwind CSS, Lucide Icons, Shadcn UI
  - State Management: React Context API (`BatchProvider`)

## 3. Quy tắc viết code toàn cục (Coding Conventions)
- **SOLID Principles**: Đảm bảo các Service, Controller và DTO tuân thủ nguyên tắc trách nhiệm đơn lẻ (Single Responsibility Principle).
- **Clean Architecture & Layer Separation**:
  - Tầng API (Controller) chỉ đảm nhận việc định tuyến và validate đầu vào.
  - Tầng Nghiệp vụ (Service) xử lý các giao dịch cơ sở dữ liệu và ràng buộc logic.
- **Database Transaction**: Tất cả các cập nhật liên quan đến nhiều bản ghi hoặc thay đổi cấu hình quan trọng phải được chạy trong một Transaction duy nhất thông qua `EntityManager.transaction`.
- **TypeScript Strict Mode**: Không sử dụng kiểu `any` cho các biến hoặc tham số mới. Định nghĩa rõ ràng các DTO, Interfaces và Types.
- **Error Handling**: 
  - Backend sử dụng built-in NestJS Exceptions (như `NotFoundException`, `ConflictException`).
  - Frontend xử lý và hiển thị lỗi thân thiện với người dùng thông qua các toast hoặc thông báo trạng thái trực quan trên UI.
