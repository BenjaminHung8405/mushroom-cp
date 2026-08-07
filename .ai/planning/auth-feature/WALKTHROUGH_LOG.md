# Auth Feature — Walkthrough Log

> Quy ước: mục mới nhất nằm ở đầu tài liệu. Log này ghi nhận Plan Auth Feature, các thay đổi đã có trong working tree, xác minh runtime local Docker, và trạng thái acceptance hiện tại. Không ghi secrets, token, hoặc password vào tài liệu.

---

## 2026-08-06 — Trạng thái hiện tại: implementation/schema/unit validation hoàn tất; full HTTP auth acceptance còn mở

### Kết luận trạng thái

- **Hoàn tất** phần implementation Auth, schema migration, typecheck, auth/security unit test, rebuild Docker runtime, migration runtime và smoke health.
- **Chưa thể đánh dấu Done 100% cho Auth plan** vì chưa chạy/ghi nhận đầy đủ HTTP acceptance flow end-to-end cho bootstrap admin, login/session, logout/revoke, đổi mật khẩu, RBAC admin, house access và login rate limit.
- PostgreSQL local đã được thay mới theo lựa chọn “dữ liệu local không cần giữ”; dữ liệu PostgreSQL hỏng được giữ dưới thư mục backup có timestamp và **không bị xóa**.

### Runtime local sau recovery

- PostgreSQL Docker: healthy.
- Redis Docker: healthy, `PONG`, DB trống khi kiểm tra.
- MQTT Docker: healthy.
- InfluxDB Docker: healthy.
- Backend Docker: healthy; health endpoint nội bộ trả HTTP 200 với trạng thái `ok`.
- UI Docker: running.
- Backend image/runtime đã được rebuild để có dependencies mới `argon2` và `redis`.

### Xác minh đã pass

```text
pnpm typecheck
PASS
```

```text
Auth/Security unit suites
- src/auth/auth.service.spec.ts
- src/auth/auth-policy.guard.spec.ts
- src/security/system-jwt.guard.spec.ts
PASS: 3 suites, 13 tests
```

```text
Database migration runtime
PASS: 18 migrations executed
```

```text
Tuning migration integration
PASS: 1 suite, 5 tests
```

### Những hạng mục Auth runtime còn phải làm

1. Kiểm tra bootstrap admin trong cấu hình `AUTH_ENFORCEMENT_MODE=enforced` và biến bootstrap phù hợp môi trường test.
2. `POST /auth/login`: cookie session HttpOnly, response user, cache-control, lỗi thông tin đăng nhập.
3. `GET /auth/me`: xác thực session và nội dung principal.
4. `POST /auth/logout`: revoke session và cookie clear.
5. `POST /auth/change-password`: current password, password policy, `mustChangePassword` được clear, sessions cần bị revoke theo hành vi thiết kế.
6. Admin RBAC:
   - tạo user;
   - cập nhật role/active;
   - reset password;
   - thay thế house access;
   - đọc audit log;
   - từ chối `OPERATOR`/`AUDITOR` khi truy cập endpoint admin.
7. Authorization theo house trên các resource endpoints đã được guard/policy áp dụng.
8. Login rate limit qua Redis và auth security event/audit side effects.
9. Xác minh BFF Next.js giữ/copy đúng Set-Cookie và request cookies cho `/api/backend/[...path]`.

### Lưu ý test isolation

- `src/tuning/services/tuning-durability.integration.spec.ts` là test destructive đối với schema: test gọi `DROP SCHEMA public`.
- Không chạy test này với `TUNING_MIGRATION_DATABASE_URL` trỏ vào database chính `mushroom_iot_db`.
- Một lần chạy trước đó đã trỏ nhầm vào database chính, làm mất schema runtime; database chính sau đó đã được khôi phục hoàn toàn bằng cách reset schema (local data disposable), nạp `database/schema.sql`, và chạy lại 18 migrations.
- Durability gate hiện **chưa pass**: MQTT client nhận `ECONNRESET`/reconnect loop, dẫn đến các timeout L1–L3. Đây không phải kết quả auth acceptance và cần database test riêng + broker ổn định nếu tiếp tục xử lý.

---

## 2026-08-06 — PostgreSQL local recovery và runtime migration

### Bối cảnh

- Stack `mushroom-cp` ban đầu có PostgreSQL crash-loop với lỗi checkpoint/WAL:

```text
invalid primary checkpoint record
PANIC: could not locate a valid checkpoint record
```

