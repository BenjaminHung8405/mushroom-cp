# TỔNG QUAN KIẾN TRÚC & QUY CHUẨN KỸ THUẬT
**Plan:** auth-feature-fix-v1  
**Ngày tạo:** 2026-09-03  
**Mục tiêu cốt lõi:** Đưa lớp xác thực của Mushroom Control Plane về trạng thái production-ready cho môi trường IoT: không để lộ credential MQTT dùng chung, chống brute-force đổi PIN, và giữ rate-limit IP chính xác sau reverse proxy. Đồng thời hoàn thiện quản trị session, error contract, RBAC audit và lộ trình loại bỏ legacy token mà không phá vỡ các cơ chế tốt hiện có.

## 1. Techstack & Dependencies
- **Ngôn ngữ & Runtime:** TypeScript 5.7, Node.js; backend package `mushroom-backend`.
- **Frameworks & Core Libs:** NestJS 11, Express adapter, TypeORM 1.0, Jest 30/Supertest; UI dùng Next.js 16, React 19, TypeScript 5.7, Vitest 4.
- **Database & Storage:** PostgreSQL qua `pg` và TypeORM; Redis 6 client cho rate-limit/session revoke pub-sub; MQTT 5 client và EMQX ACL cho device connectivity.
- **Security & Auth:** Argon2id PIN (`m=65536,t=3,p=1`), SHA-256 token digest, HttpOnly/Secure/SameSite cookie, Origin/Referer CSRF tại BFF, system JWT và RBAC/ownership guards.
- **Đã xác nhận cần giữ:** constant-time dummy hash, dual lockout, absolute/idle session expiry, revoke cross-process, whitelist validation, deny wildcard MQTT.
- **Khuyến nghị/cần quyết định:** chiến lược migrate token plaintext hiện hữu, số hop `trust proxy`, thời điểm đóng endpoint shared token, và lựa chọn PIN recovery/MFA.

## 2. Architectural Patterns & Directory Layout
- **Pattern áp dụng:** defense-in-depth; controller mỏng, service làm policy/use-case; token raw chỉ xuất hiện tại provisioning, persistence chỉ giữ digest; migration backward-compatible; BFF là public boundary.
- **Cấu trúc thư mục mục tiêu:**
  ```text
  mushroom-backend/src/auth/
    auth.service.ts, auth.controller.ts, auth.types.ts
    session-auth.guard.ts, auth-policy.guard.ts
    entities/auth-session.entity.ts
    dto/set-pin.dto.ts, dto/session.dto.ts
    migrations/<timestamp>-HashMqttDeviceTokens.ts
  mushroom-backend/src/mqtt-auth/mqtt-auth.service.ts
  mushroom-backend/src/security/system-jwt.guard.ts
  mushroom-backend/src/main.ts
  mushroom-backend/src/common/filters/http-exception.filter.ts
  mushroom-backend/src/auth/audit.controller.ts
  mushroom-ui/app/api/backend/[...path]/route.ts
  docs/security/auth-security-model.md
  ```
- **Boundary:** browser chỉ gọi BFF; backend port 6002 không public và chỉ nhận traffic từ mạng/service được phép. MQTT broker xác thực bằng digest lookup/constant-time comparison.

## 3. Global Coding Conventions & Rules
- **Naming Conventions:** giữ PascalCase cho class, camelCase cho method/field, UPPER_SNAKE_CASE cho security constants/error codes; tên migration phải có timestamp và mô tả rõ.
- **Error Handling Strategy:** mọi lỗi auth trả contract `{ statusCode, code, message }`; không phân biệt user không tồn tại/PIN sai; không trả stack trace, raw token, PIN, secret hoặc SQL detail. Các thao tác revoke/migration phải idempotent và log structured event không chứa credential.
- **Security Baseline:** không lưu plaintext secret; hash token trước persistence; fail closed cho auth guard; shadow/system path phải xác thực cryptographic token và trust boundary; rate-limit theo user/device/IP đã canonicalize; admin reset phải revoke session/device credentials.
- **Performance Constraints:** Argon2 chỉ chạy ở credential operation; lookup token có index; Redis key TTL bounded; session listing phân trang; migration hỗ trợ rollout/rollback và không khóa bảng lâu ngoài cửa sổ deploy.
- **Definition of done:** unit + integration/e2e tests cho allow/deny paths, migration rehearsal trên bản sao dữ liệu, secret scan, typecheck/lint changed files, observability dashboard/alert và runbook rollback.
