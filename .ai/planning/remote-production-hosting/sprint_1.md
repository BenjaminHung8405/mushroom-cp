# Sprint 1 — Application Security & Production Configuration

> **Status:** `[ ] Pending`  
> **Dependency:** Sprint 0 hoàn thành.  
> **Mục tiêu:** Loại bỏ các blocker ứng dụng trước khi internet có thể gọi API hoặc điều khiển relay.

## Track A — Configuration contract và CORS

| ID | File chính | Công việc | Acceptance criteria |
|---|---|---|---|
| A1 | `.env.example`, `mushroom-ui/.env.example`, compose | Tách biến local/production và lập config contract: `APP_URL`, `API_URL`, `ALLOWED_ORIGINS`, `DATABASE_URL`, `MQTT_*`, `EMQX_*`, TLS paths, secret keys. Xóa fallback secret trong compose production. | `docker compose config` fail nếu thiếu secret required; browser config chỉ chứa `NEXT_PUBLIC_API_URL`/device selector, không secret. |
| A2 | `mushroom-backend/src/main.ts` | Chuẩn hóa allowlist: split/trim/filter origin; production fail-fast nếu missing/malformed; enable only methods/headers thật cần; kiểm thử SSE. | Chỉ `https://app.<domain>` được CORS; origin lạ bị chặn; OPTIONS, REST và EventSource hoạt động. |
| A3 | UI API clients | Loại bỏ fallback production `localhost`; dùng endpoint build-time tuyệt đối hoặc rewrite same-origin; hiển thị lỗi có thể chẩn đoán khi config thiếu. | Production bundle không chứa `localhost`, LAN IP hoặc simulated endpoint. |
| A4 | `next.config.mjs` | Gỡ cấu hình dev-only khỏi production path và không bỏ qua lỗi TypeScript trong production build (`ignoreBuildErrors: false` hoặc bỏ option). | `pnpm build` UI pass với strict type errors được xử lý. |

## Track B — Xác thực và phân quyền Web/API (P0 blocker)

| ID | File/module dự kiến | Công việc | Acceptance criteria |
|---|---|---|---|
| B1 | `mushroom-backend/src/auth/*` | Tách device provisioning auth khỏi operator auth. Thiết kế user login/session/JWT ngắn hạn hoặc external IdP; password hash, key rotation, expiry và logout/revocation policy. | Không còn token placeholder ở UI; secret ký JWT không phải `NEXT_PUBLIC_*`; unit/e2e test login fail/success. |
| B2 | controller/guard mới | Bảo vệ mọi endpoint mutate: batch create/end/checkpoints, actuator override, OTA command, device enrollment/admin. Áp role `viewer`, `operator`, `admin`. | Anonymous request trả 401; viewer không gửi relay; operator/admin có scope đúng. |
| B3 | audit module/schema | Audit immutable: user/device, action, resource, request ID, result, timestamp, IP/user agent (cân nhắc privacy), không log secret/payload PSK. | Mỗi actuator/OTA/batch mutation tạo audit record; audit query chỉ admin. |
| B4 | rate-limit/security middleware | Rate limit login, provisioning/token, command endpoints; body size limit, Helmet/security headers, structured request/error logs với redaction. | Test burst bị 429; oversized payload bị từ chối; log không lộ Authorization/password/PSK. |

## Track C — Device provisioning and OTA trust (P0 blocker)

| ID | File chính | Công việc | Acceptance criteria |
|---|---|---|---|
| C1 | `auth.controller.ts`, `auth.service.ts`, ADR Sprint 0 | Không trả `MQTT_ESP32_PASS` chung qua `/auth/token`. Chỉ enrollment có xác minh ban đầu mới cấp/rotate credential per-device. Nếu ADR chọn **EMQX HTTP authn/authz**, tạo endpoint nội bộ (đúng contract EMQX, ví dụ `/internal/emqx/authn` và `/internal/emqx/authz`, không public `/api/v1` giả định) validate `clientid`/username/password và topic/action từ database; giới hạn chỉ EMQX network gọi được. | Device ID không tồn tại/không chứng minh identity không thể lấy credential; secret/token không ghi log; endpoint HTTP auth không truy cập từ Internet; timeout/cache/failure policy được test khi backend/DB unavailable. |
| C2 | firmware config/wifi/mqtt | Thay IP mặc định `192.168.1.136` và HTTP bằng domain production; migration NVS qua captive portal, không hardcode production secret vào firmware. Chuẩn bị trust anchor CA root/intermediate có vòng đời dài; cấm nhúng/pin leaf certificate Let’s Encrypt 90 ngày. | Firmware mới/factory reset được provision URL domain; TLS chain hợp lệ bằng CA root; config cũ có kế hoạch migration và fallback safe-offline. |
| C3 | OTA manager + backend release service | Dùng HTTPS CA validation (pin root/intermediate/public key phù hợp) thay `setInsecure()`; artifact versioned, SHA-256 và chữ ký Ed25519/ECDSA; allow OTA command chỉ admin/backend. | URL/cert/hash/signature sai không ghi flash; release metadata signed; canary test và rollback partition được xác nhận. |

## Test gates

```bash
cd mushroom-backend && pnpm test && pnpm build
cd ../mushroom-ui && pnpm build
cd ../mushroom-iot-firmware && pio test -e native
```

Bất kỳ test nào fail hoặc actuator endpoint còn anonymous thì **không chuyển Sprint 2 production**.
