# Project memory — Embroidery Billing SaaS

Read this before making changes. It captures architecture, conventions, and
decisions from Phases 1–13 so future work stays consistent instead of
re-deriving (or accidentally contradicting) what's already here.

## What this is

A multi-tenant embroidery billing SaaS: companies manage customers,
configurable embroidery categories/formulas, invoices, and a customer ledger.
Built incrementally, one numbered phase per request, each phase extending
the previous rather than rebuilding it.

## Stack & layout

npm workspaces monorepo:

```
apps/api/       Express + TypeScript + PostgreSQL (pg)
apps/web/       React + TypeScript + Tailwind v4 (Vite)
packages/shared/  Types + the formula engine, used by both apps
```

- `apps/api/src/modules/<name>/` — one folder per domain (auth, company,
  customers, formulas, invoices, ledger), each with `*.service.ts` (DB
  logic) and `*.routes.ts` (Express router, mounted in `app.ts`).
- `apps/api/src/migrations/*.sql` — numbered, applied in order by
  `src/db/migrate.ts` on boot (also `npm run migrate -w @invoice/api`).
  Migrations are wrapped in a Postgres advisory lock so concurrent
  processes (parallel tests, multiple API instances) can't race to apply
  the same one twice.
- `apps/web/src/features/<name>/` — mirrors the api modules; each has
  `api.ts` (fetch wrappers) + components. `App.tsx` is a tab-based
  single-card dashboard (Overview / Customers / Categories / Invoices).
