# Project memory — Embroidery Billing SaaS

Read this before making changes. It captures architecture, conventions, and
decisions from Phases 1–19 so future work stays consistent instead of
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
   session immediately. Route access is gated by permission, not role
   name — see "Role Permissions (Phase 17)" below; there is no
   `requireRole` anymore.
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
| invoices | `/api/invoices`, `.../pdf`, `.../whatsapp-share`, `.../duplicate` | create (all calc server-side)/list/view only — **no PATCH/edit**, by design; PDF and WhatsApp share are read-only derivations of a saved invoice; duplicate creates a brand-new draft via createInvoice itself, never a copy at the DB row level |
| ledger | `/api/customers/:customerId/ledger`, `.../payments`, `.../adjustments`, `.../statement`, `.../statement/pdf` | view ledger+balance, record a payment (credit) or adjustment (exactly one of debit/credit), and a full printable/PDF statement |
| audit | `/api/audit-logs` | owner/admin-only (`audit.view`); read-only, no tables written to besides `audit_logs` itself |
| dashboard | `/api/dashboard` | read-only summary (cards + recent lists) computed live from invoices/payments/ledger; no tables of its own |

Frontend: `apps/web/src/features/invoices/templates/` (Phase 10) — 5
selectable print-friendly invoice designs (Classic Navy, Modern Curve,
Minimal Clean, Industrial Blue, Premium Modern), all rendering the same
`InvoiceViewModel` (deliberately excludes formula/factor/multiplier/divisor
**and the per-item `rate`** — enforced by the type shape, not just by
convention; the internal embroidery rate is a business-internal value,
never customer-facing — see change request "hide internal rate", it's
still on the operational `InvoiceWithItems`/DB snapshot and used
server-side to calculate `amount`, just not carried into this view).
Customer-facing item columns are Description / Stitches / Amount.
Registry-based:
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

## Dashboard (Phase 14)

- `GET /api/dashboard?range=today|month|custom&from=&to=`
  (`apps/api/src/modules/dashboard`) is read-only — no new tables, every
  number comes from `invoices`/`invoice_items`/`payments`/`ledger_entries`
  at request time.
- "today"/"month" are resolved from the **database's** `CURRENT_DATE`,
  not `new Date()` in Node — one query
  (`SELECT CURRENT_DATE, date_trunc('month', CURRENT_DATE), ...`) so the
  dashboard's idea of "today" always matches what `invoice_date`/`date`
  columns default to. "custom" requires both `from` and `to` and rejects
  `from > to`.
- Two of the four cards (`invoiceAmount`, `paymentsReceived`) are scoped
  to the selected period; the other two (`totalReceivable`,
  `unpaidOrPartialInvoiceCount`) are deliberately **not** period-bound —
  they answer "how much is owed right now", consistent with the ledger
  being the one live source of truth for balances everywhere else in the
  app. Same split for the sections: Recent Invoices/Recent Payments are
  period-scoped, Customers With Outstanding Balance is current-state.
