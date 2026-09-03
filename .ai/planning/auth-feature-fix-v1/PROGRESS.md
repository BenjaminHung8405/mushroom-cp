# TIẾN ĐỘ THỰC THI HỆ THỐNG
## Started
* **Thời gian kích hoạt:** 2026-09-03 10:25 (ICT)
* **Execution Agent phụ trách:** Codex Execution Agent

## Reference Plan
* **Đường dẫn gốc:** `.ai/planning/auth-feature-fix-v1/`
* **Tệp tin Sprint đang chạy:** `sprint_1.md`

## Addition Plan
* *[Ghi chú]*: Chưa có yêu cầu phát sinh từ phía lập trình viên con người.

---

## Track A: Credential persistence
*Nguồn phân rã:* `.ai/planning/auth-feature-fix-v1/sprint_1.md`

| Task ID | Mô tả Task | Status | Note hoặc các thông tin cần thiết để thực hiện chuẩn chỉnh |
| :--- | :--- | :--- | :--- |
| A1 | Sửa `mushroom-backend/src/auth/admin-devices.controller.ts`, gồm `createDevice()` và `regenerateDeviceToken()`; sinh raw token một lần, chỉ trả về khi provisioning và lưu digest (Sprint 1). | `[ ] Pending` | Dùng SHA-256 digest trước persistence và không ghi raw token vào log, audit, response ngoài provisioning hoặc telemetry. Đảm bảo token cũ bị vô hiệu sau regenerate và response provisioning chỉ hiển thị raw token đúng một lần. |
| A2 | Sửa `mushroom-backend/src/mqtt-auth/mqtt-auth.service.ts`, gồm `authenticate()` và `hashDeviceToken()`; xác thực bằng digest lookup và kiểm tra trạng thái device (Sprint 1). | `[ ] Pending` | Có index cho digest lookup và constant-time comparison; deny plaintext/legacy token theo rollout, wildcard client/topic và inactive device. Không chạy Argon2 ngoài credential operation và mọi deny path phải trả/log contract ổn định không chứa credential. |
| A3 | Tạo migration `mushroom-backend/src/database/migrations/<timestamp>-HashMqttDeviceTokens.ts`, gồm `up(queryRunner)`, `down(queryRunner)` và schema `devices.token` (Sprint 1). | `[ ] Pending` | Migration phải idempotent với legacy/missing token, có marker và index cần thiết; nếu không thể hash one-way thì regenerate/re-enroll thay vì giả chuyển đổi. Rollback phải an toàn, không khôi phục plaintext, không khóa bảng lâu ngoài cửa sổ deploy và cần rehearsal trên bản sao dữ liệu. |

---

## Track B: PIN abuse controls
*Nguồn phân rã:* `.ai/planning/auth-feature-fix-v1/sprint_1.md`

| Task ID | Mô tả Task | Status | Note hoặc các thông tin cần thiết để thực hiện chuẩn chỉnh |
| :--- | :--- | :--- | :--- |
| B1 | Sửa `mushroom-backend/src/auth/auth.service.ts`, gồm `setPin()`, `verifyPin()`, `throttleDelay()` và `recordSecurityEvent()`; áp dụng lockout, audit, hash PIN và revoke theo flow hiện hữu (Sprint 1). | `[ ] Pending` | Failed current PIN phải tăng counter/lockout và delay, đồng thời dùng error contract không phân biệt user/PIN; counter phải atomic/transaction-safe để không lost update khi concurrent attempts. Success phải reset counter phù hợp, hash Argon2id đúng tham số và revoke sessions/devices theo policy; không log hoặc trả PIN. |
| B2 | Sửa `mushroom-backend/src/auth/auth.service.spec.ts` cho test suite `setPin` và `verifyPin` (Sprint 1). | `[ ] Pending` | Bao phủ wrong PIN lặp lại, lockout boundary, concurrent attempts, audit failure và success reset; xác nhận deny path không leak PIN hoặc phân biệt user không tồn tại. Kiểm tra session/device revoke, status/error code ổn định và không chạy credential hash ngoài credential path. |

---

## Track C: Runtime contract & operations
*Nguồn phân rã:* `.ai/planning/auth-feature-fix-v1/sprint_1.md`

| Task ID | Mô tả Task | Status | Note hoặc các thông tin cần thiết để thực hiện chuẩn chỉnh |
| :--- | :--- | :--- | :--- |
| C1 | Sửa `mushroom-backend/src/main.ts`, gồm `bootstrap()` và cấu hình Express `trust proxy`; canonicalize client IP qua boundary tin cậy (Sprint 1). | `[ ] Pending` | Chỉ tin số hop/CIDR proxy đã cấu hình theo deployment, không tin tùy ý `X-Forwarded-For`; direct request/forged forwarded header phải bị chặn hoặc không làm sai IP. Test phải chứng minh Redis per-IP rate-limit dùng đúng client IP qua trusted proxy và không bypass auth/rate-limit. |
| C2 | Tạo `mushroom-backend/src/common/filters/http-exception.filter.ts`, gồm `HttpExceptionFilter.catch()` và `AuthErrorCode`; chuẩn hóa error response (Sprint 1). | `[ ] Pending` | Mọi lỗi auth trả `{ statusCode, code, message }` với mapping `PIN_CHANGE_REQUIRED`, `SESSION_REQUIRED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`; không trả stack trace, raw token, PIN, secret hoặc SQL detail. Giữ status/header tương thích và xác minh toàn bộ allow/deny path có code ổn định. |
| C3 | Sửa `mushroom-backend/src/auth/admin.controller.ts`, gồm `updateUser()`, `pinReset` và `accessChanged`; transaction hóa reset và revoke (Sprint 1). | `[ ] Pending` | Tách rõ flags `pinReset`/`accessChanged` và xác thực quyền/ownership từ server, không tin ID hoặc flags do client gửi để vượt policy. Save + session/device revoke phải atomic/idempotent; failure phải rollback để không còn trạng thái user nửa reset và phải phát audit event không chứa credential. |
| C4 | Sửa/tạo `.env.example`, `scripts/verify-backend-auth-config.mjs` và Git/secret-management runbook theo convention repo; triển khai `verifyAuthConfig()` và quy trình rotation (Sprint 1). | `[ ] Pending` | `.env.example` chỉ chứa placeholder, không commit secret mới; kiểm tra phải fail closed khi thiếu/không an toàn config auth và secret scan phải rà git history. Nếu exposure confirmed, rotate `WIFI_PASSWORD`/shared MQTT secret, cập nhật device enrollment và ghi rollback/runbook mà không đưa credential vào log. |
