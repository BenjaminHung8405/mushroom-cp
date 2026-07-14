# Sprint 4 — Device Migration, Secure OTA & Controlled Cutover

> **Status:** `[ ] Pending`  
> **Dependency:** Sprint 3 complete.  
> **Mục tiêu:** Di chuyển ESP32 từng thiết bị mà không biến thiết bị hiện hữu thành unreachable hoặc giảm an toàn sinh học.

## Track A — Provisioning and MQTTS migration

| ID | Công việc | Acceptance criteria |
|---|---|---|
| A1 | Chuẩn bị CA certificate bundle/pin phù hợp ESP32, DNS resolution, NTP/time bootstrap và test RAM/flash. Nhúng/persist **root CA hoặc intermediate CA bền vững** (ví dụ ISRG Root X1 khi dùng Let’s Encrypt), không pin leaf/wildcard certificate 90 ngày; lập kế hoạch CA rollover. | ESP32 validate chain/SNI cho `mqtt.<domain>` và `api.<domain>` không dùng `setInsecure`; renewal leaf certificate không đòi firmware update; CA/time failure có log và retry backoff. |
| A2 | Cập nhật SoftAP provisioning UI/API và NVS schema/version để nhập `mqtt.<domain>`, `8883`, per-device credential, `https://api.<domain>`. Không hiện lại PSK sau save. | NVS migration atomic; invalid config không overwrite config cũ; factory reset path documented. |
| A3 | Phát hành firmware migration theo canary: 1 test bench → 1 nhà nấm ít rủi ro → từng device. | Mỗi cohort có precheck telemetry/LWT, maintenance window, owner approval và rollback procedure. |
| A4 | Dùng `scripts/enroll-device.sh` chỉ qua private EMQX admin endpoint/VPN hoặc thay bằng backend admin protected API. | Script không dựa vào public `localhost` assumptions, không in PSK, audit được enrollment/rotation. |

## Track B — OTA release lifecycle

| ID | Công việc | Acceptance criteria |
|---|---|---|
| B1 | Chọn artifact storage HTTPS private/public-read theo signed release (S3/R2/object storage hoặc server). Không serve binary ghi đè từ source checkout. | Artifact immutable, versioned, checksum/signature manifest, retention policy. |
| B2 | Backend release state machine: draft → signed → canary → rollout → halted/rollback; authorize command and record audit. | Không thể OTA arbitrary URL từ MQTT/UI; concurrent deployment limits và target selection audit. |
| B3 | Firmware verify manifest signature, compatible hardware/version, SHA-256 then flash; use dual OTA partition and post-boot health confirmation/rollback. | Canary success/failure test; power interruption and bad image do not brick device; application resumes safe control. |
| B4 | Tạo dashboard/alert rollout state theo device (downloaded, installed, boot confirmed, rollback). | Không có device “silent failure”; timeout raises alert and halt rollout. |

## Cutover checklist

- Freeze release không liên quan và backup database trước cutover.
- Verify DNS, certificate, MQTTS, API auth, CORS, dashboard privacy and port scan.
- Di chuyển canary device trước; xác nhận telemetry, LWT, commands and local safe-offline.
- Mở rollout từng nhóm nhỏ; dừng ngay khi tỷ lệ lỗi vượt ngưỡng đã chốt.
- Chỉ tắt local broker/backend sau khi toàn bộ thiết bị đã ổn định qua ít nhất một chu kỳ vận hành.
