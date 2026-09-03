# SPRINT 1: P0 PRODUCTION SECURITY FIXES

## 1. PHẠM VI & MỤC TIÊU
- **Mục tiêu sprint:** đóng ba P0 (MQTT token plaintext, brute-force `setPin`, IP rate-limit sai sau proxy), chuẩn hóa error code và làm rõ revoke khi admin reset PIN.
- **Module/Component bị tác động:** auth service/controller/guards, MQTT auth, TypeORM schema migration, Nest bootstrap, BFF error contract và secret operations.
- **Phụ thuộc:** xác nhận topology proxy và backup database trước migration; không thay đổi các cơ chế Argon2id/session/cookie đang đúng.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU (DATA FLOW)
`Admin/device provisioning -> random raw token -> SHA-256 digest -> PostgreSQL devices.token`; `MQTT broker -> MqttAuthService.authenticate(...) -> digest lookup + active/device check -> allow/deny`.
`Authenticated user -> AuthController.setPin -> AuthService.setPin -> failed-attempt Redis/DB policy -> lockout/audit/error code`; thành công -> hash PIN + revoke sessions/devices.
`Client -> BFF/proxy -> trusted reverse proxy -> Nest request.ip -> Redis per-IP bucket`; request direct không qua boundary bị chặn/documented.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ THEO TRACK
### Track A: Credential persistence
- **Task A1:**
  - **File tác động:** `mushroom-backend/src/auth/admin-devices.controller.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `createDevice()`, `regenerateDeviceToken()`
  - **Mô tả nghiệp vụ:** sinh raw token một lần, chỉ trả về trong response provisioning; lưu `hashToken(rawToken)` và không log raw value.
- **Task A2:**
  - **File tác động:** `mushroom-backend/src/mqtt-auth/mqtt-auth.service.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `authenticate()`, `hashDeviceToken()`
  - **Mô tả nghiệp vụ:** hash credential nhận từ broker rồi compare với digest; từ chối token cũ/plaintext theo chính sách rollout; giữ deny wildcard và inactive-device checks.
- **Task A3:**
  - **File tác động:** `mushroom-backend/src/database/migrations/<timestamp>-HashMqttDeviceTokens.ts` (Tạo mới)
  - **Hàm/Method/Struct:** `up(queryRunner)`, `down(queryRunner)`, schema `devices.token`
  - **Mô tả nghiệp vụ:** migrate dữ liệu legacy theo inventory; nếu không thể hash one-way mà vẫn xác minh được token thì bắt buộc regenerate/re-enroll, không giả vờ chuyển đổi; ghi migration marker và rollback an toàn.

### Track B: PIN abuse controls
- **Task B1:**
  - **File tác động:** `mushroom-backend/src/auth/auth.service.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `setPin()`, `verifyPin()`, `throttleDelay()`, `recordSecurityEvent()`
  - **Mô tả nghiệp vụ:** failed current PIN phải tăng counter/lockout theo policy, áp dụng delay và audit event; success reset counter phù hợp, hash new PIN và revoke như flow hiện hữu; tránh race bằng transaction/atomic update.
- **Task B2:**
  - **File tác động:** `mushroom-backend/src/auth/auth.service.spec.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** test suite `setPin`, `verifyPin`
  - **Mô tả nghiệp vụ:** kiểm thử wrong PIN lặp lại, lockout boundary, concurrent attempts, audit failure, success reset và không leak PIN.

### Track C: Runtime contract & operations
- **Task C1:**
  - **File tác động:** `mushroom-backend/src/main.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `bootstrap()`, Express `trust proxy`
  - **Mô tả nghiệp vụ:** cấu hình số hop/proxy CIDR theo deployment, không tin tùy ý `X-Forwarded-For`; test client IP qua proxy và direct spoof.
- **Task C2:**
  - **File tác động:** `mushroom-backend/src/common/filters/http-exception.filter.ts` (Tạo mới)
  - **Hàm/Method/Struct:** `HttpExceptionFilter.catch()`, `AuthErrorCode`
  - **Mô tả nghiệp vụ:** chuẩn hóa `{statusCode,code,message}` với mapping `PIN_CHANGE_REQUIRED`, `SESSION_REQUIRED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`; giữ status/header tương thích.
- **Task C3:**
  - **File tác động:** `mushroom-backend/src/auth/admin.controller.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `updateUser()`, `pinReset`, `accessChanged`
  - **Mô tả nghiệp vụ:** tách flags rõ ràng, transaction hóa save + revoke, xác nhận failure không để user ở trạng thái nửa reset.
- **Task C4:**
  - **File tác động:** `.env.example`, `scripts/verify-backend-auth-config.mjs`, Git/secret-management runbook (Sửa đổi/Tạo mới theo repo convention)
  - **Hàm/Method/Struct:** `verifyAuthConfig()`, secret rotation procedure
  - **Mô tả nghiệp vụ:** rotate `WIFI_PASSWORD`/shared MQTT secret nếu exposure confirmed, audit git history, cập nhật device enrollment; không commit secret mới.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG (HARD REVIEW CRITERIA)
1. **Security:** DB dump không đủ để dùng MQTT credential; failed `setPin` bị giới hạn; direct forged forwarded headers không bypass rate-limit/auth.
2. **Performance / Resource:** digest lookup có index; atomic counters không tạo lost update; Argon2 không chạy ngoài credential path.
3. **Boundary / Error:** migration chạy idempotent trên legacy/missing token; mọi deny path có error code ổn định; rollback không khôi phục plaintext.