- `packages/shared/src/` — `entities.ts` (all shared types), `api.ts`
  (`ApiErrorBody`), `formula-engine/` (moved here in Phase 9 so the
  frontend's live preview uses the *exact* server calculation code),
  `invoice-view-model.ts` (moved here in Phase 11: `InvoiceViewModel` +
  `buildInvoiceViewModel()` + `invoicePdfFilename()`, shared by the
  browser preview and the server-side PDF renderer so both build from
  identical, deliberately restricted data).

Root scripts (`package.json`): `typecheck`, `lint`, `build`, `test` all run
across workspaces in dependency order (shared → api/web). `test` builds
`@invoice/shared` first since `apps/api` imports its compiled `dist/`.

## Core architectural rules (established Phase 1, held throughout)

1. **Tenant isolation**: every company-scoped query is filtered by
   `companyId` taken from `auth(req).companyId` (resolved server-side from
   the session), **never** from the request body/URL/params. Cross-tenant
   access returns 404, not 403 (existence isn't leaked). This is tested
   explicitly in every module's test file.
2. **Money/decimals**: `pg` type parser overrides NUMERIC (OID 1700) and
   DATE (OID 1082) to return plain strings — never floats, never
   timezone-shifted `Date` objects (`apps/api/src/db/pool.ts`). All money
   arithmetic goes through `decimal.js` (`Decimal`, `roundMoney()` from
   `@invoice/shared`). Validation regexes live in `apps/api/src/lib/validate.ts`
   (`optionalMoney`, `requirePositiveDecimal`, etc.) and always keep the
   value as a string.
3. **No hard-coded business data**: embroidery categories and formulas are
   entirely company-configured data (`embroidery_categories` table,
   `formula_config` jsonb). The example categories/formulas from product
   briefs (HS/HP, Daman, Patti, Bazu, Dupatta) are never hard-coded into
   logic — only used as example/test fixtures.
4. **Snapshots, not live joins**: `invoice_items` stores `category_name`,
   `rate`, `formula_type`, `formula_config`, `calculation_inputs`,
   `calculated_unit_amount`, `calculated_total` all as a point-in-time copy.
   Editing a category later never changes an already-saved invoice — tested
   explicitly (`snapshots survive later changes...`).
5. **Ledger is the source of truth for balances**: nothing stores a
   "current balance" column anywhere. `ledger_entries` is append-only
   (never UPDATE/DELETE); balance = `SUM(debit) - SUM(credit)`, always
   computed fresh. A customer's `opening_balance` column is just the input
   that seeded one `OPENING_BALANCE` ledger row at creation — it's
   immutable after that (removed from `CustomerPatch` in Phase 8).
6. **Auth/session**: httpOnly, `SameSite=Lax` cookie holding a session
   token (only its SHA-256 hash is stored). `requireAuth` joins
   `sessions` → `company_members` so a revoked membership invalidates the
   session immediately. `requireRole('owner','admin')` gates
   company-settings endpoints; customers/categories/invoices are editable
   by any authenticated member (owner/admin/staff) since they're
   operational data entry.
7. **Formula engine, no eval()**: `packages/shared/src/formula-engine/` is
   a hand-written recursive-descent parser (tokenizer → parser → AST →
   evaluator) over a fixed variable allow-list (`stitches`, `rate`,
   `factor`, `multiplier`, `divisor`, `quantity`). Category convention:
   `formula_config.expression` holds the formula text; any other
   numeric/string key in `formula_config` is a fixed input value (e.g. a
   baked-in multiplier). New formula "types" are just new expression
   strings — no code change needed.
8. **Invoice numbering**: `invoice_counters` table, one row per company.
   `UPDATE ... SET next_number = next_number + 1 RETURNING next_number - 1`
   inside the invoice-creation transaction — the row lock serializes
   concurrent creations safely. Format: `{company.invoicePrefix}-000001`.

## Module map (what exists, what it does)

| Module | Backend routes | Notes |
|---|---|---|
| auth | `/api/auth/{register,login,logout,me}` | scrypt password hashing, generic errors |
| companies | `/api/companies` (list/create/switch) | multi-company membership, switches session's active tenant |
| company | `/api/company`, `/api/company/logo` | full profile (Phase 3): factory name, logo, contact, invoice prefix/currency/**defaultInvoiceTemplate**/terms. Logo storage behind `LogoStorage` interface (`apps/api/src/lib/storage/`) — local disk today, swappable later |
| customers | `/api/customers` | CRUD + search + archive (soft, never deleted) |
| formulas (categories) | `/api/categories` | CRUD + enable/disable (soft); `formula_type` free text, `formula_config` jsonb |
| invoices | `/api/invoices`, `.../pdf`, `.../whatsapp-share` | create (all calc server-side)/list/view only — **no PATCH/edit**, by design; PDF and WhatsApp share are read-only derivations of a saved invoice |
| ledger | `/api/customers/:customerId/ledger`, `.../payments`, `.../adjustments` | view ledger+balance, record a payment (credit) or adjustment (exactly one of debit/credit) |

Frontend: `apps/web/src/features/invoices/templates/` (Phase 10) — 5
selectable print-friendly invoice designs (Classic Navy, Modern Curve,
Minimal Clean, Industrial Blue, Premium Modern), all rendering the same
`InvoiceViewModel` (deliberately excludes formula/factor/multiplier/divisor
— enforced by the type shape, not just by convention). Registry-based:
add a template = one new component + one registry line, no backend
changes. Default template is chosen per-company via the Company Profile
form's select (`CompanyProfile.defaultInvoiceTemplate`, stored as a plain
string, no DB enum — so new templates never need a migration).

**PDF** (Phase 11): `GET /api/invoices/:invoiceId/pdf` renders an A4 PDF
server-side via `playwright-core` + a headless Chromium at
`config.chromiumExecutablePath` (env `CHROMIUM_EXECUTABLE_PATH`, this repo's
dev/test envs point it at `/opt/pw-browsers/chromium`). Its own template
"registry" is `apps/api/src/modules/invoices/pdf/themes.ts` — a
`PdfTheme` (colors/borders/font, pure data) per template id, consumed by
one shared HTML layout function (`render-html.ts`), not 5 duplicated
layouts. Logo is always inlined as a base64 `data:` URI
(`pdf/logo.ts`, fetched via HTTP against the API's own `/uploads` route
— storage-backend-agnostic) since a headless page has no session cookie
for a live `<img src>`. The browser preview/print path (React/Tailwind)
and the PDF path (server HTML string + Chromium) are two independent
renderers by design — they only share the *data* (`InvoiceViewModel`),
not rendering code, since a browser page and a PDF print engine have
different capabilities/constraints. On-screen preview uses a
`relative left-1/2 -mx-[50vw]` full-bleed trick to escape the narrower
dashboard card and show the whole A4 page without horizontal scrolling;
`@page { size: A4; margin: 0 }` (in `index.css`) plus each template's own
padding is the one page-margin model for browser print, while the PDF
path uses `page.pdf({ margin: 0 })` for the same reason — margin lives in
the HTML/CSS content, never in two places fighting each other.
`break-inside-avoid` (Tailwind, web) / `break-inside: avoid` (CSS, PDF
HTML) on every item row and the summary box is what keeps them from being
sliced across a page boundary — verified with a real 30-item invoice that
produced a genuine 2-page PDF with every row intact.

## Payments (Phase 12)

- `payments` table (migration `007_payments.sql`): customer, amount
  (checked > 0), date, payment_method (`cash`/`bank`/`cheque`/`other`),
  reference, notes. No stored balance column — same rule as everywhere
  else: the ledger is the only source of truth for balance.
- `apps/api/src/modules/payments` (service + routes) is the *only* way to
  record a payment now. `createPayment` runs the insert and the matching
  `postLedgerEntry(..., type: 'PAYMENT', credit: amount)` inside one
  `withTransaction` call, using the same `client` for both writes — the
  pattern to copy any time a write needs a side-effect ledger entry.
  `requireCustomer` was promoted from private to exported in
  `ledger.service.ts` specifically so this module could reuse the same
  tenant-scoped existence check instead of duplicating it.
- The old `POST /api/customers/:id/ledger/payments` route is gone;
  `ledger.routes.ts` now only exposes `GET /` (read) and
  `POST /adjustments` (manual ledger adjustments). Payments always go
  through `POST /api/payments`.
- Frontend: one reusable `PaymentForm` component
  (`apps/web/src/features/payments/PaymentForm.tsx`) used from three
  entry points — it takes an optional `customerId` prop (hides the
  customer selector and fixes the target when supplied) and an optional
  `suggestedAmount` prop (pre-fills the amount field, used on the invoice
  page to default to the invoice's current balance). Entry points:
  customer page (`CustomerLedgerPanel`, fixed customer), invoice page
  (`InvoiceDetails`, fixed customer + suggested amount, refreshes the
  invoice in place after payment via a new `onInvoiceUpdated` prop
  threaded up through `InvoicesPage`), and a standalone Payments page/tab
  (open customer selector, plus a table of all company payments).
- Partial payments are just payments smaller than the outstanding
  balance — no special-casing needed anywhere, since the balance is
  always `SUM(debit) - SUM(credit)` over the ledger and payments only
  ever add one credit row at a time.

## WhatsApp sharing (Phase 13)

- `packages/shared/src/whatsapp.ts` is pure, framework-free logic shared
  by both API and web: `buildInvoiceWhatsAppMessage` (assembles the
  fixed-field message text), `normalizeWhatsAppPhone` (strips everything
  but digits — wa.me links take a bare international number, no `+`,
  spaces, or dashes), and `buildWhatsAppClickToChatUrl` (the actual
  `https://wa.me/<digits>?text=<encoded>` link).
- `apps/api/src/lib/whatsapp` mirrors the `lib/storage` (logo) pattern:
  a `WhatsAppService` interface with one method (`buildShare`), a
  `getWhatsAppService()` factory/singleton, and exactly one
  implementation for V1 — `ClickToChatWhatsAppService`, which just wraps
  the shared link builder. No WhatsApp Business account, API key, or
  paid tier is needed for V1. Swapping in WhatsApp Business Cloud API
  later (server-side send, PDF as a real media attachment, delivery
  receipts) means adding one more class + changing the factory — nothing
  above this layer (the route, the invoice module) changes, since it
  only ever calls the interface.
- `apps/api/src/modules/invoices/whatsapp-share.service.ts` is the only
  place that assembles the message: it loads the invoice (ledger-derived
  amounts), the customer (for `customer.whatsapp` — already a field from
  Phase 4), and the company (for the message's byline), and 400s with
  `{ whatsapp: 'Customer has no WhatsApp number saved' }` if the
  customer has none. `GET /api/invoices/:invoiceId/whatsapp-share` is
  tenant-scoped the same as every other invoice route (cross-company →
  404).
- Frontend: `InvoiceTemplateView`'s toolbar has both "Download PDF" and
  a new "Share via WhatsApp" button. Share calls the endpoint above and
  `window.open()`s the returned wa.me url in a new tab — no attachment
  is sent automatically, since click-to-chat has no attachment support;
  the merchant downloads the PDF (already possible) and attaches it
  manually inside the opened chat. This split is deliberate, not a gap —
  it's what "no paid API for V1" implies, and it's exactly what a Cloud
  API swap later would remove by sending the PDF as media server-side.

## Known gotchas / things to check before starting work

- **Postgres cluster is often stopped** when a session starts:
  `pg_lsclusters` then `pg_ctlcluster 16 main start` if down. Dev DB
  `embroidery`, test DB `embroidery_test`, both owned by role `app`.
- **`npm test` at root** runs `@invoice/shared`'s tests, builds it, then
  runs `@invoice/api`'s tests (which imports the built shared package) —
  don't run `npm run test -w @invoice/api` alone without building shared
  first if shared changed.
- **Always run the full check sequence** after changes:
  `npm run typecheck && npm run lint && npm run build && npm test` (all
  from repo root). Every phase so far has ended with all of these green
  plus a live curl or Playwright smoke test against the built app.
- **`decimal.js` import**: must be `import { Decimal } from 'decimal.js'`
  (named import), not `import Decimal from 'decimal.js'` — the default
  import breaks under this repo's `NodeNext` + `esModuleInterop` tsconfig
  (`Cannot use namespace 'Decimal' as a type`).
- **CompanyProfileForm bug (fixed Phase 10)**: frontend forms that PATCH
  a partial-update endpoint must omit untouched blank fields, not send
  `""` — the backend's `optionalString` validators treat a
  present-but-empty string as "set this to empty" and reject it against
  min-length validation.
- **`requireJsonForMutations` middleware** (`apps/api/src/middleware/errors.ts`)
  allows `application/json` and `multipart/form-data` (needed for logo
  upload) for state-changing requests — relies on `SameSite=Lax` cookies
  for CSRF protection, not a `Content-Type` check alone.
- Build artifacts (`dist/`, `apps/api/uploads/`) are gitignored and get
  cleaned up after smoke tests — don't commit them.
- **PDF generation needs a Chromium binary** (`CHROMIUM_EXECUTABLE_PATH`).
  In this sandbox it's pre-installed at `/opt/pw-browsers/chromium` and
  already set in `apps/api/.env{,.test,.example}`. `playwright-core` (not
  `playwright`) is the dependency — it bundles no browser of its own on
  purpose, so a real deployment must set this env var to wherever its own
  Chromium lives (e.g. `npx playwright install chromium` as a build step).

## Testing conventions

- `node:test` + `supertest`, one file per module in `apps/api/test/`
  (`auth.test.ts`, `customers.test.ts`, `categories.test.ts`,
  `invoices.test.ts`, `ledger.test.ts`, `payments.test.ts`,
  `whatsapp.test.ts`, `tenant-isolation.test.ts`,
  `company-profile.test.ts`, `invoice-pdf-html.test.ts` — fast, no
  browser, tests the HTML string directly — and `invoice-pdf.test.ts` —
  full pipeline through a real headless Chromium, checks actual PDF
  magic bytes) and `packages/shared/test/formula-engine.test.ts`.
- Every module's tests include an explicit tenant-isolation case (cross-
  company access → 404) and, where relevant, a snapshot-immutability case.
- Real bugs have been found by writing these tests before assuming
  something works (migration race condition, decimal type-inference bug
  in `COALESCE($n, 0)`, ledger tenant-isolation leak, the profile-form
  blank-field bug above) — keep writing tests that actually exercise
  concurrency/edge cases, not just the happy path.
- Browser smoke tests use Playwright installed ad-hoc into `/tmp` (not a
  project dependency) against the built app + a running Postgres, with
  screenshots saved to `/tmp` and cleaned up after.

## Phase history (chronological)

1. Foundation: users/companies/company_members/sessions, session cookie auth
2. Multi-company membership: `/api/companies` list/create/switch
3. Company profile: full profile fields, logo upload (storage abstraction)
4. Customer module: CRUD, search, archive; opening_balance (decimal)
5. Embroidery categories: configurable name/rate/formula_type/formula_config
6. Formula engine: safe expression parser/evaluator, no eval(), decimal-safe
7. Invoice core: create/view/list, snapshots, safe per-company numbering
8. Customer ledger: OPENING_BALANCE/INVOICE/PAYMENT/ADJUSTMENT entries,
   balance always derived, invoice ledger-summary fields
9. Invoice creation UI: single-page form, live client-side preview
   (moved formula engine to `packages/shared` for this), keyboard-friendly
10. Invoice template engine: 5 selectable print designs, registry-based,
    default per company
11. Print & PDF: A4 print preview + browser print with correct margins
    and no split rows, plus a real downloadable PDF (headless Chromium,
    server-side, from saved snapshots) preserving the selected template
12. Payments: dedicated `payments` table + module, payment + ledger
    credit written in one transaction, reusable `PaymentForm` wired into
    customer page / invoice page / new Payments page, partial payments
    supported by construction (see "Payments (Phase 12)" above); removed
    the old ledger-embedded payment endpoint
13. WhatsApp sharing: free click-to-chat wa.me link (no paid API) behind
    a `WhatsAppService` interface, "Share via WhatsApp" button next to
    Download PDF on the invoice view (see "WhatsApp sharing (Phase 13)"
    above)

Repo also went through a monorepo restructure (`server/` → `apps/api` +
new `apps/web` + `packages/shared`) between Phase 1 and Phase 2.

## Not yet built (candidates for future phases)

- Expenses/outgoing payments (Phase 12 only covers customer payments
  received)
- WhatsApp Business Cloud API (paid, server-side send with the PDF as a
  real attachment) — V1 (Phase 13) is free click-to-chat only, behind
  `WhatsAppService` specifically so this is a provider swap later
- Invoice editing/cancellation (only create/view/list exist, by design —
  revisit only if explicitly requested)
- Reporting/dashboards, machines/production tracking (mentioned in the
  original product brief as later-phase modules)
