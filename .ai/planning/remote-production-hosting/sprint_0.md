# Sprint 0 — Foundation: VPS, Domain, Threat Model & Runbook

> **Status:** `[ ] Pending`  
> **Mục tiêu:** Chốt hạ tầng và quyền vận hành trước khi thay đổi source hoặc public IP.

## Track A — Quy hoạch hạ tầng và DNS

| ID | Công việc | Tiêu chí nghiệm thu |
|---|---|---|
| A1 | Chọn VPS Ubuntu LTS, region gần trại/Việt Nam, tối thiểu 2 vCPU/4 GB RAM/60 GB SSD; tạo staging nếu ngân sách cho phép. | Lưu inventory: provider, region, IPv4/IPv6, sizing, owner, kỳ hạn billing; không ghi credential vào repo. |
| A2 | Đăng ký/đưa domain vào Cloudflare, bật MFA cho owner/admin, tạo DNS records `app`, `api`, `mqtt`, tùy chọn `ota`. | `app`/`api` proxied; `mqtt` DNS-only; TTL và origin IP được ghi trong runbook. |
| A3 | Chọn tên domain thật và tạo bảng mapping config. | `NEXT_PUBLIC_API_URL=https://api.<domain>`; `ALLOWED_ORIGINS=https://app.<domain>`; firmware dùng `api.<domain>`, `mqtt.<domain>:8883`. |
| A4 | Xác định data classification và threat model tối thiểu: browser user, admin, ESP32, Internet scanner, leaked PSK, compromised UI account. | Có danh sách asset, entrypoint, tác động và biện pháp giảm thiểu; actuator command và OTA được đánh dấu critical. |
| A5 | Lập capacity sheet từ số ESP32, tần suất/payload telemetry, retention, history query và concurrency UI. Chọn VPS 4 vCPU/8 GB/80 GB làm mặc định; 2 vCPU/4 GB chỉ được dùng khi staging load test chứng minh đủ. | Có CPU/RAM/disk budget, alert threshold và dự báo 3/6/12 tháng; không cấp Docker memory limit vượt tổng RAM. |
| A6 | Viết ADR cho MQTT identity source: **(A)** EMQX built-in DB + per-device PSK, hay **(B)** EMQX HTTP authentication/authorization gọi backend internal. Đánh giá blast radius khi backend/DB down, cache/timeout, credential rotation và audit. | ADR được phê duyệt; không pha trộn hai nguồn credential trong cùng rollout. |

## Track B — Baseline máy chủ

| ID | Công việc | Tiêu chí nghiệm thu |
|---|---|---|
| B1 | Tạo user deploy không phải root, SSH key-only, tắt password/root SSH; bật automatic security updates. | SSH bằng key user deploy; password/root bị từ chối; recovery access được lưu an toàn. |
| B2 | Cấu hình UFW/security group: inbound chỉ 22 (hạn chế IP/VPN), 80, 443, 8883; outbound DNS/HTTPS/NTP theo nhu cầu. | Kiểm thử từ mạng ngoài và ghi lại kết quả `nmap`; không public 3001/3002/5432/18083/1883. |
| B3 | Cài Docker Engine/Compose plugin từ nguồn chính thức; đặt thư mục deploy, ownership, log rotation và time zone `Asia/Ho_Chi_Minh` cho vận hành. | `docker compose version`, disk/log rotation và NTP healthy; không cài source runtime thủ công trên host. |
| B4 | Thiết kế quản lý secret: `.env.production` chmod 600 trên host hoặc secret manager; rotation owner và lịch rotation. | Inventory có EMQX admin, DB, backend MQTT, per-device PSK, NPM, JWT/app auth, TLS/OTA signing keys; không có giá trị secret trong tài liệu/repo/log. |

## Deliverables

- `docs/operations/production-runbook.md` (tạo Sprint 2) sẽ ghi domain thật, host alias, port policy, deploy/rollback owner.
- `.env.production.example` không chứa secret, chỉ có biến/tài liệu hợp lệ.
- Quyết định có/không có staging và chính sách backup off-host được chủ dự án phê duyệt.
