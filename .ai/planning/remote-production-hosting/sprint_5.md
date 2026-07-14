# Sprint 5 — Backup, Monitoring, Staging & Operations

> **Status:** `[ ] Pending`  
> **Dependency:** Sprint 3 (monitoring baseline) và Sprint 4 (cutover).  
> **Mục tiêu:** Vận hành lâu dài có thể phát hiện lỗi, khôi phục dữ liệu và rollback an toàn.

## Track A — Backup and disaster recovery

| ID | Công việc | Acceptance criteria |
|---|---|---|
| A1 | Backup PostgreSQL logical (`pg_dump`/`pg_dumpall` theo policy) và volume/config quan trọng EMQX/NPM; encrypt at rest, upload off-host. | Daily backup + retention (ví dụ 7 daily/4 weekly/12 monthly, điều chỉnh theo RPO); backup job alert khi fail. |
| A2 | Define RPO/RTO với chủ trại: telemetry có thể mất bao lâu, thời gian khôi phục app, provisioning credential recovery. | RPO/RTO được phê duyệt và map tới cadence/storage. |
| A3 | Restore drill định kỳ vào host/project tách biệt, không ghi đè production. | Khôi phục DB/schema, registry, telemetry mẫu và EMQX config thành công; kết quả/date được lưu. |

## Track B — Observability and alerting

| ID | Công việc | Acceptance criteria |
|---|---|---|
| B1 | Centralize structured logs và metrics (container health, CPU/RAM/disk, DB connections/storage, EMQX client count/rejects, API latency/5xx, TLS expiry). | Dashboard có owner/on-call; logs redact secret. |
| B2 | Alert: host disk >80%, backup fail, certificate expiry, container unhealthy/restart loop, API 5xx, EMQX auth failure spike, device offline/stale, OTA failure. | Mỗi alert test được tới channel vận hành; severity/runbook link rõ. |
| B3 | Add app correlation/request IDs and command/OTA audit dashboards. | Có thể trace thao tác người dùng → API → MQTT dispatch → device ack. |

## Track C — Delivery and operational discipline

| ID | Công việc | Acceptance criteria |
|---|---|---|
| C1 | CI: lint/test/build image, dependency/vulnerability scan, secret scan, compose config validation; push signed/tagged images. | Main branch protection; deployment chỉ từ artifact đã kiểm thử. |
| C2 | Staging mirrors production config/domains/certs at scaled-down size; test migration/upgrade there first. | Upgrade EMQX/Timescale/Node/Next/Nest has documented compatibility and rollback. |
| C3 | Viết runbooks: deploy, rollback, rotate secret/per-device PSK, revoke user, enroll device, incident device offline, restore DB, certificate renewal. | Người vận hành thứ hai làm được tabletop/drill không cần knowledge cá nhân của người viết. |
