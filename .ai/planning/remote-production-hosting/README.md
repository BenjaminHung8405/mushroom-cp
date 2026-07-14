# Production Remote Hosting — Kế hoạch đưa Mushroom CP lên Server từ xa

> **Trạng thái:** Chuẩn bị triển khai, chưa public bất kỳ dịch vụ nào.  
> **Phạm vi:** VPS Linux public + Docker Compose + Cloudflare DNS + Nginx Proxy Manager (NPM) cho Web/API + EMQX MQTTS native + PostgreSQL/TimescaleDB private.

## 1. Mục tiêu và tiêu chí Go-Live

Đưa hệ thống Mushroom CP đang chạy local lên một VPS production mà vẫn bảo vệ được thiết bị điều khiển relay tại trại nấm. Không chỉ chuyển `localhost` thành domain: hệ thống phải phân tách traffic, mã hóa đường truyền, quản lý secret, có sao lưu/khôi phục và có quy trình rollback.

### Kiến trúc đích

```text
Người dùng browser
  └─ HTTPS/443 ─ Cloudflare ─ NPM ─ app.<domain>  (Next.js)
                                      └─ api.<domain> (NestJS REST/SSE)
                                                     └─ private Docker network
                                                        ├─ TimescaleDB/PostgreSQL
                                                        └─ EMQX

ESP32 tại trại
  └─ MQTTS/8883 ─ mqtt.<domain> (DNS-only) ─ EMQX native TLS
  └─ HTTPS/443  ─ api.<domain>             ─ NestJS (provisioning/OTA)

Admin vận hành
  └─ VPN hoặc SSH bastion/IP allowlist ─ EMQX dashboard, NPM admin, PostgreSQL tools
```

### Cổng được phép từ Internet

| Cổng | Dịch vụ | Chính sách production |
|---:|---|---|
| 22/TCP | SSH | Chỉ key-based; giới hạn IP hoặc VPN nếu có thể. |
| 80/TCP | HTTP | Chỉ phục vụ ACME redirect/challenge; chuyển HTTPS. |
| 443/TCP | HTTPS | NPM cho `app` và `api`; HTTPS trực tiếp từ ESP32 cho API/OTA. |
| 8883/TCP | MQTTS | EMQX native TLS, client certificate/username-password theo lộ trình. |
| 3001, 3002, 5432, 18083, 1883 | Backend/UI/DB/EMQX dashboard/MQTT plaintext | **Không mở public.** Bind nội bộ Docker hoặc `127.0.0.1`/VPN-only. |

## 2. Quyết định kiến trúc bắt buộc

1. **Môi trường đầu tiên là VPS public**, Ubuntu LTS. Baseline khả dụng là **4 vCPU / 8 GB RAM / 80 GB NVMe SSD**; 2 vCPU / 4 GB chỉ dùng staging/lab hoặc pilot rất ít thiết bị sau khi đo tải. Máy chủ lab/DDNS chỉ nên là môi trường staging hoặc phương án dự phòng vì NAT, mất điện và IP động làm giảm độ tin cậy.
2. Dùng ba subdomain: `app.<domain>`, `api.<domain>`, `mqtt.<domain>`. Có thể thêm `ota.<domain>` nếu tách nơi lưu firmware artifact.
3. Cloudflare proxy (orange cloud) chỉ dùng cho HTTP/HTTPS (`app`, `api`, có thể `ota`). `mqtt.<domain>` phải để **DNS-only** trừ khi mua Cloudflare Spectrum; Cloudflare CDN thông thường không proxy MQTT TCP cổng 8883.
4. NPM chỉ reverse proxy HTTP(S). **MQTTS phải terminate TLS tại EMQX** (listener 8883), không đặt niềm tin vào NPM như proxy HTTP cho MQTT raw TCP. Certificate cho EMQX được cấp bằng DNS-01 Cloudflare và mount từ một certificate store chuyên dụng/read-only; không phụ thuộc cấu trúc thư mục nội bộ của NPM.
5. Có CORS allowlist chặt cho `https://app.<domain>`. Nên giữ `api` tách domain ở giai đoạn đầu để ít thay đổi UI; sau này có thể proxy `/api` cùng origin để loại bỏ CORS.
6. Không dùng mặc định/fallback chứa secret trong production. Docker Compose production phải fail-fast nếu biến bắt buộc chưa có.
7. Không public trước khi hoàn thành xác thực UI/API và phân quyền lệnh điều khiển. Hiện các API actuator/batch chưa có user authentication thực tế; UI còn dùng token placeholder. MQTT authentication/authorization phải có một nguồn dữ liệu thiết bị rõ ràng: EMQX built-in database per-device hoặc EMQX HTTP authn/authz gọi backend private, được quyết định bằng ADR trước Sprint 3.


