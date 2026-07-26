# mushroom-cp

## Local development with Docker Compose

This repository includes a `docker-compose.yml` that brings up the TimescaleDB (Postgres), EMQX (MQTT broker), a NestJS backend, and the Next.js frontend (`mushroom-ui`). Use the commands below to start the full development environment.

1) Create an `.env` file at the repository root from the supported deployment
template, then replace every `CHANGE_ME` value with an environment-specific
secret before starting the stack:

```bash
cp .env.example .env
```

The required backend authentication entries are:

```
# Backend authentication
# Generate independently, e.g. with: openssl rand -base64 48
# TUNING_SSE_TICKET_SECRET must be UTF-8, at least 32 bytes, and must not
# equal JWT_SECRET. Never commit real secrets.
JWT_SECRET=CHANGE_ME_generate_a_separate_jwt_secret
TUNING_SSE_TICKET_SECRET=CHANGE_ME_generate_a_separate_32_byte_minimum_secret
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
- `TUNING_SSE_TICKET_SECRET` is mandatory whenever the backend starts. It signs the short-lived, URL-borne SSE tickets for native `EventSource`; never reuse `JWT_SECRET` for it.
- Docker runtime volumes are deliberately ignored under `data/`; never add PostgreSQL, InfluxDB, EMQX/Mnesia, WAL, SQLite, or broker-generated configuration to Git.
- Treat every credential that was present in an old runtime volume as compromised. Before deploying this remediation, rotate the PostgreSQL, InfluxDB, MQTT, JWT, SSE-ticket, and EMQX node-cookie credentials in the target environment, then recreate the affected runtime volumes.
