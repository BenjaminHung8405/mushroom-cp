# SPRINT 2: SESSION UX, POLICY HARDENING & RBAC CONTRACT

## 1. PHẠM VI & MỤC TIÊU
- **Mục tiêu sprint:** cho user xem/revoke session, phân biệt kiosk/full lifetime, trả lỗi bắt buộc đổi PIN có thể xử lý ở UI, và cho AUDITOR đọc audit log mà vẫn read-only.
- **Module/Component bị tác động:** auth entity/service/controller/DTO/guard, audit controller, UI BFF/client contracts.
- **Phụ thuộc:** Sprint 1 error contract; quyết định product về kiosk session và giới hạn dữ liệu IP/UA cần hiển thị.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU (DATA FLOW)
`Browser cookie -> SessionAuthGuard -> AuthService.authenticate -> auth_sessions`; `GET /auth/sessions` trả metadata đã sanitize; `DELETE /auth/sessions/:id` chỉ revoke session cùng user; `DELETE /auth/sessions` revoke mọi session khác và publish Redis event.
`Login DTO sessionType -> AuthService.issueSession -> AuthSession.expiresAt/idleExpiresAt`; kiosk mặc định 8h, full 30 ngày (configurable, bounded).
`AUDITOR/ADMIN -> RBAC guard -> AuditController -> audit repository`; mutation methods bị từ chối bởi policy.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ THEO TRACK
### Track A: Session model and service
- **Task A1:**
  - **File tác động:** `mushroom-backend/src/auth/entities/auth-session.entity.ts`, `mushroom-backend/src/auth/auth.types.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `AuthSession`, `SessionType`, `SessionMetadata`
  - **Mô tả nghiệp vụ:** thêm enum/field `kiosk|full`, index cần thiết và backward-compatible default; tuyệt đối không expose `tokenHash`.
- **Task A2:**
  - **File tác động:** `mushroom-backend/src/auth/auth.service.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `issueSession()`, `listUserSessions()`, `revokeSession()`, `revokeOtherSessions()`
  - **Mô tả nghiệp vụ:** filter active/expired/revoked, paginate, đánh dấu current session, revoke ownership check, publish cross-process event và idempotent DELETE.
- **Task A3:**
  - **File tác động:** `mushroom-backend/src/auth/dto/session.dto.ts`, `mushroom-backend/src/auth/auth.controller.ts` (Tạo mới/Sửa đổi)
  - **Hàm/Method/Struct:** `ListSessionsQuery`, `listSessions()`, `revokeSession()`, `revokeOtherSessions()`
  - **Mô tả nghiệp vụ:** thêm GET/DELETE contracts; validate UUID/query bounds; response chỉ gồm id, device label/type, IP, sanitized UA, createdAt, lastSeenAt, expiry và current.

### Track B: Guard and policy
- **Task B1:**
  - **File tác động:** `mushroom-backend/src/auth/session-auth.guard.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `canActivate()`, `assertPinChangeAllowed()`
  - **Mô tả nghiệp vụ:** tách shadow path khỏi catch; fail closed nếu session invalid; chỉ cho system principal đã được `SystemJwtGuard` xác thực qua trust boundary; trả `PIN_CHANGE_REQUIRED` cho mustSetPin.
- **Task B2:**
  - **File tác động:** `mushroom-backend/src/auth/auth-policy.guard.ts` (Sửa đổi/documentation)
  - **Hàm/Method/Struct:** `canActivate()`, `isAdminRoute()`
  - **Mô tả nghiệp vụ:** giữ skip admin nếu RBAC bắt buộc, thêm test/explicit invariant để route admin thiếu `@RequireRoles` không âm thầm mở; cân nhắc fail-closed metadata validation.
- **Task B3:**
  - **File tác động:** `mushroom-backend/src/auth/audit.controller.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** controller metadata `@RequireRoles`, `listAuditLogs()`
  - **Mô tả nghiệp vụ:** cho `ADMIN` và `AUDITOR` đọc; bảo đảm create/delete/export nhạy cảm vẫn đúng role/policy và AUDITOR không mutate.

### Track C: Verification and UI contract
- **Task C1:**
  - **File tác động:** `mushroom-backend/src/auth/session-auth.guard.spec.ts`, `mushroom-backend/src/auth/auth.controller.spec.ts`, `mushroom-backend/src/auth/rbac-phase1.spec.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** suites `shadow`, session ownership, `PIN_CHANGE_REQUIRED`, AUDITOR
  - **Mô tả nghiệp vụ:** cover invalid cookie + valid/invalid system JWT, no header, cross-user revoke, pagination and read-only RBAC.
- **Task C2:**
  - **File tác động:** `mushroom-ui/app/api/backend/[...path]/route.ts`, UI auth API/types (Sửa đổi)
  - **Hàm/Method/Struct:** `validateMutationOrigin()`, `parseAuthError()`, `SessionSummary`
  - **Mô tả nghiệp vụ:** giữ CSRF BFF, map error code để redirect/hiển thị flow đổi PIN; không gọi backend port trực tiếp.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG (HARD REVIEW CRITERIA)
1. **Security:** không có session IDOR; raw token/hash không xuất hiện response; shadow mode không biến thành authentication bypass; AUDITOR không mutate.
2. **Performance / Resource:** list có pagination/order/index; revoke-all dùng batch phù hợp và Redis event không chặn request vô hạn.
3. **Boundary / Error:** session hết hạn/idle/revoked đều nhất quán; DELETE lặp lại an toàn; UI phân biệt 401, `PIN_CHANGE_REQUIRED` và authorization denied.
