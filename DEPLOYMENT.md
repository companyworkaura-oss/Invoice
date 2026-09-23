# Deployment Guide

Concise operational guide for running the Embroidery Billing app in production.

## Architecture

- `apps/api` — Express API (Node 22+, TypeScript, compiled to `apps/api/dist`)
- `apps/web` — React SPA (Vite, compiled to static files in `apps/web/dist`)
- `packages/shared` — shared types/utilities, built to `packages/shared/dist` (both apps depend on it)
- PostgreSQL — single source of truth; migrations are tracked in `schema_migrations` and applied automatically on API boot

You can deploy the frontend two ways:
1. **Separately** (recommended) — build `apps/web/dist` and serve it from a static host/CDN, API deployed independently. Simpler to scale and cache.
2. **Single process** — set `SERVE_FRONTEND=true` and the API serves `apps/web/dist` itself via `express.static` + SPA fallback. Convenient for small/simple deployments.

## 1. Build

```bash
npm ci
npm run build   # builds packages/shared, apps/api, apps/web in order
```

This produces `apps/api/dist`, `apps/web/dist`, `packages/shared/dist`.

## 2. Environment variables

Copy `apps/api/.env.example` to `apps/api/.env` (or inject these as real environment
variables via your platform/orchestrator — never commit `.env`, it's gitignored).

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | Set to `production`. Enables cookie-security warning, disables verbose test-only behavior. |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `PORT` | no (default `4000`) | Port the API listens on. |
| `COOKIE_SECURE` | yes in production | Set to `true`. The session cookie is only sent over HTTPS when this is `true`. The app logs a startup warning if `NODE_ENV=production` and this isn't `true`. |
| `SESSION_TTL_HOURS` | no (default `168`) | Session lifetime. |
| `CHROMIUM_EXECUTABLE_PATH` | yes (for PDF export) | Path to a Chromium binary used by `playwright-core` to render invoice PDFs. No browser is bundled — install one on the host/image and point this at it. |
| `RATE_LIMIT_DISABLED` | no (default `false`) | Never set `true` in production — this exists only for the test suite. |
| `SERVE_FRONTEND` | no (default `false`) | Set `true` only for the single-process deployment (see above). |
| `WEB_DIST_DIR` | no (default `../web/dist`) | Path to the built frontend, relative to the API's working directory, when `SERVE_FRONTEND=true`. |
| `UPLOADS_DIR` | no (default `uploads`) | Where uploaded logo files are stored on disk. Mount a persistent volume here if you don't use object storage. |
| `MAX_LOGO_BYTES` | no (default `2097152`) | Upload size limit. |

**Do not expose secrets**: `DATABASE_URL` contains credentials — set it via your platform's
secret manager / environment injection, never commit it, and never log it (the app's
structured request logs only ever include method/path/status/duration, never headers or
bodies).

## 3. Database migrations

Migrations run automatically on API boot (`apps/api/src/index.ts` calls `migrate()`
before the HTTP server starts listening), protected by a Postgres advisory lock so it's
safe to run multiple API instances concurrently — only one will apply pending migrations,
the rest wait and proceed once done.

To run migrations manually (e.g. before a blue/green cutover):

```bash
npm run migrate -w @invoice/api
```

## 4. Secure cookies & HTTPS

The app assumes it sits behind a TLS-terminating reverse proxy or load balancer (nginx,
a cloud load balancer, etc.) — it does not terminate HTTPS itself. `app.set('trust proxy', 1)`
is already configured so `Secure`/rate-limiting logic sees the real client IP and protocol
from `X-Forwarded-*` headers. Requirements:

- Terminate TLS in front of the API.
- Set `COOKIE_SECURE=true` so the session cookie has the `Secure` flag (browsers will then
  refuse to send it over plain HTTP).
- Only ever expose the API to the internet through the HTTPS listener, not the raw HTTP port.

## 5. Database backups

Use the included scripts, which read `DATABASE_URL` from the environment (same variable
the app uses) and never hard-code credentials:

```bash
# Backup (pg_dump, custom format, timestamped)
DATABASE_URL=postgres://... ./scripts/backup.sh [output-dir]   # default: ./backups

# Restore (pg_restore, prompts for confirmation)
DATABASE_URL=postgres://... ./scripts/restore.sh backups/embroidery-20260101T000000Z.dump
```

Recommended cadence: automated daily `backup.sh` run (e.g. via cron or your platform's
scheduled jobs) with backups retained for at least 30 days, stored off the database host
(e.g. object storage). Test `restore.sh` against a scratch database periodically — an
untested backup is not a backup.

## 6. Logging

Every request gets a structured single-line JSON log entry (`{level, requestId, method,
path, status, durationMs}`) written to stdout — pipe this into your log aggregator as-is.
Bodies, headers, cookies, and auth tokens are never logged. Each response also carries an
`X-Request-Id` header (reusing one from an upstream proxy if present, otherwise a generated
UUID) so a request can be traced end-to-end across proxy → API → error logs.

## 7. Error monitoring

`apps/api/src/lib/error-reporter.ts` defines an `ErrorReporter` interface with a default
`ConsoleErrorReporter` (structured JSON to stderr, including the request id, method, path,
and stack trace — never sent to clients). To wire up a real monitoring service (Sentry,
Rollbar, etc.) later: implement the interface and swap the implementation returned by
`getErrorReporter()` — no call-site changes needed elsewhere.

## 8. Health endpoints

- `GET /api/health` — liveness check, always fast, never touches the database. Use for
  container/orchestrator liveness probes.
- `GET /api/health/ready` — readiness check, runs `SELECT 1` against Postgres and returns
  `503` if unreachable. Use for readiness probes / load-balancer health checks.

Both require no authentication.

## 9. Starting the app

```bash
npm run start   # from repo root — delegates to apps/api's start script
```

Equivalent to `node --env-file-if-exists=.env apps/api/dist/index.js` — it prefers a local
`.env` file if present (useful for a single-host deployment) but does not require one, so
it works unmodified when your platform injects environment variables directly.

On boot the process: creates the uploads directory if missing, runs pending migrations,
then starts listening. On `SIGTERM`/`SIGINT` it stops accepting new connections, lets
in-flight requests finish, closes the database pool, then exits (forced exit after a 10s
timeout as a safety net) — safe for rolling deploys/orchestrator restarts.

## 10. Deployment checklist

- [ ] `npm ci && npm run build` succeeds
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, `DATABASE_URL` set via secrets, not committed
- [ ] `CHROMIUM_EXECUTABLE_PATH` points at an installed Chromium binary
- [ ] TLS terminated in front of the API (reverse proxy/load balancer)
- [ ] Persistent volume mounted for `UPLOADS_DIR` (or migrate to object storage)
- [ ] Orchestrator configured with `/api/health` (liveness) and `/api/health/ready` (readiness)
- [ ] Scheduled `scripts/backup.sh` with off-host retention, `scripts/restore.sh` tested
- [ ] Log aggregator ingesting stdout/stderr JSON lines