## 2.1. Capacity baseline và ngưỡng scale

| Thành phần | Pilot (tối đa khoảng 10 ESP32) | Khuyến nghị production ban đầu | Lưu ý |
|---|---:|---:|---|
| VPS | 2 vCPU / 4 GB / 60 GB NVMe (chỉ sau load test) | **4 vCPU / 8 GB / 80 GB NVMe** | TimescaleDB, EMQX, build/deploy và page cache cần headroom. |
| PostgreSQL/TimescaleDB | 1–1.5 GB RAM budget | 2–3 GB RAM budget | Telemetry retention và index quyết định dung lượng; theo dõi disk/IOPS. |
| EMQX | 0.5–1 GB | 1–1.5 GB | Tăng theo concurrent MQTT/TLS sessions và message rate. |
| NestJS + Next.js + NPM | 0.8–1.2 GB | 1.5–2 GB | Build không chạy trên production host nếu dùng CI image; vẫn cần headroom. |
| OS/cache/đột biến | ≥1 GB | ≥2 GB | Không cấp phát tổng Docker limit sát RAM VPS. |

- Bắt đầu **4 vCPU / 8 GB** nếu host đồng thời NPM + EMQX + TimescaleDB + Next.js + NestJS như kiến trúc này.
- Đặt alert RAM > 75%, disk > 70% và CPU/load sustained; resize VPS trước khi saturation.
- Chốt retention/continuous aggregate telemetry trước khi ước lượng disk dài hạn. Phải đo telemetry payload, tần suất publish, số thiết bị và query history ở staging; không suy diễn dung lượng chỉ từ RAM.

## 3. Hiện trạng đã xác nhận (14-07-2026)

| Hạng mục | Hiện trạng | Khoảng cách production |
|---|---|---|
| Compose | Đã có TimescaleDB, EMQX, NestJS, Next.js và volume dữ liệu. | Image/command/volume là development (`start:dev`, `next dev`, source bind mounts); backend/UI host port đang public. |
| UI/API URL | UI đã dùng `NEXT_PUBLIC_API_URL`; backend có `ALLOWED_ORIGINS`. | Fallback còn `http://localhost:3001`; URL public phải được build-time inject. |
| CORS | `main.ts` chỉ allowlist khi `NODE_ENV=production`. | Cần validate origin, parse trim, set exact production origin và kiểm thử SSE/credential policy. |
| MQTT | EMQX có ACL deny-by-default và script tạo user; backend dùng Docker DNS nội bộ. | Listener là MQTT plaintext 1883; dashboard đang host-exposed; ACL chưa bao phủ đầy đủ topic profile/manual/OTA và không có TLS. |
| Thiết bị | Firmware lưu MQTT/backend URL trong NVS. | Default là IP LAN và HTTP; MQTT client dùng WiFiClient (plaintext); OTA đang `setInsecure()`. |
| Device auth | `/auth/token` trả `MQTT_ESP32_PASS` tĩnh. | Endpoint chưa xác thực thiết bị và có nguy cơ cấp PSK chung cho bất kỳ caller nào. |
| App auth | API điều khiển/batch chưa có đăng nhập người vận hành thực tế; UI chứa `simulated-jwt-token-placeholder`. | Đây là blocker P0 trước public. |
| Database | Database không expose qua Compose; volume tồn tại. | Cần backup off-host, restore drill, retention và giám sát dung lượng. |

