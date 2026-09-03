# SPRINT 3: LEGACY MQTT DEPRECATION, OPERATIONS & LONG-TERM AUTH

## 1. PHẠM VI & MỤC TIÊU
- **Mục tiêu sprint:** chuyển có kiểm soát khỏi shared `MQTT_ESP32_PASS`, chốt PIN recovery/MFA, và biến security model thành quy trình vận hành có thể kiểm chứng.
- **Module/Component bị tác động:** legacy token endpoints, device enrollment/provisioning, broker config/scripts, docs/changelog, security telemetry.
- **Phụ thuộc:** Sprint 1 token digest và secret rotation; Sprint 2 error/session contract; cần product/ops sign-off trước khi disable legacy.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU (DATA FLOW)
`Device enrollment credential -> authenticated admin/provisioning channel -> per-device raw token one-time -> digest DB + broker ACL`; device reconnect dùng credential riêng, revoke/regenerate ảnh hưởng một device.
`Legacy endpoint -> deprecation header + warning metric -> allow only during migration window -> feature flag off -> 410/typed error`; rollback chỉ mở lại khi risk acceptance được phê duyệt và shared secret đã rotate.
`Locked user -> documented recovery decision (admin/SMS/supervisor) -> one-time reset credential -> forced PIN change -> revoke sessions/devices -> audit event`.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ THEO TRACK
### Track A: Legacy endpoint migration
- **Task A1:**
  - **File tác động:** `mushroom-backend/src/auth/auth.controller.ts`, `mushroom-backend/src/auth/auth.service.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `issueToken()`, `issueDeviceToken()`, `LegacyTokenPolicy`
  - **Mô tả nghiệp vụ:** thêm `X-Deprecated: true`, metric/audit warning và allowlist migration; không tiếp tục trả shared secret cho caller không đủ authorization; định nghĩa ngày sunset và response sau sunset.
- **Task A2:**
  - **File tác động:** `scripts/enroll-device.sh`, `mushroom-backend/src/auth/admin-devices.controller.ts` (Sửa đổi)
  - **Hàm/Method/Struct:** `enrollDevice()`, `regenerateDeviceToken()`
  - **Mô tả nghiệp vụ:** chuẩn hóa bootstrap/re-enroll per-device, hiển thị raw token đúng một lần, retry không tạo duplicate hoặc làm mất token đang active ngoài chủ ý.
- **Task A3:**
  - **File tác động:** `emqx/acl.conf`, `emqx/init-users.sh`, `docs/contract/mqtt-topics-v2.2.md` (Sửa đổi)
  - **Hàm/Method/Struct:** ACL resource rules, `provisionMqttUser()`, device topic contract
  - **Mô tả nghiệp vụ:** map token/device identity vào allow-list topic, cấm wildcard injection, staged rollout và broker reload/rollback procedure.

### Track B: Operations and threat monitoring
- **Task B1:**
  - **File tác động:** `docs/security/auth-security-model.md` (Tạo mới)
  - **Hàm/Method/Struct:** security model sections `BFFBoundary`, `TrustProxy`, `CredentialLifecycle`
  - **Mô tả nghiệp vụ:** ghi rõ backend port 6002 không public, trusted proxy assumptions, cookie/CSRF boundary, session/revoke semantics, token exposure response và data classification.
- **Task B2:**
  - **File tác động:** `CHANGELOG.md`, `mushroom-backend/README.md` (Sửa đổi)
  - **Hàm/Method/Struct:** release/migration checklist `AuthFeatureFixV1`
  - **Mô tả nghiệp vụ:** công bố deprecation timeline, device re-enrollment window, compatibility matrix, rollback owner và acceptance evidence.
- **Task B3:**
  - **File tác động:** `mushroom-backend/src/auth/auth.service.ts`, observability/runbook docs (Sửa đổi/Tạo mới)
  - **Hàm/Method/Struct:** `bootstrapAdmin()`, `recordSecurityEvent()`, `AuthSecurityMetrics`
  - **Mô tả nghiệp vụ:** bootstrap production phải có hard gate/health warning khi credentials chưa rotate; metric cho legacy calls, lockout, revoke, token regeneration và alert thresholds; không log secret/PIN.

### Track C: Product security decisions
- **Task C1:**
  - **File tác động:** `.ai/planning/auth-feature-fix-v1/README.md` hoặc decision record thuộc planning workspace (Sửa đổi)
  - **Hàm/Method/Struct:** decision record `PinRecoveryPolicy`
  - **Mô tả nghiệp vụ:** chọn A/B/C sau threat model, xác định identity proof, TTL, one-time use, audit and abuse limits; không triển khai SMS/supervisor flow khi chưa có owner/provider/security review.
- **Task C2:**
  - **File tác động:** planning decision record (Sửa đổi)
  - **Hàm/Method/Struct:** decision record `AdminMfaPolicy`
  - **Mô tả nghiệp vụ:** đánh giá TOTP/WebAuthn, enrollment/recovery, kiosk compatibility và break-glass access; đặt điều kiện trước production thay vì thêm MFA thiếu recovery.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG (HARD REVIEW CRITERIA)
1. **Security:** không còn endpoint public trả shared secret sau sunset; mọi device có credential độc lập, revoke được; recovery không trở thành account takeover.
2. **Performance / Resource:** broker reload không làm mất toàn bộ kết nối; migration/re-enrollment có bounded batch và observable progress.
3. **Boundary / Error:** feature flag, sunset response, rollback và operator ownership được kiểm thử; health check cảnh báo bootstrap secret chưa rotate; runbook có bằng chứng diễn tập.