- `unpaidOrPartialInvoiceCount` applies real AR aging (FIFO: a
  customer's total payments/credits pay off their *oldest* debt first),
  not a naive "does this customer owe anything" check — the latter would
  flag every invoice for an indebted customer, even ones already paid
  off. It's one SQL query per company: a window function computes, per
  customer, the cumulative sum of debit ledger entries ordered
  newest-first, then compares that running sum (as of just before each
  entry) against the customer's current balance — entries reached before
  the running sum hits the balance are still (at least partly) unpaid.
  See the query and comment in `dashboard.service.ts` before changing
  ledger semantics elsewhere, since this logic depends on `created_at`
  ordering exactly the way `getBalanceBefore` in the ledger module does.
- Frontend: `apps/web/src/features/dashboard/DashboardPage.tsx` is now
  the **default landing tab** (`App.tsx`'s `DashboardTab` union gained
  `'dashboard'`, first in the tab list). Filter is three buttons
  (Today/This Month/Custom Range) plus From/To date inputs that only
  render for Custom.

## Invoice History (Phase 15)

- `GET /api/invoices` (the same endpoint since Phase 7) now returns
  `paid`, `balance`, and `paymentStatus` (`'PAID' | 'PARTIAL' | 'UNPAID'
  | 'CANCELLED'`) on every row, alongside the existing `totalAmount`
  ("Current Bill"). This is a **different status** from the invoice's
  own workflow `status` (draft/issued/cancelled) — `paymentStatus` is
  about money owed, `status` is about the invoice's lifecycle stage.
  Both are returned; don't confuse them when adding new UI.
- The FIFO/AR-aging math that produces `paid`/`balance`/`paymentStatus`
  per row lives in `invoice.service.ts`'s `listInvoices` — it's the same
  "pay off the oldest debt first" rule as the dashboard's
  `unpaidOrPartialInvoiceCount` (Phase 14), just computed per-row via a
  window function instead of aggregated into one count. **Watch the
  `COALESCE(o.cumulative_before, 0)` on a customer's very first debit
  row** — forgetting it once already produced silently-wrong `paid`
  amounts (Postgres's `GREATEST`/`LEAST` ignore `NULL` operands instead
  of propagating them, so a missing COALESCE there doesn't error, it
  just quietly returns the wrong number — caught only because the tests
  asserted exact FIFO values, not just "some value").
- New filters on the same endpoint: `from`/`to` (invoiceDate range),
  `paymentStatus`, `search` (invoice number or customer name, ILIKE).
  The FIFO CTEs are scoped only by `company_id` — every filter is
  applied in the outer `WHERE`, never by trimming which ledger rows feed
  the FIFO math, since a customer's paymentStatus needs their *entire*
  ledger to compute correctly.
- `POST /api/invoices/:invoiceId/duplicate` copies an invoice's items
  (category, description, stitches, and the item's own original `rate`
  — not the category's current default) into a brand-new draft by
  calling `createInvoice` itself, so it's impossible for a duplicate to
  accidentally carry over a payment or ledger entry: `createInvoice`
  only ever creates its own new ledger row. An item whose `categoryId`
  is null (the category was hard-deleted — `ON DELETE SET NULL`) is
  rejected up front with a clear reason, since there's nothing left to
  re-validate against.
- Frontend: `InvoiceTemplateView` gained an `initialAction?: 'print' |
  'download' | 'whatsapp'` prop so Invoice History's row buttons can
  reuse it wholesale (fetch the full invoice, open the template, let it
  auto-fire the action) instead of duplicating Print/PDF/WhatsApp logic.
  That prop's effect deliberately omits `handlePrint`/`handleDownload`/
  `handleShare` from its dependency array (they're plain function
  declarations redefined every render, not `useCallback`-memoized) and
  guards with a `useRef` flag so it fires exactly once; the actual call
  is deferred with `queueMicrotask` so the handler's own `setState`
  calls don't run synchronously inside the effect.
- No route can currently set `status = 'cancelled'` on an invoice — the
  CHECK constraint allows it (schema future-proofing from Phase 7) but
  nothing in this app exposes cancellation yet. If that's ever added, an
  invoice's own debit should be reversed in the ledger at cancellation
  time, or the FIFO math above will keep treating a cancelled invoice's
  original debt as real when computing every *other* invoice's
  paymentStatus.

## Customer Statement (Phase 16)

- `GET /api/customers/:customerId/ledger/statement` (+ `.../statement/pdf`)
  in `apps/api/src/modules/ledger/statement.service.ts`. Built straight
  from `ledger_entries`, joined to `invoices`/`payments` only to resolve
  a human-readable `reference` per row — nothing new is stored.
- **Ordering is deliberately different here from the rest of the app.**
  Everywhere else (`getBalanceBefore`, the dashboard's FIFO aging,
  invoice-history's FIFO aging), the ledger's true sequence is
  `created_at` — that's when a write actually happened, and it's what
  balance integrity depends on. A *statement*, though, is a document a
  business owner reads chronologically by transaction `date`, so this
  one query orders by `date` (created_at only as a same-day tiebreak)
  and computes its own running balance in that order. This is a
  statement-only display choice — it never changes how any balance is
  computed anywhere else. Don't copy this ordering into a balance
  calculation; don't copy `created_at` ordering into a *new* statement
  feature either — check which one you actually need.
- Entries dated before the `from` filter are folded into `openingBalance`
  but not shown; entries dated after `to` are dropped entirely, from
  both the row list and every summary number. The `type` filter (one of
  the four `LedgerEntryType`s) only narrows which rows come back —
  `openingBalance`/`invoiceTotal`/`payments`/`closingBalance` always
  reflect the whole selected date range regardless of it, since those
  answer "what happened this period", not "what's currently visible".
- Statement PDF reuses the exact same headless-Chromium pipeline as
  invoice PDFs (`playwright-core`, `page.pdf()` at A4) with its own
  single plain HTML layout in `apps/api/src/modules/ledger/pdf/` — no
  template registry, since a statement is an internal/accounting
  document, not a customer-facing branded design like an invoice.
- Frontend: `CustomerStatementView.tsx`, reachable via a "View Statement"
  button on the customer details page (`CustomerDetails.tsx` →
  `CustomersPage.tsx`'s new `'statement'` view). Print reuses the
  existing global `@page { size: A4; margin: 0 }` rule from Phase 11 —
  the same `print:hidden` toolbar convention as `InvoiceTemplateView`.

## Role Permissions (Phase 17)

- `packages/shared/src/permissions.ts` is the **one** place a role's
  capabilities are defined: `PERMISSIONS` (the fixed list — 13 strings
  as of this phase, e.g. `'invoice.view'`, `'customer.edit'`,
  `'company.manage'`) and `ROLE_PERMISSIONS: Record<Role, readonly
  Permission[]>`. `owner: PERMISSIONS` (the whole array itself, not a
  hand-copied subset) — a new permission added to the list is
  automatically granted to owner. `admin` is every permission except
  `users.manage`. `staff` is the operational set this app already
  granted any member before this phase (view/create/edit on customers,
  view/manage on formulas, view/create on invoices and payments) — no
  `company.manage`, no `users.manage`, and neither `invoice.edit` nor
  `invoice.cancel` (no route exposes either yet, since invoices still
  have no PATCH/edit or cancel endpoint — those two permissions exist
  ready for whichever future phase adds one).
- **This is plain RBAC, not a per-user ACL.** No permissions column
  exists on `company_members`; a permission is derived purely from
  `role` via `ROLE_PERMISSIONS`, every time, never stored per-user. If a
  future phase needs per-user overrides, that's a real schema/design
  change, not an extension of this map.
- `apps/api/src/middleware/permissions.ts`'s `requirePermission(...perms)`
  is the **only** place any route checks access — no route file ever
  inlines a role-name check (`role === 'owner'` etc.) itself.
  `requireRole` is gone entirely; its one former use
  (`company.routes.ts`) now calls `requirePermission('company.manage')`.
  Every route that touches a listed permission is gated: customers,
  categories/formulas, invoices (create/view/list/pdf/whatsapp-share/
  duplicate), payments, ledger (`customer.view` for reads,
  `payment.create` for `/adjustments` — the closest fit, since a manual
  ledger correction is a money movement like a payment, just from a
  different entry point), and the dashboard (`invoice.view`, since
  that's most of what it summarizes).
- `GET /api/auth/me` returns `permissions: Permission[]` alongside
  `role` (computed server-side from `ROLE_PERMISSIONS`, added to `Me` in
  `packages/shared/src/entities.ts`). The frontend must always read
  `me.permissions`, never re-derive access from `me.role` — see
  `CompanyProfilePanel.tsx`, which used to hardcode
  `role === 'owner' || role === 'admin'` and now checks
  `permissions.includes('company.manage')`.
- **Gotcha found and fixed in this phase**: adding a *second* Express
  handler to a route that used to have only one (`router.get(path,
  requirePermission(...), handler)`) breaks TypeScript's usual
  literal-path narrowing of `req.params` down to plain `string` values —
  it falls back to `ParamsDictionary`'s real index signature, `string |
  string[]` (there to support wildcard routes elsewhere in Express).
  `requireUuidParam` in `apps/api/src/lib/validate.ts` now takes
  `unknown` and checks `typeof value === 'string'` itself rather than
  assuming the shape — do the same in any new validator that reads
  `req.params` on a route with more than one handler.

## Audit Log (Phase 18)

- `audit_logs` (migration `008_audit_logs.sql`): append-only, same
  spirit as `ledger_entries` — company_id, user_id (nullable, `ON DELETE
  SET NULL`), action, entity_type, entity_id, metadata (jsonb),
  created_at. One index on `(company_id, created_at DESC)`.
- `apps/api/src/modules/audit/audit.service.ts`'s `postAuditLog(client,
  entry)` is the **only** way a row is ever written — always called
  with the *same* transaction client as the write it's auditing (same
  convention as `postLedgerEntry`), so an audit entry and the change it
  describes commit or roll back together. It's one indexed INSERT, no
  triggers, no synchronous computation — that's what keeps it from
  affecting core transaction performance, not some separate async
  queue. **Do not** make this fire-and-forget or move it outside the
  transaction "for performance" — the whole point is that a lightweight
  synchronous insert inside an existing transaction is already cheap
  enough; a best-effort side channel would just risk the audit trail
  drifting from what actually happened.
- Where each action fires: `createInvoice` → `INVOICE_CREATED`
  (`duplicateInvoice` reuses this same path, so a duplicate is also
  `INVOICE_CREATED`, with `duplicatedFromInvoiceId`/
  `duplicatedFromInvoiceNumber` in metadata — not a separate action
  type); `createPayment` → `PAYMENT_CREATED`; `updateCategory` →
  `RATE_CHANGED` and/or `FORMULA_CHANGED`, **only when those specific
  fields actually changed** (compared against one cheap indexed SELECT
  of the pre-update row, inside the same transaction — a name-only edit
  logs neither); `updateCompany` → `COMPANY_SETTINGS_CHANGED`, with
  `metadata.changedFields` naming whichever patch fields were provided
  (not a full old/new diff — several profile fields are free text, so
  "what changed" is the useful fact here). `INVOICE_EDITED`,
  `INVOICE_CANCELLED`, and `PAYMENT_EDITED` are defined in the fixed
  action list (`packages/shared/src/audit.ts`) but **nothing posts them
  yet** — same "no route exists yet" situation Phase 17 already left
  `invoice.edit`/`invoice.cancel` in (invoices still have no PATCH/edit
  or cancel endpoint, payments have no edit endpoint). Wire these up
  the moment those routes are added, not before.
- `GET /api/audit-logs` is gated by a new `audit.view` permission
  (added to `packages/shared/src/permissions.ts`'s `PERMISSIONS`).
  Owner gets it automatically (owner is `PERMISSIONS` itself); admin
  gets it automatically too (admin is `PERMISSIONS` minus
  `users.manage` — no new rule needed); staff's explicit list doesn't
  include it. This is "Owner/Admin can view logs" with zero new
  authorization code, just one more string in the Phase 17 map.
- Frontend: the Audit tab in `App.tsx` only renders when
  `me.permissions.includes('audit.view')` — invisible to staff, not
  just blocked after a failed request.

## Security Audit (Phase 19)

A full audit against authentication, authorization, tenant isolation,
formula calculations, invoice snapshots, ledger balances, payment
transactions, decimal handling, input validation, SQL injection, XSS,
rate limiting, and error handling. Two confirmed, fixed issues; every
other area was already sound (see the commit message for the specific
reasoning per area — it's not repeated here). Don't re-litigate the
areas confirmed clean without a new, concrete reason to suspect them.

- **Rate limiting** (`apps/api/src/middleware/rate-limit.ts`): 10
  requests/15min on `POST /api/auth/login`, 10/hour on `.../register`,
  via `express-rate-limit` (in-memory — no Redis/shared store to run).
  **Disabled only via `RATE_LIMIT_DISABLED=true`, set only in
  `.env.test`** — the test suite legitimately registers/logs in far
  more than a real client would in the same window (some single test
  files alone do 10+ registrations). Never set this in a real `.env` or
  `.env.example`'s default (`.env.example` documents it as `false`).
  The middleware's actual 429 behavior is verified for real in
  `test/security.test.ts`, against a throwaway Express app — not
  against the shared `app` fixture, since that one runs with limiting
  off.
- **`register()`'s duplicate-email race** (`auth.service.ts`): the
  existing SELECT-then-INSERT check has a narrow window where two
  concurrent registrations with the same email can both pass the
  SELECT before either INSERT commits. Fixed by catching Postgres
  error code `23505` (unique_violation, from the existing
  `users_email_key` index on `lower(email)`) and converting it to the
  same `conflict()` 409 a non-concurrent duplicate already gets,
  instead of letting a raw constraint error fall through to the
  generic 500 handler.
- New `test/statement-pdf-html.test.ts` mirrors the existing (Phase 11)
  `test/invoice-pdf-html.test.ts` pattern — fast, Chromium-free HTML
  assertions including XSS escaping — for the statement HTML renderer
  (Phase 16), which had no equivalent direct test before.
- If a future phase adds a new HTML-string-building renderer (not a
  React/JSX view — those are already safe by construction), give it the
  same `escapeHtml()`-on-every-interpolated-value treatment as
  `render-html.ts`/`render-statement-html.ts`, and a matching
  `-pdf-html.test.ts` escaping test — this is the one place in the app
  where XSS is actually possible, since everything else renders through
  React's default escaping.

## Production Deployment (Phase 20)

Prepared the existing app to run in production without rebuilding
anything. See `DEPLOYMENT.md` at the repo root for the operator-facing
guide (env vars, backups, health checks, startup) — not repeated here.

- **`config.ts`** gained `nodeEnv`/`isProduction`/`isTest` (from
  `NODE_ENV`, default `development`), `serveFrontend` (`SERVE_FRONTEND`,
  default off), `webDistDir`. A startup `console.warn` fires if
  `NODE_ENV=production` and `COOKIE_SECURE` isn't `true` — loud
  misconfiguration beats a silent plain-HTTP session cookie.
- **Health endpoints**: `GET /api/health` (liveness, never touches the
  DB) vs `GET /api/health/ready` (readiness, runs `SELECT 1`, 503 if
  unreachable) — standard k8s/orchestrator split, both unauthenticated.
- **Request-id correlation**: `middleware/logging.ts`'s `requestLogging`
  reuses an incoming `X-Request-Id` header (from an upstream proxy) or
  generates one via `randomUUID()`, echoes it in the response header,
  and logs one structured JSON line per request (method/path/status/
  duration — **never** body/headers/cookies). Suppressed only under
  `NODE_ENV=test` (the log line, not the id assignment) to keep `npm
  test` output readable — see `.env.test`'s new `NODE_ENV=test` line.
- **Error reporting**: `lib/error-reporter.ts` — an `ErrorReporter`
  interface + default `ConsoleErrorReporter` (structured JSON to
  stderr, includes requestId/stack, never sent to the client) + a
  `getErrorReporter()` factory, same pluggable-interface shape as
  `LogoStorage`/`WhatsAppService`. Swapping in a real monitoring SDK
  later is an implementation swap in the factory, not a call-site
  change. `errorHandler` (`middleware/errors.ts`) now includes the
  `requestId` in every 500 response body for client-side correlation.
- **Graceful shutdown**: `index.ts` now handles `SIGTERM`/`SIGINT` —
  stop accepting connections (`server.close()`), let in-flight requests
  finish, close the DB pool, exit; forced-exit safety net after 10s.
  Verified for real by sending SIGTERM to a running production-mode
  process and confirming a clean exit with the expected log lines.
- **Optional single-process frontend serving**: `app.ts`, gated behind
  `SERVE_FRONTEND=true` (never inferred from whether `apps/web/dist`
  happens to exist, so it can never change behavior incidentally — e.g.
  in tests, which build/clean that directory independently). Serves
  `apps/web/dist` via `express.static` + an SPA fallback to
  `index.html` for any non-`/api`, non-`/uploads` GET. Verified live:
  built the app, ran the API with `SERVE_FRONTEND=true` in production
  mode, and drove register → login → session-persists-on-reload through
  a real Chromium via Playwright with zero console errors.
- **`apps/api/package.json`'s `start` script** now uses
  `node --env-file-if-exists=.env` (not `--env-file=.env`) — a real
  deployment injects env vars via the platform/orchestrator and has no
  `.env` file on disk; the old flag would crash on boot in that case.
  Root `package.json` gained a matching `start` script.
- **`scripts/backup.sh` / `scripts/restore.sh`**: thin wrappers around
  `pg_dump --format=custom` / `pg_restore`, reading `DATABASE_URL` from
  the environment like the app itself — no hard-coded credentials.
  `restore.sh` prompts for confirmation before overwriting. Verified
  live: backed up the dev DB, restored into a scratch DB, confirmed the
  round-trip.
- New `test/production-readiness.test.ts` (6 tests): both health
  endpoints, `X-Request-Id` header format + echo-back, a 500 response's
  `requestId` matches the header and leaks no internals, health
  endpoints need no auth. The `SERVE_FRONTEND` static-serving path is
  **not** covered by an automated test — `config` freezes at
  module-import time from `.env.test` (where it's off), so toggling it
  mid-test-run isn't practical; it's covered by the live Playwright
  smoke test instead, same as every other phase's browser-only checks.

## Invoice Archive / Delete (Phase 21)

Invoice lifecycle actions: archive/unarchive (visibility only) and a
hard delete that's only ever allowed when it can't corrupt accounting
history.

- **`archived_at timestamptz NULL`** (+ `archived_by uuid`) on
  `invoices` — deliberately a separate nullable column, not folded into
  the existing `status` enum (draft/issued/cancelled). Archiving never
  touches `ledger_entries`, `invoice_items`, or `payments`, so every
  balance/statement/dashboard figure (all derived from those tables
  directly, never from `status` or `archived_at`) is identical before
  and after archiving an invoice — archiving is visibility only, never
  an accounting reversal.
- **`GET /api/invoices?archived=active|archived|all`** — defaults to
  `active` (archived hidden) when the param is omitted. Implemented as
  one extra WHERE clause in `listInvoices`'s existing CTE query, not a
  separate code path.
- **Hard delete rule** (`deleteInvoice`): allowed only when
  `status === 'draft'` AND this invoice's own FIFO-allocated `paid`
  amount is exactly `'0.00'` — the same per-invoice paid computation
  `listInvoices`/Invoice History already use (factored out as
  `getInvoicePaidAmount`), not a new concept. **Every invoice, including
  drafts, posts its own `INVOICE` ledger debit at creation** (see
  Phase 6/7 — there's no separate "post to ledger on issue" step in
  this app), so "has ledger impact" can't be the delete gate the way a
  naive reading might suggest; the FIFO-paid-amount check is what
  actually protects payment history, since it's zero exactly when no
  payment has been allocated to this invoice yet. When allowed, the
  invoice's own `INVOICE` ledger entry (and only that one row — scoped
  by `type = 'INVOICE' AND reference_id`) is deleted in the same
  transaction as the invoice row; `invoice_items` cascades via its
  existing FK. A `PAYMENT`/`ADJUSTMENT` ledger row is never touched by
  a delete, by construction — those entries never reference an invoice.
- **New permissions**: `invoice.archive`, `invoice.delete` — owner/admin
  only, same tier as the pre-existing (still-unused) `invoice.edit`/
  `invoice.cancel`. Both archive and unarchive are gated by the one
  `invoice.archive` permission (unarchive is just archive's reverse).
- **New audit actions**: `INVOICE_ARCHIVED`, `INVOICE_UNARCHIVED`,
  `INVOICE_DELETED` — each posted in the same transaction as its
  mutation, with `invoiceNumber` (and `totalAmount` for delete) in
  metadata, same convention as every other audit entry.
- **Frontend**: `InvoiceList.tsx` gained an Active/Archived/All tab row
  and Archive/Restore/Delete row actions, each behind a
  `window.confirm(...)` with the exact wording the phase spec gave.
  Delete-button visibility is computed client-side from
  `InvoiceListEntry.status === 'draft' && paid === '0.00'` — the exact
  same rule the backend enforces, using data the list already returns,
  so a visible Delete button is never one the server would reject.
  `me.permissions` (already returned by `/api/auth/me`, previously only
  consumed by `CompanyProfilePanel`/the audit tab) is now also threaded
  into `InvoicesPage`/`InvoiceList` to gate Archive/Delete — this app
  still has no frontend RBAC framework beyond "show a button only if
  the permission is present, let the backend be the real enforcer."

## Customer Unarchive / Restore

The customer module already had `status: 'active' | 'archived'` (a
different pattern from the invoice module's `archived_at timestamptz`,
kept as-is per module rather than unified) and a working `POST
/:customerId/archive`, an `Archive` button, and a working Active/
Archived/All list filter — but archiving a customer was a one-way door:
nothing in the UI or API could bring one back.

- **`unarchiveCustomer(companyId, userId, customerId)`**
  (`customer.service.ts`) — the exact mirror of `archiveCustomer`: sets
  `status = 'active'`, wrapped in `withTransaction` with a
  `CUSTOMER_UNARCHIVED` audit entry in the same transaction. Same as
  archive, this only ever flips `status`; `opening_balance`,
  `ledger_entries`, invoices, and payments are never touched, and the
  customer row itself is never duplicated or replaced.
- **`POST /api/customers/:customerId/unarchive`** — same `POST` verb
  and `customer.edit` permission gate as the existing `/archive` route
  (kept consistent with this module's own convention rather than
  switching to `PATCH`).
- **New audit actions**: `CUSTOMER_ARCHIVED`, `CUSTOMER_UNARCHIVED` (the
  first was added now too — archiving a customer had no audit entry
  before this). Both need entries in `AuditLogPage.tsx`'s
  `ACTION_LABEL`/`ENTITY_LABEL` maps (along with `'customer'` in
  `ENTITY_LABEL`) since those are typed as exhaustive
  `Record<AuditAction/AuditEntityType, string>` — this is the second
  time in this repo's history that extending `AUDIT_ACTIONS`/
  `AUDIT_ENTITY_TYPES` without touching this file broke the web
  typecheck (`TS2739`/`TS2741`); check this file every time either const
  array grows.
- **Frontend**: `CustomerDetails.tsx` now branches on `customer.status`:
  `Edit`+`Archive` show only when `active`; a new `Restore / Unarchive`
  button shows only when `archived`; `View Statement` always shows
  regardless of status, since statement/ledger/invoice history must stay
  reachable for archived customers. Both actions are behind
  `window.confirm(...)` with exact wording:
  `"Archive this customer? Existing invoices, payments and ledger
  history will remain."` and `"Restore this customer to the active
  customer list?"`.
- **No new work needed for dropdown reappearance**: `CreateInvoiceForm.tsx`
  and `PaymentForm.tsx` already call `listCustomers({ status: 'active' })`
  fresh on mount, so an unarchived customer reappearing there is an
  emergent property of always querying live, not something that had to
  be coded.
- **`CustomerList.tsx`'s Active/Archived/All filter and the backend's
  `GET /api/customers?status=...` already existed** exactly as needed —
  neither required any change for this fix.

## Windows Build Script

`apps/api`'s build script used to be `tsc && cp -r src/migrations
dist/`, which fails on Windows (`cp` isn't a recognized command there).
Replaced with `tsc && node scripts/copy-migrations.mjs`, a small script
using Node's builtin `fs.cpSync({ recursive: true })` — no new
dependency, works identically on Windows/Linux/macOS. Avoid
`cp`/`xcopy`/`robocopy` or any other OS-specific shell command in npm
scripts going forward; use a small `.mjs` script with Node builtins
instead.

## Invoice Discount + Lot Number

Two invoice-level fields added to `invoices` (migration
`010_invoice_discount_lot.sql`): `lot_number text NULL` (free text, no
uniqueness constraint — searchable via the invoice list's existing
`search` param, which now also matches `lotNumber`) and a discount
snapshot — `discount_type text NULL CHECK (IN ('percentage','fixed'))`,
`discount_value numeric(12,2)`, `discount_amount numeric(14,2)`.
`discount_type IS NULL` means no discount at all, not just "0%".

- **`grandTotal` is the load-bearing new concept**: `subtotal` (the
  existing `totalAmount`, sum of item totals) minus `discountAmount`.
  Like `totalAmount` itself, `grandTotal` is never stored — it's cheap
  to derive on every read since `discountAmount` (the snapshot) and the
  items it summarizes are both fixed once written.
  **The ledger debit, `buildLedgerSummary`'s `previousBalance`/
  `totalReceivable`, the dashboard's "invoiced" figures, and the
  WhatsApp share message all use `grandTotal`, never `totalAmount`** —
  a discounted invoice must never bill, or count as revenue, more than
  what the customer actually owes. `invoice.service.ts`'s
  `calculateDiscount(subtotal, discountType, discountValue)` is the one
  authoritative place this is computed and validated (negative
  rejected; percentage clamped to 0–100; fixed clamped to ≤ subtotal) —
  the frontend's `previewDiscount` in `preview.ts` mirrors it for live
  feedback only, and is never trusted.
- **Zero-total edge case**: a 100%-discount invoice has `grandTotal =
  "0.00"`, and `ledger_entries` has a check constraint requiring exactly
  one of `debit`/`credit` to be positive — there is nothing to post.
  `createInvoice` skips posting a ledger entry entirely when
  `grandTotal === '0.00'`; `updateInvoice` deletes the existing entry if
  editing down to zero, and re-creates one (via `postLedgerEntry`, a
  fresh row — this is the one case where FIFO-order-preservation below
  doesn't apply, since there's no existing row to preserve) if editing
  back up from zero. `getInvoice`'s ledger lookup already had a
  defensive "not found" fallback from Phase 8 that made this safe
  without further changes.
- **Draft invoice editing didn't exist before this phase** — memory.md
  previously said so explicitly ("Invoice editing... only create/view/
  list exist, by design"). Added `updateInvoice` + `PATCH
  /api/invoices/:id`, gated by the pre-existing (previously unused)
  `invoice.edit` permission, owner/admin only. Only `status === 'draft'`
  is editable; the customer can't be reassigned (duplicate instead).
  Items are fully replaced (delete + recreate), same as create. The
  invoice's own ledger entry is **updated in place** (`UPDATE
  ledger_entries SET debit/date/notes ... WHERE reference_id = $1`), not
  deleted-and-reposted, specifically so its `created_at` — and therefore
  its position in every customer's FIFO payment allocation — never
  shifts just because the invoice was edited.
- **`duplicateInvoice`**: copies `discountType`/`discountValue` (a
  duplicate is usually "the same order again") but never `lotNumber` —
  each new batch/job is expected to get its own lot number.
- **Frontend**: `CreateInvoiceForm.tsx` now does double duty — an
  `invoice?: InvoiceWithItems` prop switches it into edit mode (prefills
  from the draft, customer select becomes a disabled text field, submits
  via `PATCH` instead of `POST`); `InvoicesPage.tsx` gained an `'edit'`
  view. `InvoiceDetails.tsx` shows an Edit link only when
  `status === 'draft'` and `permissions.includes('invoice.edit')`.
  `InvoiceList.tsx`'s "Current Bill" column was renamed "Grand Total"
  and a "Lot #" column added.
- **Print/PDF**: `InvoiceViewModel` (packages/shared) gained
  `lotNumber`, `subtotal`, `discountType`/`discountValue`/
  `discountLabel`/`discountAmount`, `grandTotal`, replacing the old flat
  `currentBill` field. All 5 React templates and the server-side
  `render-html.ts` (used for the actual PDF download — a separate
  hand-rolled HTML template, not the React ones; browser Print uses the
  React templates directly) show Lot # near
  the invoice number/date and a Subtotal/Discount/Grand Total block; the
  discount row is omitted entirely (not shown as "Rs 0.00") when
  `discountType` is null.

## Per-Item Quantity

Every category/line on an invoice now has its own quantity (e.g.
BAZU=12, FRONT=8, DUPATTA=15) — the original design had exactly one
`invoices.quantity` shared by every item, which was wrong for this
business (different embroidery jobs on the same invoice are genuinely
different batch sizes).

- **`invoice_items.quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK
  (quantity > 0)`** (migration `011_invoice_item_quantity.sql`).
  Backfilled from each item's *parent invoice's* old quantity, not a
  blanket "1" — that's the value each existing item's `calculated_total`
  was actually computed with, so the backfill keeps historical totals
  internally consistent with the now-visible per-item quantity.
- **`invoices.quantity` is obsolete** — the column stays (still `NOT
  NULL`, now `DEFAULT 1`) so nothing breaks, but the app never reads,
  writes, or displays it anymore: dropped from `INVOICE_HEADER_COLUMNS`,
  the `Invoice`/`InvoiceListEntry`/`InvoiceWithItems` types, every
  INSERT/UPDATE, `InvoiceViewModel`, all 5 print templates, and the PDF
  renderer. If a future phase decides the column can be dropped
  entirely, check nothing external reads it first (this app's own code
  no longer does).
- **`InvoiceItemInput.quantity` is optional, defaulting to `"1"`** when
  omitted (`createInvoiceItem` in `invoice.service.ts`) — this is why
  the huge existing test suite (every other test file's invoices, all
  written pre-Phase-24 with an invoice-level `quantity: '1'`) kept
  passing unchanged: an omitted/absent item quantity behaves exactly
  like the old default. Only tests that used a *non-1* invoice-level
  quantity needed updating, by moving that value onto the item(s).
- **Formula engine**: `calculationInputs.quantity` is now each item's
  own quantity, computed and validated independently per item in
  `createInvoiceItem`'s loop — there is no shared "invoice quantity"
  anywhere in the calculation path anymore. Editing one item's quantity
  (draft edit, full item-list replace) never touches another item's
  stored `calculated_unit_amount`/`calculated_total`, since each item is
  entirely recalculated from its own input row.
- **`duplicateInvoice`**: copies each item's own `quantity` (a duplicate
  is "the same order again", batch sizes included) — this is separate
  from lot number, which is deliberately never copied (see "Invoice
  Discount + Lot Number" above).
- **Frontend**: `CreateInvoiceForm.tsx`'s `ItemRow` gained its own
  `quantity` field (default `'1'` for a new row); the invoice-level
  Quantity input and state are gone entirely. The item table's column
  order is `Category | Description | Quantity | Stitches | Rate |
  Amount`, matching the print/PDF `Description | Quantity | Stitches |
  Amount` order (Rate is print/PDF-internal only, never shown to the
  customer — see the "don't show calculation internals" note in
  `invoice-view-model.ts`). `InvoiceDetails.tsx` and all 5 templates +
  `render-html.ts` show a Quantity column and no longer show a
  standalone "Quantity: xxx" line near the customer/address block.

## Lot Number in Print/PDF — verification pass

A bug report claimed lot number wasn't showing in print/PDF/some
templates. Full inspection (schema → `getInvoice` → shared types →
`buildInvoiceViewModel` → `render-html.ts` → all 5 React templates) plus
a live Playwright run through create → details → every template in the
print preview → PDF download found it already correct end-to-end — this
was fully wired in the same phase that added lot number (see "Invoice
Discount + Lot Number" above) and untouched by the later per-item
quantity refactor. No code change was needed. What changed instead:
added `packages/shared/test/invoice-view-model.test.ts` (`buildInvoiceViewModel`
maps a lot number through, and maps null as null, not `""`) and two
`invoice-pdf-html.test.ts` cases (every PDF theme hides the Lot # row
when null, every theme shows it when set) — the render-html Lot #
row's `invoice.lotNumber ?` conditional existed but had no test that
specifically covered the null-hides-the-row case in isolation. If this
ever regresses, check that the failure is really in one of the six
layers listed above and not stale `apps/web/dist`/`apps/api/dist` build
output — `npm run build` before checking again.

## WhatsApp Sharing

"Share via WhatsApp" opened WhatsApp but the recipient/message were
often wrong and the PDF was never attached. Root causes and the fix:

- **Phone normalization never converted a Pakistani local number.**
  `normalizeWhatsAppPhone` (packages/shared/src/whatsapp.ts) only
  stripped non-digit characters — a saved number like `"03001234567"`
  stayed `"03001234567"` (still leading `0`, not a valid international
  number), so the wa.me link resolved to the wrong (or no) recipient.
  Fixed: after stripping to digits, a number matching `/^0\d{10}$/`
  (exactly 11 digits, leading 0 — the shape of a Pakistani mobile
  number) has that leading 0 swapped for the country code `92`. Any
  other digit string (already-international, or some other country's
  local format — e.g. the existing 10-digit-no-leading-zero test case)
  passes through unchanged: there's no reliable way to guess a country
  code otherwise, and guessing wrong silently messages the wrong person.
  New `isValidWhatsAppPhone` (`/^\d{8,15}$/` on the normalized result)
  is checked before ever building a link — a missing or junk number now
  throws **exactly** `"Customer WhatsApp number is missing or
  invalid."` (both the empty-string and the too-short/junk case use
  this one message) instead of silently opening a blank/broken
  WhatsApp window.
- **The frontend never attached the PDF.** A wa.me/click-to-chat link
  can prefill a recipient and message text but can never attach a
  local/generated file — that's a hard platform limitation, not a bug
  to work around. `InvoiceTemplateView.tsx`'s `handleShare` used to
  just open the link with nothing else; it now downloads the invoice
  PDF first (same `downloadPdf` helper the Download button uses), only
  *then* opens WhatsApp, and shows: *"Invoice PDF has been downloaded.
  Attach the downloaded PDF in WhatsApp before sending."* If the PDF
  download itself fails, WhatsApp is **not** opened automatically — an
  error shows with an explicit "Send text only (without PDF)" link,
  the one escape hatch to text-only sharing, rather than the app
  silently choosing that for the user.
- **Optional WhatsApp Business Cloud API**, prepared but off by
  default: `lib/whatsapp/business-cloud-api-whatsapp-service.ts`
  uploads the PDF to Meta's Graph API media endpoint, then sends it as
  a `document` message directly to the customer — filename = the
  downloaded PDF's own `{invoiceNumber}-{customerName}.pdf` convention,
  caption = the invoice number. Activates only when
  `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are both set
  (`WHATSAPP_API_VERSION` defaults to `v21.0`) — see
  `lib/whatsapp/index.ts`'s `getWhatsAppService()`. Never throws: a
  failed send comes back as `{ mode: 'business-api', status: 'failed',
  error }`, and **every** payload (both modes) always also carries a
  click-to-chat `url` as a manual fallback, so the frontend has
  something actionable even when the automatic send fails.
- **`WhatsAppSharePayload.toPhone` is now the normalized number**, not
  whatever raw string the customer's `whatsapp` field held — this
  changed what the API returns (a customer test that asserted the raw
  input echoed back needed updating).
- **No localhost links in the message, ever.** A PDF link line
  (`PDF invoice: <url>`) is only added to the WhatsApp message text
  when `PUBLIC_BASE_URL` is configured *and* isn't a `localhost`/
  `127.0.0.1` address (`buildPublicPdfUrl` in
  whatsapp-share.service.ts, exported specifically so this can be unit
  tested without touching real env vars) — otherwise the line is
  omitted entirely, never rendered with a broken/unusable link. A
  phone can never open `http://localhost:4000/...`.
- **Message wording** changed to `"Assalam-o-Alaikum {customer},\nYour
  invoice {number} from {company} is ready.\n\n..."` (was `"Hi
  {customer}, Here is your invoice..."`) — `"Invoice Amount:"` became
  `"Invoice Total:"` to match the requested wording; Previous
  Balance/Paid Amount/Current Balance lines are unchanged.

## PDF Generation Hardening

A user hit "The generated PDF was empty — please try again." on both
the Download PDF and Share via WhatsApp buttons. The frontend
(`downloadPdf.ts`) was already correct — it already does
`fetch` + `arrayBuffer()`, checks `byteLength > 0`, and checks the
`%PDF-` magic bytes before ever handing anything to the browser, per
this app's existing convention; that's exactly how it caught the
problem in the first place. The bug was that the *backend* could
respond `200 OK` with an empty body: `chromium.launch()`/`page.pdf()`
can resolve "successfully" with 0 bytes (or truncated/corrupt output)
instead of throwing, most commonly in a container where the default
`/dev/shm` (64MB) is too small for Chromium's shared-memory needs —
and nothing downstream ever checked the buffer before sending it.

- **`apps/api/src/lib/pdf/render-pdf.ts`** (new) — the one place both
  invoice PDFs (`invoices/pdf/pdf.service.ts`) and statement PDFs
  (`ledger/pdf/statement-pdf.service.ts`) launch Chromium; previously
  each had its own near-identical copy of this logic. Chromium now
  launches with `--disable-dev-shm-usage` added alongside the existing
  `--no-sandbox` (the standard fix for the failure mode above — tells
  Chromium to spill to `/tmp` instead of the too-small `/dev/shm`).
  After `Buffer.from(pdfBytes)`, it now **always** checks
  `buffer.length > 0` and that the first 5 bytes are `%PDF-` before
  returning — if either check fails, it throws a descriptive `Error`
  instead of returning the bad buffer. That throw reaches the existing
  error middleware (`middleware/errors.ts`), which already logs the
  full message+stack via `getErrorReporter()` before returning a
  generic 500 to the client — so this failure mode is now loud and
  logged server-side instead of a silent "successful" empty download.
- **Dev-only diagnostic logging** at every stage of invoice PDF
  generation (`[pdf] generating invoice PDF: ...`, `rendered HTML is N
  bytes`, `page.pdf() returned N bytes`, `final buffer is N bytes`,
  and the existing pre-`res.end` `[invoice pdf] {filename}: N bytes`
  in `invoice.routes.ts`) — gated on `config.nodeEnv === 'development'`
  so none of this appears in production or test output, but running
  locally now makes it obvious exactly which stage produced how many
  bytes if this ever needs to be re-diagnosed.
- **Tests**: `invoice-pdf.test.ts` gained a test combining lot number +
  per-item quantity + discount through the full HTTP route (status,
  content-type, Content-Length > 0, `%PDF-` magic bytes) and a test
  calling `generateInvoicePdf` directly. `statement-pdf.test.ts` and
  the rest of `invoice-pdf.test.ts` already covered the magic-bytes/
  non-empty checks at the route level and continue to pass unchanged
  through the shared helper.
- If this resurfaces: check the dev logs first (which stage reports 0
  bytes, or does an exception appear at all), then verify the
  Chromium executable actually exists/runs at
  `CHROMIUM_EXECUTABLE_PATH` in that environment — `render-pdf.ts`'s
  guard turns a bad launch into a real, visible error either way, so a
  recurrence now always means "look at the server log for this
  request," never "guess why the download UI complained."

## Delete Payment Safely

There was no way to remove a recorded payment — a data-entry mistake
(wrong amount, wrong customer, duplicate) stuck permanently. Added a
safe delete that reverses the payment's accounting effect, not just the
row, in one transaction.

- **`apps/api/src/modules/payments/payment.service.ts`** — new
  `deletePayment(companyId, userId, paymentId)`. `FOR UPDATE` on the
  `payments` row does triple duty: locks against a doubled click,
  enforces tenant isolation, and doubles as the existence check (missing
  or foreign id → `notFound`, i.e. a 404). Inside the same transaction:
  deletes the payment's own `ledger_entries` row (scoped tightly by
  `type = 'PAYMENT' AND reference_id = paymentId`, so an INVOICE or
  ADJUSTMENT entry is never touched even by accident), deletes the
  `payments` row, then posts a `PAYMENT_DELETED` audit entry with a
  snapshot (customerId, amount, date, paymentMethod, reference, notes)
  captured before the delete. This mirrors `invoice.service.ts`'s
  `deleteInvoice` precedent exactly — a tightly-scoped hard delete, not
  a reversal ledger entry, since that's this codebase's own established
  pattern for lifecycle deletions (despite `ledger.service.ts`'s own
  "insert-only" comment, which only describes its own exported
  functions).
- **Nothing else had to change to make invoice/customer figures
  correct.** Payments have no `invoice_id` column — every invoice's
  paid/balance/paymentStatus is always FIFO-derived live from the whole
  ledger on read (Phase 15), and every customer balance is always
  computed live too (Phase 8). Deleting the ledger credit is the entire
  reversal; the next read of any affected invoice or statement
  recalculates correctly with no separate recompute step.
- **`DELETE /api/payments/:paymentId`** (`payment.routes.ts`), gated by
  a new `payment.delete` permission — owner/admin only by omission from
  `ROLE_PERMISSIONS.staff`, same tier as `invoice.archive`/
  `invoice.delete` (reversing a recorded payment is a correction, not
  day-to-day data entry). Returns `{ deleted: true, id }`, not a bare
  204, matching `deleteInvoice`'s response shape.
- **No locked/closed accounting period concept exists anywhere in this
  schema** (confirmed by inspection) — so there's nothing to gate on
  beyond tenant isolation + the permission check above.
- **Frontend**: a permission-gated Delete action (`permissions.includes
  ('payment.delete')`) in both the main Payments list
  (`PaymentsPage.tsx`) and the customer-embedded ledger panel
  (`CustomerLedgerPanel.tsx`, on PAYMENT-type rows only, keyed off
  `entry.referenceId`), each with the exact confirm text: "Delete this
  payment? The related ledger entry and balances will be updated. This
  action cannot be undone." `permissions` is now threaded all the way
  through `App.tsx` → `CustomersPage.tsx` → `CustomerDetails.tsx` →
  `CustomerLedgerPanel.tsx` (previously none of these three received it,
  unlike `InvoicesPage`) and `App.tsx` → `PaymentsPage.tsx` directly.
- **Tests** (`apps/api/test/payment-delete.test.ts`): normal delete;
  ledger-entry scoping (only the deleted payment's credit is removed,
  siblings untouched); customer balance updates immediately; a payment
  that fully paid an invoice reverting PAID → UNPAID; a partial-payment
  case (deleting one of two payments keeps PARTIAL with the right
  amountPaid/currentBalance, deleting the last one reaches UNPAID);
  tenant isolation (cross-company delete → 404, no effect on the
  victim's data); permissions (staff 403, admin 200); audit log
  (PAYMENT_DELETED with full snapshot metadata); deleting a nonexistent
  payment (404); auth required. `paymentStatus` isn't on the invoice
  detail response (`GET /api/invoices/:id` returns `InvoiceWithItems`,
  which has `amountPaid`/`currentBalance` but not `paymentStatus`) — the
  tests read it from the list endpoint (`GET /api/invoices`) instead,
  which does include it per invoice row (Phase 15).
- Also updated `packages/shared/test/permissions.test.ts` and
  `apps/api/test/permissions.test.ts`'s hardcoded exhaustive
  permission-list/count assertions for the new `payment.delete` entry —
  the same `TS2739`-style "extend the array, must also update every
  place that assumes its exact contents" trap as `AUDIT_ACTIONS`, just
  as a runtime assertion instead of a type error.

## Unit Amount Column

Added a "Unit Amount" column (price of a single piece) to every
customer-facing invoice table, between Stitches and Amount:
Description | Quantity | Stitches | Unit Amount | Amount.

- **`packages/shared/src/invoice-view-model.ts`** — `InvoiceViewModel`'s
  `items[]` gained `unitAmount: string`. It's populated from the
  already-saved `invoice_items.calculated_unit_amount` column — the
  formula engine's raw per-unit result, computed and rounded *before*
  being multiplied by quantity to produce `calculatedTotal` (see
  `invoice.service.ts`'s `createInvoiceItem`). So this is not a new
  calculation path: the formula engine, the saved `calculatedTotal`/
  ledger debit, and every existing invoice total are all untouched.
  `unitAmount(item)` just formats that existing value with `roundMoney`,
  with a division (`total / quantity`, itself zero-guarded) as a
  fallback only for a row where the saved value is somehow missing or
  invalid — never the primary path, since dividing back out a value
  that was already computed would just risk a rounding mismatch against
  the saved figure.
- This is still never the internal `rate` (a formula *input*, e.g.
  per-1000-stitches) — `InvoiceViewModel` never carried `rate` before
  this change and still doesn't; "don't show calculation internals on
  the customer invoice" stays enforced by the data shape, same as
  formula/factor/multiplier/divisor already were.
- **All 5 templates** (`apps/web/src/features/invoices/templates/*.tsx`)
  gained the column in the same position. These are what both the
  on-screen invoice preview and the browser Print (`window.print()` on
  the same DOM — there's no separate print-specific template) render.
- **`apps/api/src/modules/invoices/pdf/render-html.ts`** — the one
  shared HTML layout behind both Download PDF and the WhatsApp-shared
  PDF (themed per template by `PDF_THEMES`, not five separate HTML
  layouts) gained the same column, in the same position.
- **Tests**: `packages/shared/test/invoice-view-model.test.ts` covers
  reading the saved `calculatedUnitAmount` through unchanged, the
  division fallback for a row missing it, and the zero-quantity safe
  fallback to "0.00". `apps/api/test/invoice-pdf-html.test.ts` covers
  the PDF HTML's column order and value. Verified live in a browser
  across all 5 templates (preview + the template switcher) and all 5
  themed PDF downloads (valid, non-empty, correct `%PDF-` output).

## Quick Invoice

A second, faster entry point for creating an invoice — never a second
invoice system. "+ Quick Invoice" now sits next to the unchanged "+ New
invoice" button on the Invoices page; both end up calling the exact
same `POST /api/invoices`.

- **`apps/web/src/features/invoices/QuickInvoiceForm.tsx`** (new) — a
  condensed, mobile-first form: Customer, Lot Number, Paid/Unpaid +
  Payment Method (cash/bank), a card per item (Category, Quantity,
  Stitches + an "Avg" stitch-count helper, live Unit Amount/Line
  Amount), Discount, Notes, then Subtotal/Discount/Grand Total. On
  submit it calls `invoicesApi.createInvoice(...)` — the identical call
  `CreateInvoiceForm` makes, same formula engine, same ledger debit,
  same invoice numbering, no rate override (always the category's
  default rate, since Quick Invoice deliberately has no Rate field).
  If "Paid" is checked, it then calls `paymentsApi.createPayment(...)`
  for the invoice's own grand total — the exact same call the Payments
  page and customer ledger panel make, never a separate "quick invoice
  payment" path. There is no new backend code, no new table, no new
  calculation: this file is UI-only, orchestrating two existing API
  calls.
- **Avg Stitch helper**: a from-scratch small addition, not a restore of
  an existing feature — a repo-wide search turned up no prior "average
  stitch" UI, formula variable, or memory.md entry despite it being
  listed among things to preserve in several task specs. Implemented as
  a small inline per-row panel (Total Stitches, Total Pieces → Apply)
  that only ever writes `Math.round(total / pieces)` into that row's
  existing Stitches field — never a separate calculated value, never
  sent to the server on its own.
- **Stale-data fix**: `invoicesApi.createInvoice`'s response has
  `amountPaid`/`currentBalance` computed *before* the "Paid" follow-up
  payment exists. After posting that payment, `QuickInvoiceForm`
  refetches the invoice (`invoicesApi.getInvoice`) so the template view
  that opens next — and anything printed/downloaded from it — shows the
  real, ledger-derived figures instead of a stale "Amount Paid: 0.00".
- **After save**: `InvoicesPage.tsx` routes straight into the existing
  `{ name: 'template' }` view (the same `InvoiceTemplateView` a normal
  invoice's row actions open) — Print/Download PDF/Share via WhatsApp
  are the same three buttons/actions already built there, not
  reimplemented. "Back" returns to the invoice list with the usual
  refresh, where the new invoice appears like any other.
- **`apps/web/src/features/invoices/preview.ts`** — `ItemPreview` gained
  a `unitAmount` field (the formula's per-unit result, before quantity)
  alongside the existing `amount`, since Quick Invoice's cards need to
  show both; `CreateInvoiceForm` ignores the new field and is otherwise
  untouched.
- **`apps/web/src/features/invoices/InvoicesPage.tsx`** — added the
  `'quick-form'` view branch and the new button; every existing view
  branch (list/details/template/form/edit) is unchanged.
- No backend files changed at all for this feature — every accounting
  rule (formula engine, ledger, FIFO payment allocation, discount,
  invoice numbering) is exercised exactly as it already was.

## Quick Invoice Simplified Item Row (Phase 28)

Quick Invoice's item row was judged "too complicated" (Category /
Quantity / Stitches / Avg button / Unit Amount / Line Amount) and was
simplified to exactly 4 fields: **Item/Description, Quantity, Unit
Price, Amount (read-only)**. Normal Invoice's `CreateInvoiceForm` —
Category, Category formulas, Stitches, Avg Stitch, Rate, Unit
Amount — is completely untouched; this phase only edited
`QuickInvoiceForm.tsx` on the frontend, plus the smallest possible
backend/schema extension to let an item skip the embroidery formula
engine entirely.

- **The "smallest clean solution" (additive-only)**: `invoice_items`
  already had `category_id` nullable (`ON DELETE SET NULL`, migration
  005). The one blocking constraint was `stitches NOT NULL` —
  migration `013_manual_invoice_items.sql` just does
  `ALTER TABLE invoice_items ALTER COLUMN stitches DROP NOT NULL;`
  (Postgres's existing `CHECK (stitches > 0)` already tolerates NULL —
  three-valued SQL logic, no CHECK rewrite needed). Zero new columns:
  a manual item reuses `category_name`/`rate`/`formula_type` (`'manual'`)
  /`formula_config` (`{}`)/`calculation_inputs`/`calculated_unit_amount`
  /`calculated_total` with sensible values, so every existing template,
  PDF, view-model helper (`unitAmount()` already reads
  `calculatedUnitAmount`) works with no further changes.
- **`invoice.service.ts`**: `createInvoiceItem` branches at the top —
  `if (!input.categoryId) return createManualInvoiceItem(...)` — before
  any of the existing category/formula-engine code, which is otherwise
  byte-for-byte unchanged. `createManualInvoiceItem` is new: requires
  `description` + `unitPrice`, and **always computes
  `total = quantity * unitPrice` itself** from the server-validated
  `unitPrice` — a client-supplied `calculatedTotal`/`lineAmount`/`amount`
  is never read, matching the task's explicit "do not trust a
  client-supplied total." `InvoiceItemInput`/`InvoiceItem.stitches`
  widened to optional/nullable; `duplicateInvoice`'s pre-existing
  "deleted category" guard (blocks duplicating an item with no
  `categoryId`) turned out to already block duplicating a manual-item
  invoice too, so `duplicateInvoice` itself needed no change.
- **`invoice.routes.ts`**: `parseItems()` branches on whether
  `categoryId` is present in the request body — absent means the manual
  (`description`/`unitPrice`/`quantity`) shape, present means the
  existing category/stitches/rate shape (unchanged validation).
- **`render-html.ts`** (PDF): one defensive fix, `${item.stitches}` →
  `${item.stitches ?? ''}`, since a raw template literal (unlike JSX)
  prints the literal text "null" for a null value — this is the only
  PDF/template file touched; all 5 React invoice templates needed zero
  changes since `{item.stitches}` already renders nothing for null.
- **`QuickInvoiceForm.tsx`**: Category select, Stitches input, and the
  entire Avg Stitch helper (added only 2 phases ago, see "Quick
  Invoice" above) are removed from this form only — `CreateInvoiceForm`
  keeps its own Avg Stitch helper untouched. New per-row fields:
  Item/Description, Quantity, Unit Price, read-only Amount
  (`quantity × unitPrice`, computed client-side for live preview via
  `Decimal`/`roundMoney` from `@invoice/shared` — the server
  recalculates and is authoritative). Customer, Lot Number,
  Payment Status/Method, Discount Type/Discount, Notes,
  Subtotal/Grand Total, Save Invoice are all unchanged.
- **Verified live** (Playwright, dev DB): registered a company, created
  a customer, filled two Quick Invoice rows with the task's own example
  data (HEAD SKIP 504×375.41, DUPATTA 504×131.03) — live amounts showed
  189206.64 / 66039.12, Subtotal/Grand Total 255245.76, both matching
  the spec exactly; saved invoice opened as `INV-000001` in the normal
  template view (STITCHES column correctly blank) with Print/Download
  PDF/WhatsApp all present; separately opened "+ New invoice"
  (`CreateInvoiceForm`) and confirmed Category/Stitches/Rate/Amount
  fields are all still there, unchanged. Dev DB reset
  (`TRUNCATE TABLE companies CASCADE`) after verification.
- New test file `apps/api/test/manual-invoice-items.test.ts` (10 tests):
  manual-item math, client-total-not-trusted, missing
  description/unitPrice 400s, mixed category+manual invoice, list
  /ledger/statement visibility, payment + Payments list, audit log,
  category items still require stitches (schema relaxation didn't
  loosen Normal Invoice validation), discount on a manual-item invoice.
  Full suite: 235/235 API tests + 41/41 shared tests passing;
  `npm run typecheck` and `npm run build` clean across all 3 workspaces.

## A5 Print Text Size

A5-portrait print/preview for the 5 invoice templates, plus a Small/
Medium/Large text-size control — strictly presentational, zero backend
files touched, zero changes to any calculation.

- **Page size**: each of the 5 templates' root `<div>` changed from
  `print-page w-[210mm] min-h-[297mm]` (A4) to a new
  `print-page-invoice w-[148mm] min-h-[210mm]` (A5 portrait) class/size.
  `index.css` gained a *named* `@page invoice-a5 { size: A5 portrait; }`
  + `.print-page-invoice { page: invoice-a5; ... }` block, additive
  alongside the existing `.print-page`/default `@page` A4 rules — those
  are untouched and still apply to `StatementPrintDocument.tsx` (the
  customer statement), which keeps printing at A4. Named pages are what
  let two different print jobs on the same site use two different paper
  sizes without one's CSS overriding the other's.
- **Text size**: a new `--inv-scale` CSS custom property (0.85 / 1 /
  1.15 for small/medium/large — see
  `templates/textSize.ts`), set once via inline style on the wrapper
  `InvoiceTemplateView.tsx` already renders `<template.Component>`
  inside. Every Tailwind `text-xs`/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl`
  utility across all 5 templates was mechanically replaced with the
  arbitrary-value equivalent, e.g. `text-sm` →
  `text-[length:calc(0.875rem*var(--inv-scale,1))]` — same rem base,
  just multiplied by the single inherited scale variable, so it can't
  compound unexpectedly through nesting the way `em` would. A
  Small/Medium/Large button group next to the template `<select>`
  persists the choice to `localStorage` (`invoiceTextSize`) via
  `loadTextSize`/`saveTextSize`; defaults to Medium when nothing's
  saved or storage is unavailable.
- **Deliberately does not touch the PDF/WhatsApp PDF.** apps/api's
  `render-html.ts`/`themes.ts` are a completely separate HTML/CSS layer
  from these React templates (confirmed before touching anything) — the
  text-size control and A5 page size only affect the on-screen preview
  and browser Print (`window.print()` on the same DOM). Download
  PDF/WhatsApp stay exactly as they were: A4, server-rendered, their
  own fixed styling.
- **Overflow fixes found and fixed by testing, not guessed in advance**:
  at Large text size on the now-narrower A5 width, two templates
  genuinely overflowed under realistic data (a long description, a long
  category name, large stitch/quantity numbers) — `ModernCurveTemplate`
  (wrapped in `overflow-hidden`, so the Amount column was silently
  clipped) and `IndustrialBlueTemplate` (no `overflow-hidden`, so it
  visibly spilled past its border). Fixed by trimming each table's
  horizontal cell padding (`px-4`→`px-2`/`px-3`, `px-6`→`px-4`) — a
  presentation-only change, verified by comparing
  `el.clientWidth`/`el.scrollWidth` (equal = no overflow) across all 5
  templates × all 3 sizes with stress-test data, not just eyeballing
  one screenshot.
- Also added `break-words` to each template's Description `<td>` so a
  long unbroken description wraps instead of threatening overflow on
  the narrower page.
- `apps/web/src/features/invoices/templates/textSize.ts` (new) is the
  only new file; `InvoiceTemplateView.tsx` gained the button group,
  the `textSize` state, and the `style={{ '--inv-scale': ... }}` wrapper
  — nothing about how it fetches the invoice, builds the view model, or
  calls Print/Download/Share changed.

## Large-Text A5 Page-Split Fix

Bug: at Text Size = Large, a normal short invoice (5-6 rows) that
should fit on one A5 page was splitting into 2 — the item table stayed
on page 1, totals moved to page 2. Root cause: Large's 1.15x font
scale (textSize.ts) grows every row's line-height, but vertical
padding/margins were fixed in px regardless of text size, so a normal
invoice's total content height crept past one physical A5 page
(confirmed by actually measuring real print-to-PDF page counts — see
below — not just eyeballing a screenshot, which can't see this at all
since `@page`/pagination rules only apply under `@media print`).

- **`apps/web/src/features/invoices/templates/compact.ts`** (new) — a
  tiny `vs(compact, normal, tight)` helper that swaps a Tailwind
  spacing class for a tighter one only when `compact` is true. No CSS
  calc/variable here (unlike text size): how much a design can
  compress without looking cramped varies per element (a table row vs.
  a page margin), so each spot picks its own tight value rather than
  one blanket multiplier.
- **`registry.ts`** / **`InvoiceTemplateView.tsx`** — `InvoiceTemplate
  .Component` gained an optional `compact?: boolean` prop, set by
  `InvoiceTemplateView` as `textSize === 'large'`. Font size is
  untouched by this — `--inv-scale` still does exactly what it did
  before; `compact` only ever touches padding/margin/space-y classes.
- **All 5 templates** got every *vertical* padding/margin/gap
  (header, bill-to block, table row padding, totals section, terms
  block) wired through `vs(compact, ...)` — roughly halved when
  compact. Horizontal padding/margins are untouched (that's what the
  previous phase's overflow fix tuned; touching it again here would
  risk reopening that bug for no reason, since the bug being fixed now
  is strictly a *vertical* fit problem).
- **`index.css`** — added `.print-page-invoice .totals-section` and
  `table/tbody/tr/td/th { break-inside: avoid }` print rules (the
  task's own suggested CSS, added as belt-and-braces alongside each
  template's existing inline `break-inside-avoid` Tailwind class on
  the same elements) so the totals block can never itself be split by
  a page break once it's part of what's left on page 1.
- **No `max-height` + `overflow:hidden` trick.** The task's example
  CSS included `max-height: 210mm` on the page box; that was
  deliberately left out — combined with overflow:hidden it would
  silently clip a genuinely long invoice's content (the exact
  "ModernCurve's Amount column got clipped by `overflow-hidden`" bug
  fixed in the previous phase), and without overflow:hidden it does
  nothing useful (content still overflows past the box's declared
  height, it just looks more broken on screen). `min-height` only
  (already in place) plus smaller spacing at Large is what actually
  fixes short invoices without breaking long ones.
- **How this was actually verified**: real `page.pdf()` captures
  (Playwright, `preferCSSPageSize: true`, Chromium — the exact engine a
  user's own browser print uses) with real `/Type /Page` object
  counting, not screenshots or `scrollHeight` (which can't see
  print-only `@page`/break rules at all — confirmed by trying
  `scrollHeight` first and getting flat, uninformative numbers before
  switching to real PDF page counts). Before the fix: `modern-curve`
  split to 2 pages with just 5 rows at Large; `minimal-clean` split at
  6 rows. After: both hold at 1 page through 6 rows, plus a lot
  number + discount + terms. A genuine 20-row invoice still correctly
  spans 3 pages at Large, unchanged — long invoices still paginate
  normally, nothing is forced onto one page.

## Company Delete / Deactivate

Two levels, both company-settings "Danger Zone" actions, both gated by
their own permission:

- **Deactivate** (`company.deactivate`, owner+admin): reversible,
  data-preserving hide. `companies` gained a `status` column
  (`'active' | 'deactivated'`) and `deactivated_at` — nothing else
  changes. A deactivated company is simply excluded wherever "my
  active company" is resolved: `requireAuth` now joins `companies` on
  `status = 'active'` (so an open session pointing at a company
  deactivated out from under it 401s on its very next request, the
  same way a revoked membership already does), `login` picks the
  oldest *active* membership, and `switchCompany` rejects switching
  into a deactivated one. Every invoice, customer, ledger entry,
  payment, and audit row the company owns is completely untouched.
  **Reactivate** (same permission) is the exact reverse, and is the one
  action that must work while a *different* company is the session's
  active one (a deactivated company can never itself be that), so it
  looks up the caller's role in the *target* company directly from
  `company_members` rather than trusting the session's current role —
  `requirePermission` can't be used here for that reason.
- **Permanent delete** (`company.delete`, **owner only** — the one
  permission besides `users.manage` explicitly excluded from ADMIN):
  requires typing the company's name exactly
  (`DELETE /api/company` body `{confirmName}`, compared verbatim
  server-side too, never trusted from the UI alone). Both levels also
  refuse to act on the caller's *only* company — there's no
  "onboarding while logged out with zero companies" flow in this app
  (confirmed by inspection before building this), so stranding someone
  there is prevented rather than half-handled.
- **Deletion mechanics**: every company-owned table already had
  `ON DELETE CASCADE` back to `companies.id` from its own original
  migration (`company_members`, `sessions`, `customers`,
  `embroidery_categories`, `invoice_counters`, `invoices` →
  `invoice_items`, `ledger_entries`, `payments`, `audit_logs` — all
  confirmed against every migration file before writing any delete
  code) — so `deleteCompanyPermanently` is one
  `DELETE FROM companies WHERE id = $1` inside a transaction, not a
  hand-maintained list of per-table deletes that could drift from the
  schema. **The one thing that cascade cannot be allowed to delete is
  its own deletion record** — audit_logs itself cascades away with the
  company, so a `COMPANY_DELETED` row written there would vanish in
  the same statement that created the need for it. Migration 012 adds
  `company_deletion_log`, a small table with a plain `company_id uuid`
  column and **no foreign key** back to `companies` at all, specifically
  so it survives. (Deactivate/reactivate don't have this problem —
  the company and its audit_logs both survive those, so
  `COMPANY_DEACTIVATED`/`COMPANY_REACTIVATED` are ordinary audit rows.)
- **Session continuity**: deleting (or deactivating) the company whose
  session is currently acting re-points that *one* session to another
  active company the same user belongs to, inside the same
  transaction, *before* the cascade/status-flip — so the row the
  request is running on survives and the very next `GET /api/auth/me`
  already resolves to the new company, no re-login needed. Every
  *other* member's session still pointing at the company is left alone
  and simply 401s on their next request (cascade-deleted for permanent
  delete, status-filtered by `requireAuth` for deactivate) — the same
  "a vanished tenant logs its members out" behavior a revoked
  membership already causes, not a new failure mode this introduces.
- **Frontend**: `CompanyDangerZone.tsx` (new, rendered in the Overview
  tab next to the existing company profile panel) — Deactivate is a
  single `window.confirm`; Delete is `window.confirm('Delete this
  company permanently?')` first, then an inline "type the name to
  confirm" input that keeps the actual delete button disabled until it
  matches exactly. `CompanySwitcher.tsx` now splits the list into
  Active (clickable, as before) and a "Deactivated" section with its
  own Reactivate button per company. Both deactivate/delete success
  handlers just call the existing `refreshMe` — since the backend
  already re-pointed the session, `App.tsx`'s normal `me.company.id`
  -keyed remount picks up the new company with no new routing/redirect
  logic needed; if a user is somehow left with zero companies
  (shouldn't happen given the "only company" guard), the existing
  `refreshMe().catch(() => setMe(null))` already falls through to the
  login/register screen, which doubles as onboarding.
- No backend route trusts a client-supplied company id for Deactivate/
  Delete — both always act on `auth(req).companyId` (the session's own
  active tenant), same "no `:companyId` in the URL" convention as the
  existing `GET/PATCH /api/company`. Reactivate is the only one of the
  three that takes a path param, and its permission check is the
  manual target-company lookup described above specifically because of
  that.

## Internal Lot Number + Customer Lot Number (Phase 29)

Split the single `lot_number` field into two independent, optional
free-text fields: the existing column stays exactly as-is (same name,
same data, same meaning) and becomes the **internal** lot number
(factory/business-internal, visible in-app only); a new
`customer_lot_number` column holds the **customer's own** lot number,
the only one ever shown on a customer-facing output.

- **Migration `014_customer_lot_number.sql`**: `ALTER TABLE invoices
  ADD COLUMN customer_lot_number text NULL;` — the only schema change.
  No historical data touched: every existing `lot_number` value keeps
  its exact meaning (internal), nothing was renamed or backfilled.
- **The enforcement mechanism is structural, not a per-template
  check**: `InvoiceViewModel` (packages/shared's invoice-view-model.ts)
  — the single shape every customer-facing output (all 5 React
  templates, the server-side PDF HTML in render-html.ts, and WhatsApp,
  which shares the same `generateInvoicePdf` → `buildInvoiceViewModel`
  path) is built from — has a `customerLotNumber` field and **no field
  at all** for the internal one. `buildInvoiceViewModel` maps
  `invoice.customerLotNumber` into it and nothing else; there is no
  fallback to `invoice.lotNumber` anywhere in that function. This is
  the same pattern already used to keep the internal `rate`/formula
  fields off the customer invoice (Phase 6) — "can't show it" by data
  shape, not by convention a future edit could accidentally undo.
- **Backend** (`invoice.service.ts`/`invoice.routes.ts`): `lotNumber`
  and `customerLotNumber` are two independent optional fields on
  `InvoiceInput`/`InvoiceUpdateInput`/`Invoice`, saved and read
  together but never derived from each other. Search (`listInvoices`)
  matches invoice number, customer name, internal lot number, OR
  customer lot number. `duplicateInvoice` already didn't carry the
  (internal) lot number to a new draft — extended to also never carry
  the customer lot number, same reasoning ("each new batch/job gets
  its own lot numbers").
- **Frontend**: `CreateInvoiceForm.tsx` and `QuickInvoiceForm.tsx` both
  gained a second "Customer Lot Number" field next to the renamed
  "Internal Lot Number" (was just "Lot Number") — independently
  editable, both optional, no other field or calculation touched.
  `InvoiceDetails.tsx`'s header line shows both when set: "Internal Lot
  #: 79 · Customer Lot #: CUST-458". `InvoiceList.tsx` gained a second
  "Customer Lot #" column next to "Internal Lot #" and its search box
  placeholder mentions both.
- **Verified live** (Playwright, dev DB): created a Normal Invoice with
  Internal Lot Number "79" and Customer Lot Number "CUST-458" — saved
  correctly as two independent fields; Invoice Details showed both;
  all 5 templates (cycled via the template selector) showed only `Lot
  #: CUST-458`, confirmed via page text content that the internal value
  never appears in any of them; invoice list search matched on both
  values independently. Dev DB reset after verification.
- Tests: `apps/api/test/invoice-discount-lot.test.ts` gained coverage
  for saving/returning/independently-editing/searching the customer
  lot number and for duplicate never copying either lot number;
  `apps/api/test/invoice-pdf-html.test.ts` (the fast, no-Chromium HTML
  unit tests) updated its fixture to `customerLotNumber` and gained a
  test proving the internal lot number can never render; `packages/
  shared/test/invoice-view-model.test.ts` gained a test asserting
  `InvoiceViewModel` has no `lotNumber` key at all and that its JSON
  serialization never contains an internal lot number value, even when
  one is set on the source invoice.

## Optional Display Controls + General Quantity + Sets + Bill Number (Phase 30)

Four additions, all additive-only (one migration, no column removed or
repurposed) and all display/metadata — none of them touch the formula
engine, calculated amounts, discount, ledger, or any existing
calculation:

1. **Show Unit Amount / Show Item Quantity** — two invoice-level
   booleans (`show_unit_amount`, `show_item_quantity`, both `NOT NULL
   DEFAULT true`) that control whether a template renders the Unit
   Amount / (per-item) Quantity table columns. Display-only: the
   underlying values (`calculatedUnitAmount`, each item's `quantity`)
   are always computed and saved exactly as before regardless of these
   flags — `InvoiceViewModel.items[].unitAmount`/`.quantity` are always
   present; a template's JSX/HTML just conditionally renders the
   `<th>`/`<td>` pair. Saved *per invoice*, not a global UI setting, so
   an old invoice always prints the same way later even if some future
   default changes (verified: toggling either flag on a fresh create
   never changes `calculatedUnitAmount`, `calculatedTotal`,
   `totalAmount`, `grandTotal`, or the ledger debit).
2. **General Quantity** — a new, optional, invoice-level
   `general_quantity numeric(12,2)` field: "the overall suit quantity
   for the whole job," completely separate from each item's own
   `invoice_items.quantity` (untouched) and never fed into any
   calculation. Shown in-app and on customer-facing print/PDF/WhatsApp
   as "Quantity: 504 Suits" (hidden entirely when null) — never
   confused with the item-level "Quantity" table column.
3. **Number of Sets** — `SUITS_PER_SET = 84`, the one named constant
   (packages/shared's `invoice-sets.ts`) everywhere this business rule
   is used; changing it later is a one-line edit, never a scattered
   literal 84. **Deliberately not stored** — `calculateSets(generalQuantity)`
   derives it fresh on every read/render (`generalQuantity /
   SUITS_PER_SET`, formatted with `toDecimalPlaces(2).toString()` so a
   whole result prints as "6" and a fractional one as "1.5", never
   padded to "6.00" or wrongly rounded to a whole number for a
   non-84-multiple like 100 → "1.19"). A sibling `formatQuantity()`
   trims the DB's own "504.00" down to "504" for display only — the
   stored `Invoice.generalQuantity` itself is untouched by either
   helper.
4. **Bill Number** — a new, optional `bill_number text` field, a
   second business-assigned number distinct from the system-generated
   `invoice_number`. Unlike the internal lot number, this one IS shown
   on customer-facing print/PDF/WhatsApp ("Bill #: 4587", right near
   the invoice number) — so, unlike `customerLotNumber`, it needed no
   special view-model-shape enforcement; it's just another optional
   field in `InvoiceViewModel`. Searchable (`listInvoices`' search
   clause now also matches `billNumber`).

- **Migration `015_invoice_display_and_metadata.sql`**: adds all four
  columns (`bill_number`, `general_quantity`, `show_unit_amount`,
  `show_item_quantity`) to `invoices` in one `ALTER TABLE`. The two
  booleans default `true` so every pre-existing invoice prints exactly
  as it already did — confirmed with a dedicated backward-compatibility
  test (`invoice-display-metadata.test.ts`) that creates an invoice
  sending none of the four new fields and asserts `billNumber`/
  `generalQuantity` are `null` and both booleans are `true`.
- **`invoice.service.ts`**: `InvoiceInput`/`Invoice` widened with the
  four fields; `createInvoice`'s return normalizes `generalQuantity`
  through `roundMoney` (matching the numeric(12,2) column's own
  formatting — same convention `discountValue` already uses) so a
  direct create response never disagrees with a subsequent GET's
  formatting. `duplicateInvoice` carries over `generalQuantity` and
  both display toggles (a duplicate is "the same order again — same
  suit count, same print preference") but never `billNumber` (same
  reasoning as the lot numbers: each new bill gets its own).
- **`invoice.routes.ts`**: two new `validate.ts` helpers —
  `optionalPositiveDecimal` (General Quantity) and `optionalBoolean`
  (the two toggles) — both absent-is-fine, following the file's
  existing `optionalX` naming convention.
- **All 5 templates + `render-html.ts`** (the server-side PDF/print
  HTML, shared by browser print, Download PDF, and WhatsApp's PDF
  attachment — one code path, so fixing it once fixes all three
  outputs): Quantity/Unit Amount `<th>`/`<td>` pairs are now
  conditionally rendered on `invoice.showItemQuantity`/
  `.showUnitAmount`; Bill #/Quantity/Sets lines added to each
  template's existing metadata area, each independently conditional on
  being non-null. `IndustrialBlueTemplate`'s info-cell grid (which
  already varied its column count for the optional Lot # cell) gained
  an `infoGridClass(count)` helper returning one of a fixed set of
  literal `grid-cols-N` strings — Tailwind's JIT scanner only picks up
  complete class-name literals that appear verbatim in source text, so
  this can never be a live-interpolated `grid-cols-${n}`, the same
  constraint the pre-existing lot-number ternary there already
  satisfied.
- **`CreateInvoiceForm.tsx`** gained a new "Invoice Details" section
  (Bill Number, General Quantity, a disabled live-computed Sets
  field via `calculateSets`, and the two "Invoice Display" checkboxes)
  between the existing header fields and the items table — `Quick
  InvoiceForm.tsx` was deliberately NOT touched, since the task scoped
  this UI to Create/Edit Invoice only; a Quick Invoice still gets the
  server's true/true/null/null defaults.
- **`InvoiceDetails.tsx`** shows Bill #/General Quantity/Sets inline
  next to the existing Internal/Customer Lot # line; **`InvoiceList.tsx`**
  gained a "Bill #" column and its search placeholder now mentions it.
- **Verified live** (Playwright, dev DB): the Invoice Details section
  renders and live-recomputes Sets (504 → 6) as General Quantity is
  typed; a saved invoice's template view shows "Bill #: 4587 /
  Quantity: 504 Suits / Sets: 6"; with both toggles unchecked
  (General Quantity 126 → Sets 1.5), all 5 templates correctly reduced
  their item table to Description | Stitches | Amount only — confirmed
  by screenshot on every one of the 5, not just Classic Navy. Dev DB
  reset after verification.
- 266/266 API tests (15 new in `invoice-display-metadata.test.ts` +
  9 new column/toggle tests in `invoice-pdf-html.test.ts`), 49/49
  shared tests (7 new in `invoice-view-model.test.ts`); `npm run
  typecheck` and `npm run build` clean across all 3 workspaces.

## Quick Invoice Edit Mode Bug Fix + invoice_mode (Phase 31)

**Root cause**: editing *any* invoice always routed to `CreateInvoiceForm`
(`InvoicesPage.tsx`'s `'edit'` view had exactly one branch) — there was
no discriminator anywhere that told the edit screen "this was created
as a Quick Invoice." A Quick Invoice's manual items (`categoryId: null`)
loaded into `CreateInvoiceForm`'s category-item row shape via
`itemRowFromInvoice`, so the Category `<select>` appeared empty/wrong,
Stitches/Rate showed raw DB values, and editing-and-saving would have
tried to run the item through the formula engine. A second, related bug
('787871.00'/'789.00' trailing decimals) was really the same root
issue: those raw DB-formatted strings were only ever meant to flow
through `CreateInvoiceForm`'s category-item fields, which don't trim
them, and Quick Invoice's own item fields didn't exist in edit mode to
need trimming at all.

- **Fix is structural, not inferred**: a new `invoice_mode` column
  (`'standard' | 'quick'`, migration `016_invoice_mode.sql`) is the
  discriminator `InvoicesPage.tsx` now switches on. It is **always
  server-derived** from the items actually being saved
  (`invoiceModeFromItems` in `invoice.service.ts`: `'quick'` iff every
  item lacks `categoryId`, the identical signal `createInvoiceItem`
  already uses to pick `createManualInvoiceItem`), computed fresh in
  both `createInvoice` and `updateInvoice` — never accepted from the
  client (a request body with `invoiceMode: 'standard'` next to manual
  items is silently ignored; tested explicitly). This means it can't
  drift: as long as each editor keeps sending the item shape it always
  has (manual for Quick, category for Standard), the mode a saved
  invoice carries is automatically correct on every reopen, with zero
  coupling between the two forms.
- **Migration backfill**: existing rows get `invoice_mode = 'quick'`
  only when every one of their items is manual (same condition, applied
  once via `UPDATE ... WHERE EXISTS/NOT EXISTS`), so an invoice created
  before this phase reopens in the right editor too.
- **`InvoicesPage.tsx`**: the `'edit'` view now has two branches on
  `view.invoice.invoiceMode` — `'quick'` renders `QuickInvoiceForm`,
  anything else renders the untouched `CreateInvoiceForm`.
- **`QuickInvoiceForm.tsx`** gained edit support (an optional `invoice`
  prop, same contract as `CreateInvoiceForm`'s): Customer becomes a
  disabled read-only field (can't reassign, matching
  `CreateInvoiceForm`'s edit convention); Lot Number/Customer Lot
  Number/Bill Number/General Quantity(+live Sets)/Discount/Notes/items
  all prefill from the invoice; saving calls `updateInvoice` instead of
  `createInvoice` and always sends manual items, so the server
  re-derives `'quick'` again. The Paid/Unpaid toggle and Payment Method
  are hidden entirely in edit mode — editing never creates a payment;
  "Record a payment" in `InvoiceDetails` is the one place that already
  does, and this was deliberately left alone (payments/ledger are
  out of scope for this fix).
- **Number formatting**: new `formatNumber()` (`packages/shared/src/
  number-format.ts`) trims a numeric(12,2) column's padded trailing
  zeros for display — `"787871.00"` → `"787871"`, `"504.50"` →
  `"504.5"`, `"1.25"` stays `"1.25"` — via `new Decimal(value).toString()`,
  never rounding, never touching the stored value. Used only at
  `QuickInvoiceForm`'s edit-time prefill (`itemRowFromInvoice`, General
  Quantity, Discount) and its Amount display — a purely cosmetic,
  Quick-Invoice-only fix; `CreateInvoiceForm`'s own item prefill
  (`itemRowFromInvoice` there) was deliberately left exactly as it was.
- **Verified live** (Playwright, dev DB): created a Quick Invoice with
  Quantity 787871 / Unit Price 789, reopened Edit — confirmed no
  "Category"/"Stitches"/"Avg" anywhere on the page, confirmed
  "Item / Description"/"Unit Price" labels present, confirmed the
  Quantity input reads "787871" and Unit Price reads "789" (not
  "787871.00"/"789.00"), edited and saved, reopened Edit a second time
  and confirmed it still has no Category label (invoiceMode survived
  the round-trip). Separately created and edited a Standard Invoice —
  screenshot confirms Category/Description/Quantity/Stitches/Rate/Amount
  render exactly as before, byte-for-byte unchanged. Dev DB reset after
  verification.
- 9 new tests in `apps/api/test/invoice-mode.test.ts` (create/edit/
  reopen for both modes, client can't set invoiceMode, migration
  backfill logic, tenant isolation) and 5 new tests in `packages/
  shared/test/number-format.test.ts`. 275/275 API tests, 54/54 shared
  tests; `npm run typecheck` and `npm run build` clean across all 3
  workspaces.

## Gate Pass Number (Phase 32)

A manual, free-text invoice field — the gate pass number that comes
with a client's material — added as a straight sibling of Bill Number
(Phase 30): same tier (invoice-level metadata, never used in any
calculation), same treatment (shown on customer-facing print/PDF/
WhatsApp, searchable, available on both Standard and Quick Invoice,
never copied by Duplicate).

- **Migration `017_gate_pass_number.sql`**: `ALTER TABLE invoices ADD
  COLUMN gate_pass_number text NULL;` — the only schema change. No
  character restriction beyond `optionalString`'s plain length check,
  so letters/digits/slashes/dashes ("GP-4587", "12345", "Gate-77/26")
  all pass through untouched.
- **Backend**: `gatePassNumber` threaded through `InvoiceInput`/
  `Invoice`/`InvoiceUpdateInput` exactly like `billNumber` — added to
  `INVOICE_HEADER_COLUMNS`, the `listInvoices` CTE'S column list *and*
  its search clause, the `createInvoice` INSERT/return, and the
  `updateInvoice` UPDATE. `duplicateInvoice` needed no code change (it
  already only copies fields explicitly listed in its `createInvoice`
  call; `gatePassNumber` simply isn't one of them, so it's `null` on a
  duplicate for the same reason `billNumber` already was) — just a doc
  comment update.
- **`InvoiceViewModel`** gained `gatePassNumber: string | null`,
  mapped straight from `invoice.gatePassNumber` in
  `buildInvoiceViewModel` — no special enforcement needed (unlike
  `customerLotNumber`'s internal/customer split), since this field has
  only one meaning and is always customer-facing.
- **All 5 templates + `render-html.ts`**: a `Gate Pass #: …` line added
  right after Customer Lot # in each template's existing metadata area,
  hidden entirely when null — same `{invoice.gatePassNumber && …}`
  pattern as every other optional metadata row.
  `IndustrialBlueTemplate`'s dynamic info-cell grid (previously capped
  at `grid-cols-4` for up to 2 optional cells) was extended to
  `grid-cols-5` for the new potential 5th cell (Invoice No. + Date are
  fixed, Bill #/Lot #/Gate Pass # are each independently optional) —
  same literal-class-string convention (`infoGridClass`) the existing
  Bill #/Lot # logic already used, since Tailwind's JIT scanner only
  picks up complete class names that appear verbatim in source.
- **`CreateInvoiceForm.tsx`** and **`QuickInvoiceForm.tsx`** both gained
  a "Gate Pass Number" text field in their existing "Invoice Details"
  section, right next to Bill Number — present in both create and edit
  mode for both forms (QuickInvoiceForm's own edit mode, from Phase 31,
  already had the Bill Number/General Quantity pattern to extend).
  `InvoiceDetails.tsx` shows `· Gate Pass #: GP-4587` inline with the
  other optional metadata, hidden when null. `InvoiceList.tsx`'s search
  placeholder mentions it; no dedicated list column was added (the
  table was already fairly wide, and the task only asked for search
  to work, not a new column — unlike Bill Number, which got one).
- **Verified live** (Playwright, dev DB): filled Gate Pass Number on a
  Standard Invoice create form, saved, confirmed Invoice Details and
  all 5 templates show "Gate Pass #: GP-4587"; separately created a
  Quick Invoice with Bill Number + Gate Pass Number (containing a
  slash, "GP-77/26") + Customer Lot Number all at once and confirmed
  the Industrial Blue template's 5-column grid renders all three
  cleanly with no layout breakage. Dev DB reset after verification.
  (Also found and cleaned up an unrelated stale dev-server process
  left over from an earlier phase of this session, still holding port
  4000 — not a code bug, just leftover session state.)
- 14 new tests in `apps/api/test/gate-pass-number.test.ts` (save/edit/
  clear/detail/print/Quick/Standard/search/duplicate/tenant-isolation/
  never-affects-calculations), 2 new column-presence tests in
  `invoice-pdf-html.test.ts`, 2 new tests in `packages/shared/test/
  invoice-view-model.test.ts`. 291/291 API tests, 56/56 shared tests;
  `npm run typecheck` and `npm run build` clean across all 3 workspaces.

## Show Why Delete Is Not Available (Phase 33)

The Delete action on `InvoiceList.tsx` silently disappeared whenever
`canHardDelete()` returned false (not draft, or paid > 0), with zero
explanation — confusing even though the underlying safety rule
(`deleteInvoice` in `invoice.service.ts`) is correct and was never
touched by this phase.

- **`InvoiceList.tsx`**: `canHardDelete(invoice): boolean` replaced
  with `hardDeleteBlockReason(invoice): string | null`, returning
  `null` when the backend would accept the delete and otherwise the
  *exact* wording `deleteInvoice` itself throws (not-draft status, or
  has-payments) — so the UI reason and the server's own rejection
  message never drift apart. The Delete button is now always rendered
  (given `invoice.delete` permission): enabled when the reason is
  `null`, otherwise `disabled` with a `title` tooltip carrying the
  reason and its label changed to "Delete (disabled)". When the block
  is payment-related (`invoice.paid !== '0.00'`), a "View payments"
  link appears next to it.
- **"View payments" cross-tab navigation**: payments are recorded at
  the customer level only (FIFO-allocated across that customer's
  invoices on every read — see Phase 15's dashboard/history logic), so
  there is no single invoice→payment link to show; "View payments"
  means "jump to this invoice's customer's payment history" instead.
  Wired as a plain callback prop, since `App.tsx` has no router — just
  a local `useState<DashboardTab>`:
  `InvoiceList` → `onViewPayments(customerId)` → `InvoicesPage` passes
  it straight through → `App.tsx`'s `viewPaymentsForCustomer` sets a
  new `paymentsCustomerFilter` state and switches `tab` to
  `'payments'` → `PaymentsPage` gained an `initialCustomerId` prop,
  synced into its own `customerFilter` state via a `useEffect` (so a
  second "View payments" click for a different customer, while already
  on the Payments tab, still takes effect — the component isn't
  remounted, only re-rendered), which is passed into the already-
  existing `customerId` filter of `paymentsApi.listPayments` — the
  backend route already supported this filter end-to-end, so zero
  backend changes were needed for this part either. A "Show all
  payments" link clears the filter.
- Archive/Unarchive and the Active/Archived/All tab filter: untouched,
  as required — the fix only changes how a blocked Delete is presented,
  never what Archive can do or when.
- New backend test `apps/api/test/invoice-archive.test.ts`: "blocks
  deleting a draft invoice once a *partial* payment has reached it" —
  the existing suite only covered a *fully*-paid invoice and a
  never-paid one; this closes that gap, asserting the 400 + exact
  `details.payments` message + the partial payment and its ledger
  credit still both being intact afterward.
- 292/292 API tests (1 new), `npm run typecheck` and `npm run build`
  clean across all 3 workspaces. No `deleteInvoice` or any other
  backend accounting/ledger code was changed.

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
  `whatsapp.test.ts`, `dashboard.test.ts`, `invoice-history.test.ts`,
  `statement.test.ts`, `permissions.test.ts`, `audit.test.ts`,
  `security.test.ts`, `statement-pdf-html.test.ts`, `tenant-isolation.test.ts`,
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
14. Dashboard: read-only summary (4 cards + 3 sections) with
    Today/This Month/Custom filters, now the default landing tab; FIFO
    aging for the unpaid/partial invoice count (see "Dashboard
    (Phase 14)" above)
15. Invoice History: the invoice list gained per-row paid/balance/
    paymentStatus (FIFO-aged), search + customer/date/status filters,
    and row actions (View/Print/PDF/WhatsApp/Duplicate); duplicate
    copies items into a new draft only, never payments or ledger entries
    (see "Invoice History (Phase 15)" above)
16. Customer Statement: full ledger statement (date/reference/
    description/debit/credit/running balance), date-range + transaction-
    type filters, an opening/invoice-total/payments/closing summary, and
    Print/PDF — see "Customer Statement (Phase 16)" above, especially
    its date-vs-created_at ordering note before touching this code
17. Role Permissions: owner/admin/staff extended into a fixed granular
    permission list via one ROLE_PERMISSIONS map (shared by both apps),
    enforced everywhere by a single requirePermission middleware — see
    "Role Permissions (Phase 17)" above
18. Audit Log: append-only audit_logs table, one postAuditLog() call
    inside the same transaction as the write it's auditing, wired into
    invoice/payment creation, category rate/formula changes, and
    company settings changes; owner/admin-only via a new audit.view
    permission — see "Audit Log (Phase 18)" above
19. Security Audit: full checklist review (auth, authorization, tenant
    isolation, SQL injection, XSS, rate limiting, error handling, ...);
    two confirmed fixes (rate limiting on login/register, a duplicate-
    email race in register()) plus new regression tests — see
    "Security Audit (Phase 19)" above
20. Production Deployment: NODE_ENV-driven config, health/readiness
    split, request-id correlation + structured logging, pluggable
    error-reporter, graceful shutdown, optional single-process frontend
    serving, backup/restore scripts, `DEPLOYMENT.md` — see "Production
    Deployment (Phase 20)" above
21. Invoice Archive / Delete: `archived_at` visibility flag (never an
    accounting reversal), a hard delete allowed only for a draft with
    zero FIFO-allocated paid amount, new invoice.archive/invoice.delete
    permissions, three new audit actions, Active/Archived/All list tabs
    — see "Invoice Archive / Delete (Phase 21)" above
22. Customer Unarchive/Restore: added the missing reverse of customer
    archive — new `unarchiveCustomer` service function + `POST
    /api/customers/:id/unarchive` route, a Restore/Unarchive button on
    archived customers in `CustomerDetails.tsx`, two new audit actions
    — see "Customer Unarchive / Restore" below
23. Invoice Discount + Lot Number: invoice-level percentage/fixed
    discount (server-authoritative, `grandTotal` = subtotal -
    discountAmount is what the ledger actually debits) and an optional
    free-text lot number; also added draft invoice editing
    (`PATCH /api/invoices/:id`), which didn't exist before this phase
    — see "Invoice Discount + Lot Number" below
24. Per-Item Quantity: quantity moved from invoice-level to
    invoice-item-level (`invoice_items.quantity`) — each category/line
    (BAZU=12, FRONT=8, ...) has its own quantity fed into the formula
    engine, never one invoice-wide value; `invoices.quantity` is now
    unused (column kept, defaulted, never read/written/displayed) — see
    "Per-Item Quantity" below
25. WhatsApp Sharing Fixed: root cause was `normalizeWhatsAppPhone`
    never converting a Pakistani local number ("03001234567") to
    international format, and the frontend never downloading the PDF
    before opening WhatsApp; also added an optional WhatsApp Business
    Cloud API integration (sends the PDF as a real document message)
    that click-to-chat falls back to when unconfigured — see "WhatsApp
    Sharing" below
26. PDF Generation Hardened: both invoice and statement PDF generation
    now share one `renderHtmlToPdf` helper (`lib/pdf/render-pdf.ts`)
    with `--disable-dev-shm-usage` (the standard fix for Chromium
    crashing/producing empty output under a container's small default
    `/dev/shm`) and a hard non-empty-plus-`%PDF-`-magic check before
    ever returning — a silent empty buffer now becomes a loud, logged
    500 instead of a fake 200 — see "PDF Generation Hardening" below
27. Delete Payment Safely: new `DELETE /api/payments/:paymentId`,
    `payment.delete` permission (owner/admin only), one transaction
    that removes the payment's own `PAYMENT`-type ledger credit and the
    payment row and posts a `PAYMENT_DELETED` audit entry — no separate
    invoice/customer recompute needed since both are always FIFO/ledger
    -derived live on read; permission-gated Delete action added to the
    Payments list and the customer ledger panel — see "Delete Payment
    Safely" below
28. Unit Amount Column: added a "Unit Amount" (price of one piece)
    column to all 5 invoice templates, the PDF layout, and print —
    sourced from the already-saved `calculatedUnitAmount` snapshot
    (the formula engine's per-unit result, saved before multiplying by
    quantity), not a new calculation; internal `rate` stays hidden —
    see "Unit Amount Column" below
29. Quick Invoice: a second, faster "+ Quick Invoice" entry point next
    to the unchanged "+ New invoice" button — a condensed frontend-only
    form (`QuickInvoiceForm.tsx`) that calls the exact same
    createInvoice/createPayment APIs as the normal flow, no new backend
    code; includes a from-scratch "Avg Stitch" per-item helper (no
    prior version of this existed in the codebase despite being listed
    as something to preserve) that only fills the existing Stitches
    field — see "Quick Invoice" below
30. A5 Print Text Size: the 5 invoice templates now print/preview at A5
    portrait (via a named `@page`, so the customer statement's A4 stays
    untouched) with a Small/Medium/Large text-size control
    (`--inv-scale` CSS variable, localStorage-persisted); zero backend
    files changed — Download PDF/WhatsApp PDF are a separate,
    unaffected A4 layout — see "A5 Print Text Size" below
31. Large-Text A5 Page-Split Fix: a normal short invoice (5-6 rows)
    was splitting onto 2 A5 pages at Text Size = Large because fixed
    -px vertical spacing didn't shrink to compensate for Large's taller
    line-height; fixed by halving vertical padding/margins (never
    horizontal, never font size) specifically when Large is selected,
    verified with real print-to-PDF page counts, not screenshots; a
    genuinely long invoice still correctly spans multiple pages — see
    "Large-Text A5 Page-Split Fix" below
32. Company Delete / Deactivate: a reversible Deactivate (status
    column, hides from the active switcher, data untouched) and an
    owner-only Permanent Delete (typed-name confirmation, relies on
    every company-owned table's existing ON DELETE CASCADE in one
    `DELETE FROM companies`, a durable `company_deletion_log` row
    survives the cascade that takes audit_logs with it); both re-point
    the caller's own session to another company first so the same
    request's session row survives and `GET /api/auth/me` already
    resolves to the new company with no re-login — see "Company
    Delete / Deactivate" below
33. Quick Invoice Simplified Item Row: Quick Invoice's item row cut
    down to exactly Item/Description, Quantity, Unit Price, read-only
    Amount — Category, Stitches, and the Avg Stitch helper removed from
    Quick Invoice only (Normal Invoice's `CreateInvoiceForm` is
    byte-for-byte unchanged); backend extension is additive-only — one
    migration (`stitches` nullable, already-nullable `category_id`
    reused), one new `createManualInvoiceItem` branch in
    `createInvoiceItem` that always recalculates
    `total = quantity * unitPrice` server-side and never trusts a
    client-supplied total — see "Quick Invoice Simplified Item Row
    (Phase 28)" below
34. Internal Lot Number + Customer Lot Number: split the single lot
    number field into two independent optional fields — the existing
    `lot_number` column stays exactly as-is and becomes internal
    (in-app only), a new `customer_lot_number` column is the only one
    ever shown on customer-facing print/PDF/WhatsApp. Enforced
    structurally: `InvoiceViewModel` has a `customerLotNumber` field
    and no field at all for the internal one, so there's nothing for
    any template or the PDF HTML to accidentally read — same pattern
    already used to keep the internal rate/formula off customer
    invoices. See "Internal Lot Number + Customer Lot Number (Phase
    29)" below
35. Optional Display Controls + General Quantity + Sets + Bill Number:
    four additive, display/metadata-only fields on `invoices` — two
    booleans (`show_unit_amount`/`show_item_quantity`, default true)
    that let a template hide its Unit Amount/Quantity columns without
    touching the underlying saved values or any calculation; General
    Quantity (an invoice-wide suit count, separate from each item's own
    quantity); Number of Sets (`SUITS_PER_SET = 84`, the one named
    constant it's derived from — never stored); and Bill Number (a
    second, customer-facing document number, separate from the
    system-generated invoice number). See "Optional Display Controls +
    General Quantity + Sets + Bill Number (Phase 30)" below

36. Quick Invoice Edit Mode Bug Fix: editing any invoice always opened
    `CreateInvoiceForm` (Category/Stitches/formula controls) because
    nothing distinguished a Quick Invoice from a Standard one at edit
    time. Added `invoice_mode` ('standard'|'quick'), always derived
    server-side from the items actually saved (never client-supplied),
    and gave `QuickInvoiceForm` real edit support so `InvoicesPage`
    can route to the right editor. Also fixed a related display bug —
    new `formatNumber()` trims a numeric(12,2) column's padded
    trailing zeros ("787871.00" → "787871") at Quick Invoice's edit
    prefill only. See "Quick Invoice Edit Mode Bug Fix + invoice_mode
    (Phase 31)" below

37. Gate Pass Number: a manual, free-text invoice field (letters/
    digits/slashes/dashes all allowed) for the gate pass number that
    comes with a client's material — a straight sibling of Bill
    Number, same tier (metadata only, never used in any calculation),
    same treatment (customer-facing print/PDF/WhatsApp, searchable,
    available on both Standard and Quick Invoice, never copied by
    Duplicate). See "Gate Pass Number (Phase 32)" below

38. Show Why Delete Is Not Available: the Delete button on a
    payment-blocked or non-draft invoice used to just vanish with no
    explanation. Backend `deleteInvoice` safety rule (draft-only,
    zero-paid) is untouched — this is a pure frontend presentation
    fix: the button always renders, is disabled with the exact
    backend-matching reason in its tooltip when blocked, and a "View
    payments" link appears next to a payment-blocked Delete that jumps
    to a customer-filtered Payments tab (FIFO payments are
    customer-level, never invoice-level, so there's no per-invoice
    payment list to link to). Archive/Unarchive untouched. See "Show
    Why Delete Is Not Available (Phase 33)" below

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
