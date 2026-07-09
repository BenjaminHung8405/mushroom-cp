# mushroom-cp

## Local development with Docker Compose

This repository includes a `docker-compose.yml` that brings up the TimescaleDB (Postgres), EMQX (MQTT broker), a NestJS backend, and the Next.js frontend (`mushroom-ui`). Use the commands below to start the full development environment.

1) Create an `.env` file at the repository root (example below).

Example `.env`:

```
# Postgres
PG_HOST_PORT=5432

# EMQX / MQTT
MQTT_TCP_PORT=1883
MQTT_WS_PORT=8083
EMQX_DASHBOARD_PORT=18083

# Backend / Frontend host ports
BE_HOST_PORT=3001
UI_HOST_PORT=3000

# Optional: set NODE_ENV or other service-specific vars
NODE_ENV=development
```

2) Start services (detached):

```bash
docker compose up -d --build
```

3) View logs (combined):

```bash
docker compose logs -f
```

4) Stop and remove containers:

```bash
docker compose down -v
```

Notes:
- If you run multiple projects on the same machine, prefer changing host ports in `.env` or using `docker compose -p mushroom-project up` to namespace resources.
- EMQX dashboard is available on `http://localhost:${EMQX_DASHBOARD_PORT:-18083}` when using default ports.