- Vì user chọn hướng A (không cần giữ dữ liệu local), tiến hành recreate local database, đồng thời giữ copy dữ liệu hỏng để tránh mất dữ liệu ngoài ý muốn.

### Thao tác đã thực hiện

1. Dừng `mushroom-db`.
2. Đổi tên `data/mushroom_postgres_data` thành backup timestamped:
   ```text
   data/mushroom_postgres_data.corrupt-20260806-174257
   ```
3. Tạo thư mục data mới cho PostgreSQL.
4. Start lại `mushroom-db` và chờ healthcheck healthy.
5. Rebuild/recreate backend và UI để refresh Docker node_modules/runtime.
6. Chạy migration qua Docker backend:
   ```text
   pnpm migration:run
   ```
7. Sau sự cố test isolation, reset `public` schema trên DB local disposable, nạp baseline từ `database/schema.sql`, rồi chạy lại migration thành công.
8. Restart backend và xác minh Docker healthcheck/`/health` pass.

### Kết quả schema Auth

Migration `1720656000017-create-auth.ts` đã chạy thành công và tạo:

- `users`
- `user_house_access`
- `auth_sessions`
- `auth_security_events`

Migration này sử dụng `pgcrypto`, UUID mặc định, user role check constraint, session token hash, active-session indexes và security-event indexes.

---

## 2026-08-06 — Docker staging cleanup và xác minh local stack ban đầu

### Cleanup staging

- Đã xóa riêng Docker Compose project `mushroom-staging` theo yêu cầu:
  - containers;
  - network;
  - volumes thuộc project staging;
  - thư mục staging tạm.
- Không xóa Docker volumes/data của project local `mushroom-cp` trong bước cleanup này.

### Phát hiện local runtime ban đầu

- `mushroom_db`: crash-loop do WAL/checkpoint hỏng.
- `mushroom_redis`: chưa được tạo mặc dù compose hiện khai báo service Redis.
- `mushroom_backend`: container running nhưng source mới ban đầu thiếu `argon2`/`redis` trong Docker node_modules cũ; sau đó đã rebuild thành công.
- `mushroom_mqtt`: ban đầu unhealthy; sau recreate đã healthy.

---

## Auth Feature — Thay đổi implementation có trong working tree

> Danh sách dưới đây ghi nhận phần Auth Feature quan sát được trong working tree. Không tự khẳng định đây là toàn bộ lịch sử commit; đây là các file/chức năng hiện diện tại thời điểm tạo walkthrough log.

### Auth module, domain và persistence

- `mushroom-backend/src/auth/auth.module.ts`
  - Đăng ký entity/repository và provider liên quan Auth.
- `mushroom-backend/src/auth/auth.service.ts`
  - Login/session lifecycle.
  - Hash mật khẩu qua Argon2.
  - Redis-backed login rate limiting và cơ chế session revoke publish/subscribe.
  - Security events/audit recording.
  - Bootstrap admin logic theo config.
- `mushroom-backend/src/auth/auth.types.ts`
  - `AuthPrincipal`, session cookie name, session TTL/idle/touch constants.
- `mushroom-backend/src/auth/entities/user.entity.ts`
  - User identity/email/password hash/role/active/must-change-password.
- `mushroom-backend/src/auth/entities/user-house-access.entity.ts`
  - Mapping user với house.
- `mushroom-backend/src/auth/entities/auth-session.entity.ts`
  - Persisted session token hash, expiry, idle expiry, last seen/revocation.
- `mushroom-backend/src/auth/entities/auth-security-event.entity.ts`
  - Security event persistence.
- `mushroom-backend/src/database/migrations/1720656000017-create-auth.ts`
  - Tạo toàn bộ Auth tables/indexes.

### Guards, decorators và policy

- `mushroom-backend/src/auth/session-auth.guard.ts`
  - Session authentication guard.
- `mushroom-backend/src/auth/auth-policy.guard.ts`
  - Policy enforcement / request authorization.
- `mushroom-backend/src/auth/auth.decorators.ts`
  - Current user và role-related decorators.
- `mushroom-backend/src/security/security.module.ts`
  - Tích hợp security/auth guard/module.
- `mushroom-backend/src/security/system-jwt.guard.ts`
  - Điều chỉnh coexistence với auth/session policy.
- `mushroom-backend/src/security/system-audit.logger.ts`
  - System audit integration.

### Auth API

