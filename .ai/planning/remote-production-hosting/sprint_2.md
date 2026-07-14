# Sprint 2 — Immutable Production Compose & Private Service Network

> **Status:** `[ ] Pending`  
> **Dependency:** Sprint 1 P0 complete.  
> **Mục tiêu:** Tạo deployment reproducible, không dùng development runtime/source mount và có health/rollback rõ ràng.

## Track A — Images và Compose profiles

| ID | File chính | Công việc | Acceptance criteria |
|---|---|---|---|
| A1 | `mushroom-backend/Dockerfile` | Multi-stage build: `pnpm install --frozen-lockfile` → `pnpm build` → minimal runtime non-root, `NODE_ENV=production`, `start:prod`; include health endpoint/tool. | Image không chứa source dev/node_modules dư thừa khi không cần; chạy non-root; build deterministic. |
| A2 | `mushroom-ui/Dockerfile` | Multi-stage Next production: build với `NEXT_PUBLIC_API_URL=https://api.<domain>` đúng thời điểm build; chạy `next start` non-root hoặc standalone output. | Không dùng `next dev`, không source/`.next` bind mount; biến public kiểm chứng trong bundle deploy. |
| A3 | `docker-compose.yml`, `compose.production.yml` | Giữ compose local developer-friendly riêng; thêm production override/compose tách service data/app/proxy, image tags immutable (digest/version). | `docker compose -f docker-compose.yml -f compose.production.yml config` pass; local workflow không bị phá. |
| A4 | Compose | Loại `container_name` nếu không cần, source bind mounts và published backend/UI ports; thêm `init: true`, `restart: unless-stopped`, healthcheck, dependency health và resource limits hợp lý. | Restart service thử nghiệm recover; only proxy/MQTTS expose host. |

## Track B — Network, data, health and secret handling

| ID | Công việc | Acceptance criteria |
|---|---|---|
| B1 | Dùng `edge` network cho NPM→UI/API và `internal: true` network cho API→DB/EMQX. PostgreSQL không có `ports`; backend/UI chỉ `expose`. | Inspect network chứng minh DB không tiếp cận từ edge/host; API vẫn tới DB/EMQX. |
| B2 | Chuyển default password/cookie trong Compose thành required env; đặt `NODE_ENV=production`, `PORT`, `ALLOWED_ORIGINS`, `TZ`; đặt `read_only`, `tmpfs`, `cap_drop` khi tương thích. | `grep` Compose không còn `changeme`, `admin_mushroom`, `emqx_secret_cookie` fallback production. |
| B3 | Ghim image TimescaleDB/EMQX theo version/digest sau compatibility test; không dùng `latest`. | Upgrade runbook nêu version hiện hành, backup trước upgrade và rollback. |
| B4 | Tạo `/health`/`/ready` cho NestJS (DB + MQTT readiness tách nếu cần) và healthcheck UI; NPM route chỉ target healthy service. | Script smoke test báo lỗi phân biệt backend/db/mqtt; health endpoint không lộ secret/stack. |
| B5 | Tạo deployment scripts: `pull/build`, preflight config, migrate/schema check, `up -d`, smoke test, rollback image tag. | Deploy tag N → N+1 và rollback N thành công trên staging. |

## Deliverables

- `compose.production.yml` và `.env.production.example`.
- Dockerfiles production; không thay thế Dockerfiles local nếu làm hỏng DX, có thể dùng `Dockerfile.production`.
- `scripts/deploy-production.sh`, `scripts/smoke-production.sh`, runbook rollback.
