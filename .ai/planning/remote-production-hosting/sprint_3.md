# Sprint 3 — TLS, Reverse Proxy, EMQX MQTTS & Network Hardening

> **Status:** `[ ] Pending`  
> **Dependency:** Sprint 2 complete.  
> **Mục tiêu:** Public chỉ các entrypoint được mã hóa và đã kiểm soát.

## Track A — NPM, DNS and HTTPS

| ID | Công việc | Acceptance criteria |
|---|---|---|
| A1 | Thêm Nginx Proxy Manager (database/volume riêng) vào edge network; NPM admin UI không public — bind localhost/VPN/IP allowlist. | NPM admin không reachable từ Internet; credentials mạnh + MFA nếu hỗ trợ; backup config NPM. |
| A2 | Tạo proxy hosts `app.<domain>` → UI:3000 và `api.<domain>` → backend:3001; enable websocket/SSE buffering-off, correct forwarding headers, request size/timeouts phù hợp. | REST, EventSource giữ kết nối/reconnect ổn định; `X-Forwarded-Proto=https`; không mixed content. |
| A3 | Dùng **DNS-01 Cloudflare API Token scoped tối thiểu** để cấp wildcard `*.<domain>` (và apex nếu cần). Dùng certificate store/ACME client có ownership rõ; NPM có thể dùng DNS-01 cho Web/API nhưng **không bind-mount đường dẫn dữ liệu nội bộ của NPM** cho EMQX. Mount `fullchain.pem`/`privkey.pem` từ shared certificate store read-only vào EMQX và reload listener sau renewal. | `app`, `api`, `mqtt` đều có SAN/wildcard hợp lệ; renewal được chạy thử trước expiry, EMQX nhận cert mới sau reload không làm downtime không kiểm soát; Cloudflare API token không có quyền ngoài DNS edit zone cần thiết. |
| A4 | Cloudflare: Full (strict) mode, origin cert/LE strategy nhất quán, WAF/rate limiting cơ bản cho `api`; bypass/cache rule cho SSE/API. | Không dùng Flexible SSL; SSE không bị cache/buffer; origin IP exposure được đánh giá. |

## Track B — EMQX authentication, authorization and MQTTS

| ID | File chính | Công việc | Acceptance criteria |
|---|---|---|---|
| B1 | `emqx/emqx.conf`, Compose | Tạo EMQX TLS listener `0.0.0.0:8883` với `fullchain.pem`/private key mount read-only từ certificate store; disable host public mapping 1883; dashboard bind private. Quy trình DNS-01 renewal kiểm tra quyền file rồi reload EMQX listener có kiểm soát. | `openssl s_client -connect mqtt.<domain>:8883 -servername mqtt.<domain>` validate chain/SNI; port 1883/18083 inaccessible public; test renewal chứng minh EMQX phục vụ cert mới. |
| B2 | EMQX authn/authz config, `init-mqtt` hoặc backend internal auth endpoints | Authentication bắt buộc, anonymous explicitly off; triển khai nguồn identity theo ADR Sprint 0. Nếu dùng HTTP authn/authz: EMQX gọi **backend internal port 3001** qua private Docker network, request/response contract versioned, mTLS/shared internal secret nếu phù hợp, strict timeout và bounded cache/failure behavior. Nếu dùng built-in DB: bootstrap idempotent và không reset credentials vô ý mỗi deploy. | Unauthenticated connect bị reject; restart giữ auth state; backend/DB outage thực hiện theo failure policy mà không authorize sai hoặc gây broker reconnect storm; admin secret không xuất log. |
| B3 | `emqx/acl.conf`, backend/firmware topic contract | Rà soát và thêm tối thiểu topic hiện dùng (`telemetry`, `status`, `setpoint`, `manual/ack`, `profile`, OTA nếu có) theo device ID. Backend chỉ đúng publisher/subscriber privileges. | Test matrix user/topic/action: own allowed, cross-device denied, backend required allowed, everything else denied. |
| B4 | backend `mqtt.service.ts` | Backend dùng private `mqtt://mushroom-mqtt:1883` chỉ trong internal network **hoặc** MQTTS nội bộ nếu security policy yêu cầu; validate config no localhost fallback in production. | Backend reconnect pass; secret redaction pass; external plaintext unavailable. |

## Track C — Firewall and acceptance scan

| ID | Công việc | Acceptance criteria |
|---|---|---|
| C1 | Áp UFW/security group và Docker iptables policy theo Sprint 0; kiểm tra Docker published ports không bypass firewall policy. | External nmap result khớp bảng cổng README. |
| C2 | Test failure: certificate expired/invalid, EMQX restart, database unavailable, NPM restart, CORS origin sai. | Các lỗi báo rõ qua monitoring; device vẫn safe-offline, không switch relay nguy hiểm. |
