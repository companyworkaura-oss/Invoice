# Embroidery Billing

Modular billing SaaS for embroidery shops (invoicing today; inventory,
production, expenses, machines, and reporting land in later phases).

## Structure

```
apps/
  web/        React + TypeScript + Tailwind (Vite)
  api/        Node.js + Express + TypeScript, PostgreSQL via `pg`
packages/
  shared/     TypeScript types shared between web and api
```

Business modules live under `apps/api/src/modules/*` (routes + service +
migrations) and `apps/web/src/features/*` (UI). Only `auth` and `company`
are implemented so far; the rest are placeholder folders reserved for
their own phase.

## Requirements

- Node.js 20+
- PostgreSQL 16+

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL, etc.
```

Create the database referenced by `DATABASE_URL` in `apps/api/.env`
(migrations run automatically on API boot, or via `npm run migrate -w @invoice/api`).

## Development

```bash
npm run dev:api     # API on http://localhost:4000
npm run dev:web      # Web on http://localhost:5173 (proxies /api to the API)
```

## Scripts (root)

- `npm run lint` — lint api + web
- `npm run typecheck` — typecheck shared + api + web
- `npm run build` — build shared, then api, then web
- `npm test` — run api integration tests