- `mushroom-backend/src/auth/auth.controller.ts`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me`
  - `POST /auth/change-password`
  - Giữ legacy device bootstrap/token endpoints public, tách biệt operator auth.
- `mushroom-backend/src/auth/admin.controller.ts`
  - Admin users CRUD-style operations, reset password, replace house access.
- `mushroom-backend/src/auth/audit.controller.ts`
  - Admin audit log listing.
- DTOs mới:
  - `login.dto.ts`
  - `change-password.dto.ts`
  - `create-user.dto.ts`
  - `update-user.dto.ts`
  - `house-access.dto.ts`

### Authorization integration vào resource endpoints

Các file được thay đổi để áp dụng/lồng ghép Auth policy, resource access hoặc audit behavior:

- `src/batch/controllers/batch.controller.ts`
- `src/batch/services/batch.service.ts`
- `src/device/device.controller.ts`
- `src/telemetry/controllers/telemetry.controller.ts`
- `src/tuning/controllers/tuning-command.controller.ts`
- `src/tuning/guards/tuning-sse-ticket.guard.ts`

### BFF/UI và config/runtime

- `mushroom-ui/app/api/backend/[...path]/route.ts`
  - Điều chỉnh backend proxy/BFF liên quan cookie/session forwarding.
- `docker-compose.yml`
  - Bổ sung Redis service/config.
  - Bổ sung Auth enforcement/bootstrap environment variables.
  - Backend dependency/health ordering liên quan Redis.
- `.env.example`
  - Auth config examples.
- `mushroom-backend/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  - Bổ sung dependencies/metadata workspace cho Auth dependencies, bao gồm Argon2 và Redis.

### Test files Auth

- `src/auth/auth.service.spec.ts`
- `src/auth/auth-policy.guard.spec.ts`
- cập nhật `src/security/system-jwt.guard.spec.ts`

---

## Auth Feature — Security and behavior design recorded from implementation

### Session behavior

- Session identifier được lưu trong HttpOnly cookie.
- Cookie uses `sameSite=lax`, path `/`, max age theo session constant.
- `secure` được bật khi `NODE_ENV=production`.
- Session token persistence sử dụng hash thay vì token plaintext.
- Session records có absolute expiry, idle expiry, last-seen và revocation timestamp.

### Password behavior

- Password hash dùng Argon2.
- Login DTO yêu cầu email hợp lệ và password tối thiểu 8 ký tự.
- Create user và change password yêu cầu password tối thiểu 16 ký tự.
- User mới và user được admin reset password được gắn `mustChangePassword=true`.

### RBAC and house scope

- Roles được giới hạn: `ADMIN`, `OPERATOR`, `AUDITOR`.
- Admin controller yêu cầu role `ADMIN`.
- House access được persist qua `user_house_access` và thay thế atomically cho user khi admin cập nhật scope.
- Thay đổi role/active/house scope có hành vi revoke active sessions theo service behavior.

### Rate limiting and audit

- Login endpoint có throttle controller-level.
- Auth service dùng Redis cho rate limiting/login controls và session revoke propagation.
- Auth security event records được lưu cho các action/attempt đáng chú ý.
- System audit records được dùng cho system-level auditing.

---

## Ghi chú về source và encoding

- Các file source đã kiểm tra metadata là UTF-8/ASCII-compatible khi liên quan trực tiếp đến test/migration.
- Trong quá trình runtime recovery và logging, không sửa source implementation Auth.
- Không tự động format hay rewrite file source.
- `git diff --check` đã được chạy và không báo whitespace error ở lần xác minh cuối.

---

## Lệnh gợi ý để tiếp tục Auth HTTP acceptance (dùng database local mới)

> Không ghi password/token thật vào command history/log. Dùng biến môi trường hoặc file test tạm bị gitignore.

```bash
# Kiểm tra runtime containers
cd /Users/benjaminhung8405/Code/mushroom-cp
docker compose ps

# Backend health nội bộ, vì port backend hiện không publish ra host trong compose hiện tại
docker exec mushroom_backend node -e '
require("http").get("http://127.0.0.1:3001/health", (r) => {
  let body = "";
  r.on("data", (chunk) => body += chunk);
  r.on("end", () => console.log(r.statusCode, body));
});
'

# Auth unit tests
cd mushroom-backend
pnpm test -- --runInBand \
  src/auth/auth.service.spec.ts \
  src/auth/auth-policy.guard.spec.ts \
  src/security/system-jwt.guard.spec.ts
```

Để chạy HTTP acceptance cần một cấu hình local test-only rõ ràng cho:

- `AUTH_ENFORCEMENT_MODE=enforced`;
- bootstrap admin email/password test-only;
- cách truy cập backend từ host hoặc một test runner container trong Docker network;
- cleanup user/session/audit test data sau test.
