# Tiến Độ — Production Remote Hosting

## Khởi tạo

- **Thời gian khởi tạo:** 2026-07-14 (Asia/Ho_Chi_Minh)
- **Trạng thái:** Kế hoạch được lập từ rà soát source hiện tại; chưa có hạ tầng production nào được triển khai bởi kế hoạch này.
- **Phạm vi tham chiếu:** `docker-compose.yml`, `.env.example`, `emqx/*`, `scripts/enroll-device.sh`, NestJS, Next.js và firmware ESP32.

## Điều kiện chặn Go-Live (P0)

- [ ] API Web/operator có authentication, authorization, audit log; relay/OTA endpoints không anonymous.
- [ ] `/auth/token` không cấp static shared MQTT password cho caller không xác thực; credential per-device. ADR chọn EMQX built-in DB hoặc HTTP authn/authz backend internal đã được triển khai và test failure policy.
- [ ] MQTT MQTTS/8883 có TLS CA validation; wildcard/DNS-01 renewal được kiểm thử; ESP32 trust Root/Intermediate CA thay vì leaf cert; anonymous/plaintext public bị tắt.
- [ ] Firmware không dùng `setInsecure()` cho OTA production; OTA signed + verify + rollback.
- [ ] Không public 3001/3002/5432/18083/1883; dashboard quản trị ở VPN/IP allowlist.
- [ ] Backup off-host và restore drill pass.

## Tiến độ theo Sprint

| Sprint | Tài liệu | Status | Gate |
|---|---|---|---|
| 0 | [Foundation](sprint_0.md) | `[ ] Pending` | VPS/domain/firewall/secrets/runbook chốt. |
| 1 | [Application Security](sprint_1.md) | `[ ] Pending` | P0 auth, provisioning, OTA trust và test pass. |
| 2 | [Production Compose](sprint_2.md) | `[ ] Pending` | Immutable images + private networks + deploy rollback. |
| 3 | [TLS & MQTTS](sprint_3.md) | `[ ] Pending` | HTTPS/MQTTS/ACL/port scan pass. |
| 4 | [Device Migration & OTA](sprint_4.md) | `[ ] Pending` | Canary hardware pass trước rollout. |
| 5 | [Operations](sprint_5.md) | `[ ] Pending` | Backup restore + alert + staging/runbook pass. |

## Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-07-14 | Baseline deploy là VPS public thay vì lab/DDNS. | Tăng tính sẵn sàng và giảm rủi ro NAT/IP động/mất điện tại lab. |
| 2026-07-14 | Cloudflare proxy chỉ HTTP(S); `mqtt` DNS-only và TLS terminate ở EMQX. | Cloudflare proxy chuẩn không forward raw MQTT TCP; NPM không thay thế native EMQX MQTTS. |
| 2026-07-14 | App/API tách `app`/`api` ở giai đoạn đầu. | Phù hợp contract `NEXT_PUBLIC_API_URL` sẵn có; CORS được cấu hình allowlist rõ ràng. |
| 2026-07-14 | Public deployment bị block bởi auth UI/API, device credential chung và `setInsecure()` OTA. | Đây là rủi ro trực tiếp tới actuator, credential và firmware integrity. |
| 2026-07-14 | Cấp certificate wildcard bằng DNS-01 Cloudflare; EMQX mount cert từ certificate store riêng thay vì thư mục nội bộ NPM. | `mqtt` DNS-only vẫn cấp/renew cert tin cậy; tránh coupling với layout không ổn định của NPM. |
| 2026-07-14 | Baseline VPS nâng thành 4 vCPU / 8 GB RAM / 80 GB NVMe. | Có headroom thực tế cho TimescaleDB, EMQX TLS, NPM, Next/Nest và OS page cache; 2/4 chỉ staging/pilot đã load test. |