## 4. Phân kỳ triển khai

| Sprint | Trọng tâm | Điều kiện hoàn thành |
|---|---|---|
| 0 | Quyết định hạ tầng, domain, threat model, secret inventory | Có VPS, domain, sơ đồ DNS/firewall, owner cho secret và runbook truy cập. |
| 1 | Chuyển code/app sang production-safe | Không còn endpoint điều khiển public unauthenticated; config domain/TLS rõ ràng; test pass. |
| 2 | Production Compose, image immutable và mạng private | `docker compose -f compose.production.yml config` hợp lệ; không bind mount source, không public port nội bộ. |
| 3 | DNS, NPM, HTTPS và MQTTS | Web/API HTTPS valid, MQTT TLS valid, dashboard/admin private. |
| 4 | Provisioning ESP32, OTA an toàn và migration từng thiết bị | Thiết bị xác thực per-device, pin CA, reconnect MQTTS và OTA có chữ ký/rollback. |
| 5 | Observability, backup, staging, cutover và vận hành | Restore drill pass, alert hoạt động, checklist go-live/rollback được diễn tập. |

## 5. Quy tắc bảo mật không được nới lỏng

- Không commit `.env`, private key, CA key, password, backup hay firmware signing key.
- Không dùng `allow_anonymous`, password mặc định, `setInsecure()` hoặc `NEXT_PUBLIC_*` cho secret ở production.
- Mỗi ESP32 có `device_id`/MQTT username và PSK riêng; một thiết bị bị lộ không được ảnh hưởng thiết bị khác. Nếu dùng EMQX HTTP authn/authz, backend endpoint chỉ nghe internal network, có timeout/cache/failure policy rõ để broker không bị outage dây chuyền.
- User backend chỉ có các quyền topic tối thiểu; user thiết bị chỉ publish/subscribe đúng topic của chính nó.
- API có ghi dữ liệu hoặc dispatch relay phải xác thực người vận hành, phân quyền, audit log và rate limit.
- OTA package phải được ký; firmware phải kiểm chữ ký/hash và certificate CA trước khi ghi flash. TLS một mình không thay thế signature. ESP32 chỉ trust CA root/intermediate ổn định (ví dụ ISRG Root X1 khi dùng Let’s Encrypt), **không** pin leaf certificate 90 ngày.
- PostgreSQL và UI/backend management ports không xuất hiện trong security group/UFW public.

## 6. Kiểm thử nghiệm thu tổng thể

1. Từ mạng Internet: truy cập `https://app.<domain>` và gọi REST/SSE qua `https://api.<domain>` thành công; HTTP redirect HTTPS.
2. Origin khác không có trong allowlist bị CORS chặn; request actuator không token/không role nhận `401/403` và không publish MQTT.
3. Port scan public chỉ thấy 22, 80, 443, 8883 theo thiết kế; 3001/3002/5432/18083/1883 không kết nối được.
4. Thiết bị hợp lệ kết nối MQTTS với CA; username/sai password, plaintext port, hoặc topic của thiết bị khác đều bị EMQX từ chối.
5. Tắt/restart từng container: Compose tự phục hồi, UI không làm relay chuyển trạng thái nguy hiểm, DB volume còn nguyên.
6. Backup mới nhất khôi phục được vào môi trường tách biệt; đối chiếu schema, device registry và một mẫu telemetry.
7. OTA thử trên thiết bị canary: signature/CA/URL sai bị từ chối; cập nhật thành công boot lại và health check xác nhận phiên bản; failure quay về firmware hoạt động trước đó.
