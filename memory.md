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

## Invoice List Scroll + Search Bar Cleanup (Phase 34)

A pure UI/layout cleanup of `InvoiceList.tsx` — no data, search-backend
logic, filters, calculations, ledger, payments, invoice actions, or
permissions were touched; `listInvoices`, its query params, and every
action handler (`handleArchive`/`handleUnarchive`/`handleDelete`) are
byte-for-byte unchanged.

- **Root cause of the desktop horizontal scroll**: the table had a
  hardcoded `min-w-[1040px]` and all 11 columns (Invoice No, Bill #,
  Date, Internal Lot #, Customer Lot #, Customer, Grand Total, Paid,
  Balance, Status, Actions) always rendered, regardless of viewport —
  at 1366px and below that combination simply didn't fit inside the
  card's content width, forcing the `overflow-x-auto` wrapper to show
  a scrollbar even on a normal desktop window.
- **Fix**: dropped `min-w-[1040px]` entirely (the table is now `w-full
  text-sm` with no min-width) and made the three least-essential
  columns responsively hidden instead of deleted — Internal Lot # and
  Customer Lot # (`hidden xl:table-cell`, both `<th>` and `<td>`) and
  Paid (`hidden lg:table-cell`) collapse away first as the viewport
  narrows; Bill #/Date/Customer/Grand Total/Balance/Status/Actions
  stay always-visible per the task's preferred column list. The data
  itself is never removed from the row — it's still fetched and still
  present in the DOM, just not shown at that width (and still visible
  via View → Invoice Details, which already showed lot numbers/Paid).
  `overflow-x-auto` was kept on the table's wrapper div for the
  tablet/mobile case where even the trimmed column set still needs to
  scroll — confirmed empirically at 1366/1024/768px (no page-level
  horizontal scroll at any of the three) vs. a 390px mobile width
  (table-level scroll only, page itself still doesn't scroll).
- **Search bar**: placeholder cut from the full six-field list down to
  `Search invoices…`; the full field list ("Search by invoice #, bill
  #, customer, lot #, gate pass #") moved to the input's `title`
  tooltip and a `text-[11px] text-slate-400` helper line directly
  underneath. `searchInput`/the existing 300ms-debounced `search`
  value/`invoicesApi.listInvoices({ search, ... })` call are all
  unchanged — only the input's displayed text changed.
- **Compact actions**: the 7 inline underlined links (View/PDF/Print/
  WhatsApp/Duplicate/Archive-or-Restore/Delete) collapsed to a
  standalone "View" button plus a new `RowActionsMenu` component — a
  small "⋮" toggle button that opens an absolutely-positioned dropdown
  (closes on outside click via a `mousedown` listener on a `ref`'d
  container, cleaned up in a `useEffect`). The menu is purely
  presentational: it takes a plain `RowMenuItem[]` (`label`, `onClick`,
  optional `disabled`/`title`/`className`), and the row's existing code
  decides that array's contents exactly as before — same `isArchived`/
  `canArchive`/`canDelete` checks, same `hardDeleteBlockReason()` call
  from Phase 33 (so Delete is still disabled-with-tooltip, not hidden,
  when blocked), same "View payments" item next to a payment-blocked
  Delete. Nothing about *what* is allowed changed, only that it's now
  one menu click away instead of a row of links.
- **Filter row**: Search given more of the available width
  (`flex-[2_1_260px]`), Customer/Status each `flex-1 basis-[...]`, From/
  To shrunk to a fixed `w-[130px]` each (`shrink-0` on their labels) so
  they don't compete for space — all still in one `flex flex-wrap`
  row that wraps cleanly on narrower screens exactly as it already did.
- **Verified live** (Playwright, dev DB, 4 freshly-registered test
  companies/seeded invoices+payments via direct API calls through the
  authenticated browser session): screenshotted the Invoices tab at
  1366/1024/768/390px — confirmed `document.scrollingElement.scrollWidth
  <= clientWidth` (no page horizontal scroll) at all three desktop/
  tablet widths, lot-number columns correctly disappear at 1024px,
  Paid also gone by 768px; opened the "⋮" menu and confirmed its
  items/order; confirmed a draft/zero-paid invoice's menu Delete is
  enabled plain "Delete", an issued invoice's is "Delete (disabled)"
  with the exact not-draft tooltip, and a draft invoice with a partial
  payment shows the exact has-payment tooltip plus a working "View
  payments" link that navigates to the Payments tab pre-filtered to
  that one customer (and "Show all payments" correctly clears it).
  Dev DB reset (drop + recreate + re-migrate) after verification; no
  stray dev-server processes left running afterward.
- `npm run typecheck`, `npm run build`, and `npm test` (292/292) all
  clean — this phase added no new backend code, so no new backend
  tests were needed; `InvoiceList.tsx` has no dedicated frontend test
  file (consistent with this repo's established convention — see
  "Testing conventions" below), so Playwright live verification was
  the coverage for this change, same as prior frontend-only phases.

## Display Number Format (Phase 35)

A pure display-formatting fix — no stored value, API payload, formula
engine, roundMoney, or calculation changed anywhere. The only kind of
edit in this phase is wrapping an already-final numeric string in
`formatNumber(...)` at the point it's rendered to the screen.

- **The formatter already existed**: `formatNumber()` in `packages/
  shared/src/number-format.ts` (added in Phase 31 for Quick Invoice's
  edit-mode prefill) does exactly what this task asked for —
  `new Decimal(value).toString()`, which trims insignificant trailing
  zeros and never rounds: `"144.00"` -> `"144"`, `"504.50"` ->
  `"504.5"`, `"131.03"` -> `"131.03"` (untouched, both decimals
  meaningful), `"0.00"` -> `"0"`. Using `Decimal` instead of
  `Number`/`toLocaleString` avoids float precision loss on a large
  value like `"4406226.00"`. No new formatter was created — this
  phase just applied the existing one everywhere it was still missing.
- **One central fix covers print/PDF/all 5 templates**: every
  template (`ClassicNavyTemplate`, `ModernCurveTemplate`,
  `MinimalCleanTemplate`, `IndustrialBlueTemplate`,
  `PremiumModernTemplate`) and the server-side PDF HTML renderer
  (`apps/api/.../pdf/render-html.ts`) only ever read fields straight
  off the shared `InvoiceViewModel` — confirmed by grepping all 5
  template files and render-html.ts for every relevant field name;
  none re-derive or reformat anything themselves. So formatting once,
  inside `buildInvoiceViewModel` (`packages/shared/src/
  invoice-view-model.ts`) — item quantity/unitAmount/amount, subtotal,
  discountValue, discountAmount (and `discountLabel`, which embeds
  discountValue in its own string), grandTotal, previousBalance,
  amountPaid, currentBalance — fixed print preview, PDF download, and
  all 5 templates simultaneously, with zero per-template edits.
  `generalQuantity`/`sets` were already trimmed by Phase 30's
  `formatQuantity`/`calculateSets` and needed no change.
- **Everywhere else that reads directly off the raw API response**
  (not through the view model) needed its own `formatNumber(...)`
  call at render time:
  - `InvoiceList.tsx`: Grand Total/Paid/Balance table columns.
  - `InvoiceDetails.tsx` (the separate non-template detail panel):
    each item's quantity/rate/unit amount/total, the subtotal/
    discount/grand-total table footer, and all 5 `StatRow` figures
    (Previous Balance/Grand Total/Total Receivable/Amount Paid/
    Current Balance).
  - `CreateInvoiceForm.tsx` and `QuickInvoiceForm.tsx`'s shared-shape
    `SummaryRow` component now formats its `value` prop internally —
    covers Subtotal/Discount/Grand Total/Previous Balance/Total
    Receivable/Amount Paid/Current Balance in both forms with one
    change per form. `CreateInvoiceForm` additionally gained
    `formatNumber` on its edit-mode prefill (`itemRowFromInvoice`'s
    quantity/rate, `generalQuantity`, `discountValue` initial state)
    and its live per-row preview Amount cell — bringing it up to the
    same clean-number editing behavior `QuickInvoiceForm` already had
    from Phase 31 (its own prefill/Amount cell were already
    formatted and untouched here).
- A value being formatted is never fed back into a calculation: every
  call site wraps `formatNumber(...)` around a value only at the
  JSX render boundary, after every `sumAmounts`/`roundMoney`/
  `previewItemAmount`/`previewDiscount` call it depends on has
  already run on the raw, unformatted string.
- **Test updates**: `invoice-view-model.test.ts` had 2 existing
  assertions expecting the old padded output (`'14.40'`, `'0.00'`)
  updated to the new, correct trimmed expectation (`'14.4'`, `'0'`) —
  this is the intended behavior change this phase makes, not a
  regression. 2 new tests added: one confirming a 7-digit whole-number
  total (`"4406226.00"` -> `"4406226"`) and a two-decimal value
  (`"131.03"`) are each trimmed correctly and independently inside the
  same view model, and one confirming a percentage discount's value is
  trimmed both as its own field and inside the human-readable
  `discountLabel` string (`"Discount (10.00%)"` -> `"Discount (10%)"`).
- **Verified live** (Playwright, dev DB, seeded invoices mixing whole-
  number and decimal totals on the same customer — e.g. grand totals
  of `144.00`/`151.20` and a `131.03` payment side by side): invoice
  list showed `144`/`151.2`/`131.03`/`12.97` with no stray `.00`;
  invoice detail panel showed `14.4` unit amount, `504` general
  quantity, `6` sets; all 5 templates (switched live via the template
  selector) rendered `6666`-style whole numbers cleanly with `79.36`
  Sets correctly kept as a real decimal; Quick Invoice's own detail
  and edit views showed `6666`/`1` with no padding; the PDF download
  endpoint (`GET /invoices/:id/pdf`) still returned 200 with a valid
  PDF. Dev DB reset (drop + recreate + re-migrate) after verification,
  no stray dev-server processes left running.
- `npm run typecheck`, `npm run build`, and `npm test` all clean —
  292/292 API tests, 58/58 shared tests (56 pre-existing + 2 new).

## Responsive Main App Container (Phase 36)

Pure layout/CSS phase — no navigation behavior, calculation, Quick/
Normal Invoice, PDF/print, payment, ledger, or customer logic touched.
Only `App.tsx` changed.

- **Old width**: the post-login shell was one `mx-auto max-w-5xl`
  card (flat 1024px) with a fixed `p-6` on both the outer page `<div>`
  and the card itself, at every viewport from phone to 4K monitor.
- **New strategy**: `w-full max-w-[1400px] mx-auto` on the card — on
  a narrow viewport `w-full` just fills the available width (the
  `max-w` never engages), and past ~1432px (1400 + the outer page
  padding) the card stops growing and centers, so a 1920px screen
  doesn't stretch the invoice table edge-to-edge. Chose a literal
  `max-w-[1400px]` over the `max-w-7xl` (1280px) alternative floated
  in the task — it's inside the requested ~1200-1500px band and a
  closer match to "much more of available screen width" than 7xl
  would've been. Padding on both the outer page div and the card
  itself became responsive (`p-2 sm:p-3 md:p-4 lg:p-6` outer, `p-3
  sm:p-4 lg:p-6` card) instead of a flat `p-6` — small side padding on
  phone, full padding back by desktop.
- **Real mobile bug found and fixed along the way**: verifying at
  360/390px (required by this task) showed the *page itself*
  scrolling horizontally — not the invoice table (already fixed in
  Phase 34), but the top tab nav row (`flex gap-4`, 6-7 tabs
  Dashboard/Overview/Customers/Categories/Invoices/Payments/Audit, no
  wrap, no overflow handling) pushing wider than the viewport. This
  was pre-existing and unrelated to the card-width change itself — a
  flat `max-w-5xl` card would've had the exact same nav overflow at
  360px, it just happened to surface while checking this task's
  explicit breakpoint list. Fixed with `overflow-x-auto` on the nav
  row and `shrink-0` on each tab button, so the nav scrolls within its
  own row (same pattern the invoice table's wrapper already uses)
  instead of forcing the whole page wider. Tab click behavior/active-
  tab styling is byte-for-byte unchanged — only overflow handling.
- **Print/PDF untouched**: every `print:*` class on the shell
  (`print:max-w-none print:rounded-none print:border-0 print:p-0
  print:shadow-none` on the card, `print:min-h-0 print:bg-white
  print:p-0` on the outer div, `print:hidden` on the header/nav rows)
  is exactly as it was — confirmed via diff. Print/PDF sizing lives
  entirely inside the invoice templates and the statement print
  document, several component layers below this shell, so it was
  never affected by the card's on-screen width either way.
- **Verified live** (Playwright, dev DB, 4 seeded invoices): measured
  `document.scrollingElement.scrollWidth` vs `clientWidth` (zero
  page-level horizontal scroll) and the card's actual rendered width
  at all 6 required breakpoints — 360px (344px card, nav scrolls
  internally), 390px (374px), 768px (736px), 1024px (976px), 1366px
  (1318px), 1920px (1400px — capped, centered, confirming the max-
  width engages exactly where expected). Screenshotted each width;
  the invoice list/filters/action menu fit cleanly with the new room
  at 1366/1920, and the mobile layout still stacks/wraps sensibly.
- `npm run typecheck`, `npm run build`, and `npm test` (292/292 API
  tests, unaffected — this phase touches no backend or business-logic
  code) all clean.

## Totals Box Redesign + Show Item Amount (Phase 37)

Customer-facing presentation feature. No calculation, formula,
database numeric precision, ledger, or payment code was touched —
confirmed by a dedicated test in each of the three test files this
phase changed, asserting the same figures either way.

**Totals box redesign** — every template's totals panel went from a
single top border with no padding to a real bordered box:
- `ClassicNavyTemplate` / `MinimalCleanTemplate` / `PremiumModernTemplate`:
  `rounded-md border` (their own accent/slate color) wrapped around
  `px-3/4 py-2/3` padding and `space-y-1/1.5` row spacing, with a
  `border-t` separator directly above the Current Balance row.
- `IndustrialBlueTemplate`: already had a bold filled Current Balance
  bar — wrapped the whole panel (rows + bar) in one `border-2
  rounded-md` box so it reads as a single unit instead of a bar
  floating under an unrelated top border.
- `ModernCurveTemplate`: already a filled rounded violet panel — added
  a `border border-violet-400/40` ring for definition and bumped
  padding/spacing slightly; its existing `border-t border-white/30`
  separator before Current Balance was kept as-is.
- All five keep `vs(compact, ...)` (Phase 27's Large-mode print-safety
  helper) on every new padding/spacing value, so the box doesn't push
  a normal invoice onto a second A5 page under Large text — verified
  live at Small/Medium/Large.

**Show Item Amount** (`showItemAmount` / `show_item_amount`) — a
third display toggle, built as an exact sibling of Phase 30's
`showUnitAmount`/`showItemQuantity`:
- Migration `018_show_item_amount.sql`: `ALTER TABLE invoices ADD
  COLUMN show_item_amount boolean NOT NULL DEFAULT true;` — the
  default alone makes every existing invoice backward compatible
  (keeps showing Amount exactly as it always has).
- `packages/shared/src/entities.ts` (`Invoice.showItemAmount`) and
  `invoice-view-model.ts` (`InvoiceViewModel.showItemAmount`, wired
  into `buildInvoiceViewModel`) — same place `showUnitAmount` already
  lived in both.
- `apps/api/.../invoice.service.ts`: added to `InvoiceInput`, the
  `Invoice` return type, both `INVOICE_HEADER_COLUMNS`-style SELECT
  column lists (`createInvoice`'s header fetch and `listInvoices`'s
  CTE), `createInvoice`'s default (`input.showItemAmount ?? true`)/
  INSERT/return, `duplicateInvoice` (carries it over, like its two
  siblings), and `updateInvoice`'s UPDATE/params.
- `apps/api/.../invoice.routes.ts`: `showItemAmount:
  optionalBoolean(body, 'showItemAmount')` added to the shared
  `parseDiscountAndLot` helper (used by both POST and PATCH).
- `apps/api/.../pdf/render-html.ts`: the `<th>`/`<td>` for the Amount
  column — previously unconditional, unlike Quantity/Unit Amount which
  already had their own toggle — now gated behind
  `invoice.showItemAmount`, both in the header row and every item row.
- All 5 web templates: same gating added around their own `<th>
  Amount</th>` / `<td>{item.amount}</td>`, right after the existing
  `showUnitAmount` conditional. Column order/behavior for every
  on/off combination exactly matches the task's spec (e.g. Item
  Amount OFF alone -> `Description | Quantity | Stitches | Unit
  Amount`; all three OFF -> `Description | Stitches`) — plain
  conditional `<th>`/`<td>` rendering means the table naturally
  resizes to whatever columns remain, no extra width logic needed.
- `apps/web/src/features/invoices/api.ts` (`InvoiceInput.showItemAmount`)
  and `CreateInvoiceForm.tsx` (state init from `invoice?.showItemAmount
  ?? true`, included in the save payload, and a third "Show item
  amount" checkbox added next to the existing two in the Invoice
  Display section). `QuickInvoiceForm.tsx` was deliberately left
  unchanged — `showUnitAmount`/`showItemQuantity` were never exposed
  there either (CreateInvoiceForm-only toggles today), so a Quick
  Invoice simply keeps the migration's default (shown) with no UI
  control, exactly like its two siblings already do.
- **Totals never disappear**: `showItemAmount` only ever gates the
  per-item `<th>Amount</th>`/`<td>{item.amount}</td>` pair — Subtotal/
  Grand Total/Previous Balance/Amount Paid/Current Balance are
  separate `InvoiceViewModel` fields/template `<Row>`s that this
  toggle's conditionals never touch, so they unconditionally render
  regardless of the per-item column's visibility (verified directly:
  a dedicated backend test renders every theme with the toggle off
  and asserts all five total labels are still present in the HTML).
- **Tests**: `apps/api/test/invoice-display-metadata.test.ts` gained a
  dedicated Show-Item-Amount save/read-back test and had its existing
  combos/calculation-safety/edit/duplicate/backward-compat tests
  extended from two toggles to three. `apps/api/test/
  invoice-pdf-html.test.ts` gained column-presence tests for every
  on/off combination (matching the task's exact spec table) plus a
  dedicated "hiding Amount never hides any total" test across every
  theme. `packages/shared/test/invoice-view-model.test.ts`'s pass-
  through and calculation-safety tests extended to all three toggles,
  now also asserting previousBalance/amountPaid/currentBalance are
  identical shown vs. hidden (stricter than before, which only checked
  item/subtotal/grandTotal figures).
- **Verified live** (Playwright, dev DB): created invoices with
  `showItemAmount` true (default) and false via direct API calls, then
  viewed each through every one of the 5 templates in the real print-
  preview UI — screenshotted all 5 with Amount shown, confirming each
  template's own new bordered-box style; screenshotted Classic Navy
  and Industrial Blue with Amount hidden, confirming the Amount column
  disappears from the item table while Subtotal/Grand Total/Previous
  Balance/Amount Paid/Current Balance all still render exactly as
  before; also screenshotted `CreateInvoiceForm`'s Invoice Display
  section showing all three checkboxes (item quantity/unit amount/item
  amount) side by side, all checked by default. Dev DB reset after
  verification, no stray dev-server processes left running.
- `npm run typecheck`, `npm run build`, and `npm test` all clean —
  295/295 API tests (12 net new/updated), 58/58 shared tests.

## Optional Bill Number Visibility on Print/PDF (Phase 38)

A customer-facing print preference, deliberately built with the
smallest possible mechanism rather than a straight copy of Phase 37's
per-template-flag pattern. No calculation, formula, ledger, payment,
invoice numbering, or stored Bill Number value was touched.

- **Migration `019_show_bill_number.sql`**: `ALTER TABLE invoices ADD
  COLUMN show_bill_number boolean NOT NULL DEFAULT true;` — the
  default alone keeps every existing invoice printing Bill Number
  exactly as it always has.
- **Backend plumbing**: `showBillNumber` added to `Invoice`/
  `InvoiceInput` (`entities.ts`, `invoice.service.ts`), both
  SELECT column lists, `createInvoice`'s default (`input.showBillNumber
  ?? true`)/INSERT/return, `duplicateInvoice` (carries the *preference*
  over, same as its three siblings — but never the bill number value
  itself, unchanged from Phase 29), `updateInvoice`'s UPDATE/params,
  and `invoice.routes.ts`'s shared `parseDiscountAndLot` validator —
  exactly the same places Phase 37's `showItemAmount` touched.
- **The key design choice — gate the data, not the data consumers**:
  rather than exposing a `showBillNumber` boolean on `InvoiceViewModel`
  and editing the "Bill #:" conditional in all 5 templates plus
  `render-html.ts` (6 files), `buildInvoiceViewModel`
  (`invoice-view-model.ts`) does the gating once, at the source:
  `billNumber: invoice.showBillNumber ? invoice.billNumber : null`.
  Every template already renders `{invoice.billNumber && <p>Bill #:
  ...}` (needed since day one, to hide the row when no bill number was
  ever set) — Industrial Blue's dynamic `infoGridClass` cell count is
  also already computed from `invoice.billNumber ? 1 : 0`. Nulling the
  view-model field makes "toggled off" behave identically to "never
  set" everywhere data already flows, for every one of the 5 templates
  and the PDF renderer, with **zero template files touched** and no
  risk of one template's gating logic drifting from another's. Chosen
  over the per-template-flag approach specifically because this field
  (unlike `showItemAmount`'s per-row Amount column) has exactly one
  consumer shape — a single optional "Bill #: X" line — so there was
  no second piece of information (like a quantity figure) that still
  needed to render independently of the flag.
- **Inside the app, nothing changed**: `InvoiceList.tsx`,
  `InvoiceDetails.tsx`, `CreateInvoiceForm.tsx`, and invoice search all
  read `Invoice.billNumber` directly off the raw API response — never
  through `InvoiceViewModel` — so none of them saw any change; Bill
  Number stays visible, editable, and searchable regardless of the
  toggle. Verified live: an invoice created with `showBillNumber:
  false` still showed "Bill #: 7777" in `InvoiceDetails`, in the
  invoice list's Bill # column, and remained findable through search
  — only its *template/PDF* output ever hides it.
- **UI**: a fourth "Show Bill Number" checkbox added to
  `CreateInvoiceForm`'s existing Invoice Display section, placed first
  (ahead of Show Item Quantity/Unit Amount/Item Amount) per the task's
  requested ordering — same `useState(invoice?.showBillNumber ?? true)`
  pattern, included in the save payload.
- **Tests**: `packages/shared/test/invoice-view-model.test.ts` gained
  dedicated show/hide/no-other-field-changed tests for the new
  gating line. `apps/api/test/invoice-display-metadata.test.ts`
  gained a save/read-back test, a dedicated "stays saved, visible,
  editable, and searchable inside the app even when hidden from
  print" test (the task's core requirement, exercised end-to-end
  through real create/edit/search API calls), and a calculation-
  safety test; its existing edit/duplicate/backward-compat tests
  extended from three toggles to four, with the edit test also
  re-fetching the invoice afterward to prove the preference survives
  reopening. `invoice-pdf-html.test.ts` needed no new test — its
  pre-existing "hides the Bill # row entirely when billNumber is
  null, across every theme" test already proves the exact behavior
  this toggle produces once `buildInvoiceViewModel` nulls the field.
- **Verified live** (Playwright, dev DB): two invoices on one
  customer, Bill # 4587 (toggle on) and 4588 (toggle off) — both show
  correctly in the Invoices list and search by number regardless of
  their toggle; the toggle-off invoice's template view shows no
  "Bill #:" line and no blank gap in Classic Navy, Industrial Blue
  (confirmed its info-grid drops from 4 cells to 3, not 4-with-one-
  empty), Modern Curve, Minimal Clean, and Premium Modern; its
  `InvoiceDetails` panel still shows "Bill #: 7777" in the header
  line. Dev DB reset after verification, no stray dev-server
  processes left running.
- `npm run typecheck`, `npm run build`, and `npm test` all clean —
  298/298 API tests (3 net new/updated), 61/61 shared tests (3 new).

## Invoice Detail Metadata Reorganization (Phase 39)

Pure UI/presentation phase on `InvoiceDetails.tsx` only — no
calculation, invoice data, database field, formula, ledger, payment,
or API behavior changed. This is the internal business-facing detail
panel (distinct from the 5 customer-facing print templates), and
remains the one place that always shows every field regardless of any
`show*` display toggle — that precedent (set back in Phase 30) is
unchanged here, this phase only restyles how those always-shown
fields are laid out.

- **Old layout**: a single `<p>` with every metadatum joined by " · "
  — `{invoice.customerName} · {invoice.invoiceDate} · {invoice.status}`
  then each optional field appended the same way when present. Hard to
  scan, and wrapped unpredictably at narrow widths.
- **New layout**: a bordered, padded "Invoice Information" card
  (`rounded-md border border-slate-200 bg-slate-50 p-3`) placed right
  below the header row, containing three `MetaGroup`s rendered via
  `space-y-3`:
  - **Invoice** (always rendered, nothing in it is ever empty):
    Invoice No., Date, Status (status string capitalized for display
    only — `invoice.status` itself, 'draft'/'issued'/etc., is never
    touched).
  - **References** (the whole group — title included — skipped
    entirely when none of its four fields have a value): Bill Number,
    Internal Lot, Customer Lot, Gate Pass — each individual field
    still only renders when its own value is non-empty, so a partial
    set (e.g. only Bill Number) shows just that one field, never an
    empty dash for the others.
  - **Quantity** (same whole-group skip when both are empty): General
    Quantity (via the existing `formatQuantity` helper, unchanged),
    Sets (via the existing `calculateSets`, unchanged).
  Each group is a `MetaGroup` (small uppercase muted title + a
  `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3` of
  `MetaField`s) and each `MetaField` is a label/value pair (`text-xs
  text-slate-500` label over `text-sm font-medium text-slate-900`
  value) — matching the "small muted label, bold readable value"
  requirement and the existing `StatRow` convention already used
  lower on the same page for the balance figures, so the new section
  looks native to the page rather than bolted on.
- **Customer name**: moved from the metadata line into its own
  subtitle (`text-xs text-slate-500`) directly under the invoice
  number in the header — it's about *which invoice this is*, not
  reference/quantity metadata, so it stays with the title rather than
  joining a group.
- **Actions stay separate**: Edit/View·Print/Back were already in
  their own `flex items-center gap-3` div on the right of the header
  row, entirely untouched by this change — never mixed into the
  metadata grid.
- **Responsive**: `grid-cols-1` (mobile) → `sm:grid-cols-2` (tablet)
  → `lg:grid-cols-4` (desktop), per field group independently (so
  References' 4 fields and Quantity's 2 fields each reflow on their
  own row pattern rather than sharing one giant grid). Verified live
  at 360/768/1024/1366px: the metadata card itself never causes
  horizontal scroll at any of the four — 1 column at 360, 2 at
  768/the narrow end of desktop, 4 at 1366. (A pre-existing, unrelated
  horizontal scroll on the item table itself at 360px — that table has
  7 fixed columns and was explicitly out of scope, "do not alter the
  invoice item table... unless required for spacing" — was confirmed
  present before this change too and is not something this phase
  introduced or was asked to fix.)
- `npm run typecheck` and `npm run build` clean; `npm test` unaffected
  (298/298 API tests, 61/61 shared — this phase touches no backend
  code, so no test changes were needed).

## Per-Invoice Rate Override (Phase 40)

A task framed as a new feature ("allow a category to be used at
different rates per invoice/customer without duplicating categories")
turned out to already be fully built — this phase's real work was
verifying that thoroughly, closing the specific test gaps the task's
own checklist called for, and a small labeling clarity pass. No
calculation, formula engine, or existing behavior changed.

- **How Default Rate works**: `embroidery_categories.default_rate` is
  only ever a *starting value*. `CreateInvoiceForm`'s category
  `<select>` onChange sets the row's `rate` state directly to
  `cat?.defaultRate ?? ''` (not just a placeholder) — the Rate
  `<input>` is a fully controlled, editable field from that point on.
- **How the override works**: the user edits the Rate input freely;
  `previewItemAmount` recalculates the live preview using
  `rateOverride || category.defaultRate` on every keystroke (same
  formula engine, unchanged). On save, the row's `rate` is sent as
  `InvoiceItemInput.rate`; the backend's `createInvoiceItem`
  (`invoice.service.ts`) resolves `const rate = input.rate ??
  category.defaultRate` — present and used.
- **How the snapshot is stored**: that resolved `rate` is written
  straight into `invoice_items.rate` at INSERT time (and again,
  overwriting the previous rows, when an edit's items are
  recreated by `updateInvoice` — items are deleted and rebuilt from
  the edit payload every time, same as every other field). Every
  downstream read (`InvoiceDetails`, all 5 print templates, the PDF
  renderer) displays this saved `item.rate`/`calculatedUnitAmount`
  directly — never re-joins or re-derives from the category's current
  `default_rate`. A later change to the category's own default rate
  therefore can never retroactively change an already-saved item,
  confirmed by the pre-existing `invoices.test.ts` test "snapshots
  survive later changes to the category rate and formula" (covers the
  create-time case) and this phase's new edit-time equivalent.
- **Category switch resets, never carries over**: `CreateInvoiceForm`'s
  category-select onChange always sets `rate: cat?.defaultRate ?? ''`
  — a manually-overridden rate is deliberately *not* preserved across
  a category change (already documented in an inline comment at that
  exact line from an earlier phase). Backend-equivalent: sending a new
  `categoryId` with no `rate` in an edit resolves to the *new*
  category's own `default_rate`, confirmed by this phase's new test.
- **New test file `apps/api/test/invoice-rate-override.test.ts`** (6
  tests) fills the gaps the task's checklist asked for that weren't
  covered elsewhere: creating with no override (uses category
  default) and with an override (recalculates correctly) as a focused
  pair; editing a draft to change the rate, then reopening via a fresh
  GET, proves the override survives persistence+reopen (not just
  create); changing the category's own default rate *after* an edit,
  twice, proves the edited item's snapshot never moves; switching an
  item's category during an edit with no rate supplied proves it
  resets to the new category's default, not the old override; and a
  dedicated Quick Invoice (manual item, no `categoryId`) test proves
  it's entirely unaffected — category rate changes are irrelevant to
  it, and editing its own `unitPrice` is a plain multiplication with
  no rate/category concept involved at all.
- **UI clarity pass** (the only actual code changes this phase made):
  `CategoryForm.tsx`'s "Default rate" label capitalized to "Default
  Rate" with a new one-line hint underneath ("Starting point only —
  can be overridden per invoice item"); `CreateInvoiceForm.tsx`'s Rate
  `<input>` gained a `title` tooltip with the same message. Both are
  label/hint-only — no behavior changed.
- **Verified live** (Playwright, dev DB): selected a category with
  Default Rate 1.50 on a new invoice — Rate field auto-filled to
  "1.50", Amount showed 180.00 (12 × 1.50 × 10); typed 1.70 into Rate
  — Amount live-recalculated to 204.00 with zero save/reload; saved
  the invoice and confirmed the detail view shows Rate 1.7, Total 204;
  reopened it via Edit and confirmed the Rate field shows "1.7" (the
  saved override), not "1.50" (the category's still-unchanged
  default); switched that row's category to a different one (Default
  Rate 2.20) and confirmed Rate immediately reset to "2.20". Also
  confirmed the new category-form label/hint render correctly. Dev DB
  reset after verification, no stray dev-server processes left
  running.
- `npm run typecheck`, `npm run build`, and `npm test` all clean —
  304/304 API tests (6 new), 61/61 shared tests (unaffected).

## F01 — SVG Logo Upload Stored XSS (Phase 41)

A security-review fix, scoped tightly to the logo upload path only —
no other company profile behavior touched.

- **The vulnerability**: `companyRouter.post('/logo')` accepted
  `image/svg+xml` based solely on the client-supplied `Content-Type`
  header (`LOGO_MIME_TO_EXT` keyed by MIME type), stored the raw bytes
  via `LocalLogoStorage`, and served them back same-origin at
  `/uploads/logos/<companyId>/<uuid>.svg` through `express.static`
  (which sets `Content-Type: image/svg+xml` from the extension). SVG
  is markup, not a flat image format — a `<script>` tag or an
  `onload=`/`onerror=` handler inside it executes if that URL is ever
  opened directly (or embedded via `<object>`/`<iframe>`). The app has
  no SVG sanitizer anywhere, so sanitizing on the way in wasn't a safe
  option — the fix is to never accept or store an SVG at all.
- **`apps/api/src/lib/storage/image-signature.ts`** (new):
  `detectImageSignature(buffer)` checks the buffer's actual leading
  bytes against the three allowed raster formats' magic numbers (PNG:
  `89 50 4E 47 0D 0A 1A 0A`; JPEG: `FF D8 FF`; WEBP: `RIFF....WEBP`)
  and returns `null` for anything else — a well-formed SVG, a renamed
  non-image file, or garbage. This is the authoritative check, run
  against the fully-buffered upload in the route handler itself —
  never just the client's `Content-Type`/filename, which are
  trivially spoofable (an attacker renaming `evil.svg` to `logo.png`
  with `Content-Type: image/png` is exactly what this catches).
- **`apps/api/src/modules/company/company.routes.ts`**: `multer`'s
  `fileFilter` now only allows `image/png`/`image/jpeg`/`image/webp`
  (SVG removed outright) as a cheap first-pass rejection; the route
  handler then calls `detectImageSignature()` on `req.file.buffer` and
  throws a clear `badRequest` with a `logo` field either way (missing/
  wrong-Content-Type file, or a file whose real bytes don't match any
  allowed signature). The saved file's extension now comes from the
  *detected* signature, not the client's claimed MIME type. Auth
  (`requireAuth` + `requirePermission('company.manage')`) on the route
  is completely unchanged — this is a payload-validation fix, not an
  access-control change.
- **`apps/web/src/features/company/LogoUploader.tsx`**: the file
  picker's `accept` list dropped `image/svg+xml` to match (cosmetic —
  the server-side check is the real boundary, a browser file picker's
  `accept` attribute is only ever a UX hint).
- **Tests** (`apps/api/test/company-profile.test.ts`, 6 new, 13/13 in
  the file total): PNG/JPEG/WEBP each accepted and signature-validated
  (new `tiny.jpg`/`tiny.webp` fixtures, generated via ImageMagick,
  alongside the pre-existing `tiny.png`); a benign SVG (`logo.svg`)
  rejected outright even with a legitimate `image/svg+xml`
  Content-Type, and confirms no `logoUrl` was ever saved; a
  script-bearing SVG (`logo-xss.svg` — contains a literal `<script>`
  tag, the actual payload shape F01 describes) rejected the same way;
  an SVG disguised with a spoofed `image/png` Content-Type and
  `logo.png` filename still rejected by the signature check
  specifically (the exact spoofing scenario the fix targets); and
  plain garbage bytes claiming to be a PNG rejected too. The
  pre-existing "uploading a logo stores it, updates logoUrl, and
  serves it back" test (PNG, with replace/cleanup) passes unchanged,
  confirming safe raster logos still work exactly as before.
- `npm run typecheck`, `npm run build`, `npm test` (311/311), and
  `npm run lint` all clean for every file this phase touched (the
  monorepo lint script's one failure, in `membership.service.ts`, is
  pre-existing and untouched by this change — confirmed via `git
  status`/`git diff` showing zero modifications to that file).

## F02 — Prevent Last Active Company Lockout (Phase 42)

A security-review fix, scoped to `company-lifecycle.service.ts` and
its tests only — tenant isolation, permissions, and company-switching
logic (`membership.service.ts`) are untouched.

- **The vulnerability**: `deactivateCompany` and
  `deleteCompanyPermanently` both guarded against stranding the
  caller with `const membershipCount = await countMemberships(...)`
  then `if (membershipCount <= 1) throw ...` — but `countMemberships`
  counted every row in `company_members` for that user, regardless of
  the company's `status`. A user with company A (active) and company
  B (already deactivated, e.g. from an earlier, legitimate
  deactivation) has `membershipCount === 2`, which passes the guard —
  so deactivating or deleting A (their only *active* company) was
  wrongly allowed, leaving them with zero active companies and no way
  to log in to anything.
- **The fix reuses `pickAnotherActiveCompany`** (already existed,
  already correctly filtered `c.status = 'active'` — it was written
  for picking the session's post-action repoint target, not for the
  safety check) as the gate itself: `const newActiveCompanyId = await
  pickAnotherActiveCompany(client, userId, companyId); if
  (!newActiveCompanyId) throw badRequest(...)`. One query now answers
  both "is this safe" and "where does the session land" — the old
  code's second, separate call to the same function (for the repoint)
  was removed and the already-resolved value reused instead, so the
  safety check and the repoint target can never disagree with each
  other.
- **Concurrency**: a `FOR UPDATE` lock on the target company row alone
  doesn't protect this invariant — two concurrent deactivate calls
  targeting a user's *two different* companies (their last two active
  ones) don't contend for the same row, so each could independently
  read "yes, another active company exists" before either commits,
  and both succeed. New `lockUserForLifecycleChange(client, userId)`
  takes a transaction-scoped Postgres advisory lock —
  `pg_advisory_xact_lock(hashtextextended(userId, 0))`, auto-released
  at COMMIT/ROLLBACK, exactly matching `withTransaction`'s lifecycle —
  keyed on the user's id (not the company), called first thing inside
  both `deactivateCompany` and `deleteCompanyPermanently`, before the
  company row lock. This serializes every lifecycle action a given
  user performs across concurrent requests/sessions without affecting
  other users' concurrent lifecycle actions at all (different
  advisory-lock key). `reactivateCompany` deliberately doesn't take
  this lock — reactivating only ever increases the user's active-
  company count, so it can't itself cause the invariant this lock
  protects to break.
- **Tests** (`apps/api/test/company-lifecycle.test.ts`, 5 new, 20/20
  in the file total): 2 active companies → deactivating one allowed;
  1 active + 1 already-deactivated → deactivating the active one now
  blocked (the exact bug scenario — previously this would have wrongly
  succeeded); deleting the last active company blocked even when an
  inactive one exists; an HTTP-level concurrency test (two independent
  login sessions for the same user, each on one of their last two
  active companies, firing `PATCH /company/deactivate` via
  `Promise.all`) asserting exactly one of the two succeeds and the
  account ends with exactly one active company, never zero or both.
  A fifth, more rigorous test was added specifically because the
  HTTP-level one turned out not to reliably exercise the actual race
  in this environment (verified by temporarily disabling the advisory
  lock and re-running the HTTP-level test 15×: it never failed,
  because Node/pg connection timing happened to naturally avoid true
  interleaving) — it opens two raw `pg` connections directly, has one
  hold `pg_advisory_xact_lock` inside an open transaction, and proves
  the second connection's attempt at the *same* lock key provably
  stays pending (checked after a 300ms wait) until the first commits,
  then resolves immediately after. This is the deterministic
  regression guard; the HTTP-level test remains as an end-to-end
  behavioral check on top of it. (Sanity-checked both directions: the
  deterministic test was confirmed to fail when given two different
  lock keys instead of the same one, proving it isn't trivially
  passing.)
- `npm run typecheck`, `npm run build`, `npm test` (316/316), and
  `npm run lint` all clean for every file this phase touched (the
  monorepo lint script's one pre-existing failure, in
  `membership.service.ts`, is confirmed untouched by this change).

## F03 — Historical Invoice Amount Paid Must Never Go Negative (Phase 43)

A correctness fix, scoped to `invoice.service.ts` and
`apps/api/test/ledger.test.ts` only — the authoritative backend
calculation, not any of its downstream consumers (which all already
read the fixed value through, requiring no changes themselves).

- **The bug**: `buildLedgerSummary`'s `amountPaid` field (which feeds
  `InvoiceWithItems` — invoice detail, PDF, WhatsApp, and every
  printable template via `buildInvoiceViewModel`) was computed as
  `totalReceivable - currentBalance`, where `currentBalance` is the
  customer's *overall* live balance (every debit minus every credit
  across the customer's entire history). Because `currentBalance`
  moves whenever *any* invoice is created anywhere in the customer's
  history, an older invoice's derived `amountPaid` could go negative
  purely because a *later* invoice raised the customer's overall
  balance — even though nothing was ever paid toward the older
  invoice specifically. Example from the task: invoice A = 100,
  invoice B = 50, no payment at all → old code: `currentBalance =
  150`, `totalReceivable = 100` (for A), `amountPaid = 100 - 150 =
  -50`. A's paid amount must be `0`, not `-50`.
- **The fix**: `buildLedgerSummary` now takes an `invoiceId` parameter
  and computes `amountPaid` by calling the pre-existing
  `getInvoicePaidAmount(client, companyId, customerId, invoiceId)`
  instead of subtracting from `currentBalance`. `getInvoicePaidAmount`
  already existed (used by `listInvoices`'s `paid_amounts` CTE and by
  `deleteInvoice`'s hard-delete safety check) and already implements
  the one authoritative "how much of this specific invoice has been
  paid" rule: a FIFO allocation where payments are recorded at the
  customer level (never tied to an invoiceId) and applied against the
  customer's oldest outstanding debt first, via a
  `SUM(...) OVER (ORDER BY created_at DESC, id DESC ROWS BETWEEN
  UNBOUNDED PRECEDING AND 1 PRECEDING)` window function. Because this
  figure is keyed to the invoice's own ledger entry and FIFO-ordered
  strictly among debits, it is invariant under later invoices by
  construction — a later invoice's debit can never change it.
  `currentBalance`'s own meaning (the customer's real overall live
  balance) is deliberately left unchanged — it's still correct,
  useful information in its own right (matches the customer ledger
  page's own balance); the task's bug report and goal are specifically
  about "Amount Paid," not "Current Balance," and there is no longer
  an arithmetic identity between the two (intentional — they are now
  two independently-meaningful figures).
- **Consistency across surfaces, with zero extra code changes**:
  `whatsapp-share.service.ts` and the PDF renderer (`render-html.ts`)
  both read `invoice.amountPaid` straight off the already-fixed
  `InvoiceWithItems`/`InvoiceViewModel` object — never recomputing it
  themselves — so fixing `buildLedgerSummary` alone makes invoice
  detail, PDF, WhatsApp, and the invoice list agree by construction.
  `dashboard.service.ts`'s unpaid/partial invoice count was checked
  and confirmed to already use the identical FIFO `cumulative_before`
  window-function pattern — no separate bug there, no changes needed.
- **Tests** (`apps/api/test/ledger.test.ts`): 4 new, matching the
  task's own checklist verbatim — two invoices, no payment, older one
  shows `amountPaid: '0.00'` (not `-50.00`), confirmed via both the
  detail endpoint and the list endpoint's `paid`/`paymentStatus`
  fields; a 40.00 partial payment allocates FIFO to the older invoice
  only, with detail and list agreeing exactly; a 100.00 payment fully
  pays the older invoice (`paymentStatus: 'PAID'`) while the newer one
  stays `'UNPAID'`; creating a second, later invoice is proven not to
  change the first invoice's already-read `amountPaid` at all. One
  pre-existing test (`'a full customer statement: opening balance,
  invoice, and a partial payment'`) had its hardcoded expectation
  corrected from `'200.00'` to `'150.00'` — that scenario has an
  opening balance *older* than the invoice, so under correct FIFO the
  first 50.00 of a 200.00 payment pays off the opening balance before
  any of it reaches the invoice; the old number was the old buggy
  formula's coincidental output, not a correct expectation.
- `npm run typecheck`, `npm run build`, `npm test` (320/320), all
  clean. `npm run lint` has the same one pre-existing, unrelated
  failure in `membership.service.ts` (`'_status'`/`'_deactivatedAt'`
  unused) that predates this session's work and is confirmed
  untouched by this change.

## F04 — Paid Draft Invoice Delete Guard (Phase 44)

A correctness fix to the one shared FIFO payment-allocation rule
itself, now extracted into `apps/api/src/lib/ledger-fifo.ts` and
reused by all three of its consumers — `listInvoices`,
`getInvoicePaidAmount` (invoice detail + the delete guard), and the
dashboard's unpaid/partial count.

- **The bug**: `listInvoices`'s `paid_amounts` CTE and
  `getInvoicePaidAmount` both filtered `le.type = 'INVOICE'` *inside*
  the window that computes `cumulative_before` (the total of every
  ledger entry strictly newer than this one). `current_balance`
  (from the sibling `balances` CTE) sums every debit/credit regardless
  of type, but `cumulative_before` only summed INVOICE-type debits —
  so a later debit ADJUSTMENT raised `current_balance` without ever
  appearing in `cumulative_before`, making the subtraction
  `current_balance - cumulative_before` overstate how much of an
  older invoice was still unpaid. Reproduction from the task: draft
  invoice 100, payment 100 (invoice fully paid), then a later, unrelated
  debit adjustment of 100. Old code: `current_balance = 100` (100 +
  100 - 100), `cumulative_before = 0` (no other INVOICE rows), so
  `paid = 100 - LEAST(100, GREATEST(100-0,0)) = 0` — the already-paid
  invoice looked completely unpaid again, and `deleteInvoice` (which
  calls `getInvoicePaidAmount` for its delete-safety check) would have
  wrongly allowed permanently deleting a draft invoice a payment had
  already reached. Under correct FIFO, the adjustment is a *newer* debt
  and sits behind the invoice in the payment queue — it must never
  make an older, already-paid invoice look unpaid.
  `dashboard.service.ts`'s `getUnpaidOrPartialInvoiceCount` had
  already gotten this right (it windows over every debit-positive row,
  filtering to `type = 'INVOICE'` only in the outer `WHERE`, after the
  window) — confirming the correct pattern and showing the two
  `invoice.service.ts` queries just needed to match it.
- **The fix**: extracted the one correct pattern into a new shared
  helper, `fifoPaidCtes(companyIdParam, customerIdParam?)` in
  `apps/api/src/lib/ledger-fifo.ts`, that windows `cumulative_before`
  over every positive-debit ledger entry (opening balance, invoices,
  debit adjustments) and leaves any narrowing to `type = 'INVOICE'`
  to the caller's outer query — never inside the CTE itself. All
  three consumers (`listInvoices`, `getInvoicePaidAmount`, and
  `getUnpaidOrPartialInvoiceCount`) now build their query on this one
  fragment instead of three independent hand-rolled copies, so they
  can never drift out of sync again (the task's "do not duplicate
  separate payment logic in multiple places" requirement).
  `deleteInvoice`'s guard required no changes at all — it already
  calls `getInvoicePaidAmount`, so fixing that one function
  automatically fixes the guard.
- **Tests** (`apps/api/test/invoice-archive.test.ts`, 4 new): the
  exact report scenario (draft 100, payment 100, debit adjustment 100
  -> invoice stays `amountPaid: '100.00'`/`PAID`); the same scenario's
  delete attempt is rejected (400, "payment" in the error detail); a
  draft invoice with no payment toward it is still deletable even when
  an unrelated sibling debit adjustment exists; and a combined check
  that invoice detail's `amountPaid`, the list's `paid`/`paymentStatus`,
  and the dashboard's `unpaidOrPartialInvoiceCount` (0, since the
  invoice is fully paid) all agree after the same adjustment.
- `npm run typecheck`, `npm run build`, `npm test` (324/324), all
  clean. `npm run lint` has the same one pre-existing, unrelated
  failure in `membership.service.ts` confirmed untouched by this
  change.

## F05 — Discount Input Must Not Crash During Typing (Phase 45)

A correctness fix scoped to `apps/web/src/features/invoices/preview.ts`
only — `CreateInvoiceForm.tsx` and `QuickInvoiceForm.tsx` both already
call `previewDiscount` the same way and needed no changes themselves.

- **The bug**: `previewDiscount` built `new Decimal(discountValueRaw ||
  '0')` directly from the raw Discount `<input>`'s value on every
  render (via a `useMemo`). `decimal.js`'s constructor throws a
  `DecimalError` for anything that isn't a well-formed number —
  including `'-'`, `'.'`, and `'abc'`, all of which are everyday,
  completely normal states for a text field mid-keystroke (typing a
  negative number starts with `'-'`; typing `10.5` passes through
  `'10.'`). Because this ran inside a render-time `useMemo` with no
  try/catch anywhere above it, typing any of those characters threw
  during render and crashed the component tree, silently discarding
  the rest of the in-progress invoice form (items, customer, notes —
  everything unsaved).
- **The fix**: new `parseDiscountValue(raw)` helper wraps the `Decimal`
  construction in try/catch and also checks `.isFinite()` (catches
  `'Infinity'`/`'NaN'`, which `decimal.js` parses without throwing but
  which aren't usable discount values either) — returning `null` for
  anything invalid instead of ever throwing. Blank/empty input returns
  `new Decimal(0)`, not an error — a field the user hasn't typed into
  yet shouldn't show red. `previewDiscount` now calls this helper and,
  when it returns `null`, returns its normal non-throwing
  `DiscountPreview` shape with `error: 'Enter a valid discount
  number'` — the exact same shape already used for the pre-existing
  "cannot be negative"/"must be between 0 and 100"/"cannot exceed the
  subtotal" validation errors, so both forms' existing
  `errors.discountValue` wiring (already reading `discountPreview.error`
  in their `validate()` functions) picks it up with no changes on
  their end. Valid inputs (`'10'`, `'10.5'`, negative-number and
  over-bounds checks) behave exactly as before — only the parsing step
  changed, not the arithmetic.
- **Why this fixes "do not lose unsaved invoice form state"**: once
  `previewDiscount` can no longer throw, React never unmounts the form
  component mid-render, so `items`/`customerId`/`notes`/every other
  piece of in-progress state the form already held survives typing any
  invalid character — no separate state-preservation code was needed.
- **Tests**: `apps/web` had no test runner or test file at all before
  this phase (confirmed — no `test` script, no test framework
  dependency). Since `preview.ts` is a pure function with no React/DOM
  dependency (same as `@invoice/shared`'s own pure logic), added the
  same `tsx --test test/*.test.ts` convention `packages/shared`
  already uses: a new `test` script + `tsx` devDependency in
  `apps/web/package.json`, wired into the root `npm test` script
  (`apps/web/test/preview.test.ts`, 9 new tests — empty, `'-'`, `'.'`,
  `'abc'`, `'10'`, `'10.5'`, a sweep of invalid inputs across every
  discount type confirming none throw, the pre-existing negative-value
  error, and the pre-existing percentage/fixed bounds checks, all
  still correct).
- `npm run typecheck`, `npm run build`, `npm test` (shared + api
  324/324 + web 9/9, all clean), and `npm run lint` (the one
  pre-existing `membership.service.ts` failure aside — confirmed
  untouched; `@invoice/web`'s lint run separately is clean, its two
  pre-existing warnings in `App.tsx`/`PaymentsPage.tsx` untouched by
  this change).

## F06 — Quick Invoice Save Must Be Retry-Safe (Phase 46)

A correctness fix scoped to the frontend only — no backend endpoint,
transaction, or idempotency key was added; see the rationale below for
why a frontend fix was preferred.

- **The bug**: `QuickInvoiceForm.tsx`'s `handleSubmit` (the "Paid"
  convenience path) made three separate network calls in sequence —
  `createInvoice`, then (if "Paid" was checked) `createPayment`, then
  a `getInvoice` refetch — with no backend transaction tying them
  together and no record kept of which step had already succeeded. If
  `createPayment` or the refetch failed (network blip, a dropped
  response, a backend 5xx) and the user — seeing the error — clicked
  Save again, `handleSubmit` ran from scratch and called `createInvoice`
  a second time, creating a real duplicate invoice (with its own ledger
  debit) for what was, from the user's perspective, one save attempt.
  A 100% discount (zero-total) invoice made this worse: `createPayment`
  with a 0.00 amount is rejected by the backend's
  `requirePositiveDecimal` (must be `> 0`), so checking "Paid" on a
  fully-discounted invoice guaranteed the payment step would fail on
  every attempt, forcing exactly the retry that duplicates the invoice.
- **Why a frontend fix, not a combined backend endpoint**: a truly
  bullet proof fix would need a new transactional "create + pay"
  endpoint with a client-supplied idempotency key (to survive even a
  request that *reaches* the server and succeeds but whose *response*
  is lost) — a materially bigger change (new route, new idempotency
  storage, a key surviving across retries) than this bug warrants.
  Within a single mounted form, retaining the created invoice's id in
  memory and skipping any step already completed is just as safe for
  the actual failure modes this bug covers (a request that fails before
  ever reaching/completing on the server) and needed no backend changes
  at all — the "Otherwise implement robust frontend recovery with
  created invoice ID" fallback the task allowed for.
- **The fix**: extracted the three-call sequence out of the component
  into a new pure, dependency-injected function,
  `saveQuickInvoice(state, input, deps)`
  (`apps/web/src/features/invoices/quick-save.ts`). `state` —
  `{ invoice, paymentCreated }` — is a plain mutable object the *caller*
  owns; `QuickInvoiceForm` keeps one in a `useRef` (`saveStateRef`) so
  it survives a failed `handleSubmit` and is still there on the next
  click, but is thrown away (a fresh one) the instant a save actually
  succeeds. `saveQuickInvoice` fills in `state.invoice` the moment
  `createInvoice` resolves and `state.paymentCreated` the moment
  `createPayment` resolves — *before* either can throw on what comes
  next — and checks both at the top of every call: a retry with the
  same `state` skips `createInvoice` if `state.invoice` is already set,
  and skips `createPayment` if `state.paymentCreated` is already true,
  resuming only from whichever step actually failed. A zero-total
  invoice (`new Decimal(invoice.grandTotal).greaterThan(0)` is false)
  never attempts `createPayment` at all, even with "Paid" checked —
  the F06 "skip the doomed zero payment request" requirement.
- **Tests** (`apps/web/test/quick-save.test.ts`, 5 new, using mocked/
  sometimes-failing `deps` with call counters — no DOM/React rendering
  needed since the extracted function has no React dependency): a
  100%-discount Paid invoice saves with exactly one `createInvoice`
  call and zero `createPayment` calls; a payment failure followed by a
  retry (same `state`) results in exactly one `createInvoice` call
  total; a refetch failure followed by a retry results in exactly one
  `createInvoice` call and exactly one `createPayment` call (the
  payment is not re-sent just because the refetch was); a three-attempt
  flaky-refetch sequence (fail, fail, succeed) still shows exactly one
  `createInvoice` and one `createPayment` call across all three
  attempts; and an unpaid invoice never calls `createPayment` or
  `getInvoice` at all (unchanged behavior, confirmed not to regress).
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  324/324 + web 14/14, all clean), and `npm run lint` (the one
  pre-existing `membership.service.ts` failure aside, confirmed
  untouched; `@invoice/web`'s lint is clean, same two pre-existing
  unrelated warnings as before).

## F07 — Quick Invoice Duplicate (Phase 47)

A correctness fix scoped entirely to `duplicateInvoice`
(`apps/api/src/modules/invoices/invoice.service.ts`) — nothing about
createInvoice, createManualInvoiceItem, or the category-item path
changed.

- **The bug**: `duplicateInvoice`'s very first check was
  `if (original.items.some((item) => !item.categoryId)) throw ...`
  (deleted category). A manual (Quick Invoice) item has
  `categoryId === null` by design — every single item on a Quick
  Invoice does, always, by construction (see `InvoiceItem.categoryId`'s
  doc comment) — so this guard fired on *every* Quick Invoice, 100% of
  the time, not just the intended "a category item's category was
  later deleted" case. Quick Invoice duplication was completely broken.
- **The fix**: `original.invoiceMode` — already server-derived from
  the items actually saved (`invoiceModeFromItems`: `'quick'` only
  when *every* item is manual, never client-supplied) — is the one
  authoritative signal that tells the two null-categoryId cases apart:
  `'quick'` means null categoryId is normal and expected; `'standard'`
  with a null-categoryId item means a category really was deleted out
  from under it. The deleted-category guard now only runs when
  `original.invoiceMode !== 'quick'`, so it still fires exactly where
  it always did for a standard invoice, and never fires for a Quick
  Invoice at all.
- **Manual item duplication**: for a Quick Invoice, each item's
  `InvoiceItemInput` now builds `{ description, quantity, unitPrice }`
  instead of `{ categoryId, description, stitches, quantity, rate }` —
  `unitPrice` comes from the saved item's `calculatedUnitAmount`
  (`createManualInvoiceItem` stores `unitPrice` there directly, with
  no separate formula input/output distinction for a manual item, same
  as it does in `rate`). `lineAmount`/`calculatedTotal` is never
  copied — `createManualInvoiceItem` always recalculates it fresh from
  `quantity * unitPrice`, exactly as it does for a brand-new Quick
  Invoice. The category-item branch is byte-for-byte what it already
  was.
- **Everything else about duplication is unchanged**: the new
  duplicate is still always a fresh `'draft'` (via `createInvoice`,
  same as before), and payments are still never copied — `createInvoice`
  only ever creates a new invoice + its own ledger debit, with no path
  that touches `payments` at all.
- **Tests** (`apps/api/test/invoice-history.test.ts`): 1 new — a Quick
  Invoice with two manual items (description/quantity/unitPrice) and a
  full payment duplicates successfully into a fresh `'draft'`,
  `invoiceMode: 'quick'` invoice with the same total, each item's
  description/quantity/calculatedUnitAmount/calculatedTotal preserved
  (categoryId still `null`, as expected), and `amountPaid: '0.00'`
  confirming the payment was not copied. The pre-existing "duplicate
  rejects when an item references a category that no longer exists"
  test (deleted-category case) was re-run and still passes unchanged —
  confirming that path still errors correctly.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  325/325 + web 14/14, all clean), and `npm run lint` (the one
  pre-existing `membership.service.ts` failure aside, confirmed
  untouched; `@invoice/web`'s lint run separately is clean).

## F08 — Company Optional Fields Must Be Clearable (Phase 48)

A correctness fix spanning all three layers the task asked to align:
the frontend payload (`CompanyProfileForm.tsx`/new `profile-patch.ts`),
backend validation (`validate.ts`), and the SQL update logic
(`company.service.ts`).

- **The bug, three layers deep**:
  1. **Frontend**: `CompanyProfileForm`'s submit handler only included
     a field in the patch `if (value.trim() !== '')` — so blanking a
     field in the UI and saving just... omitted it, identical to never
     having touched it at all. The old code's own comment said as
     much: "an untouched blank field should mean leave it as is, not
     clear it" — true, but it had no way to tell "untouched" apart
     from "the user just cleared it", so it always guessed
     "untouched".
  2. **Validation**: even if the frontend had sent `phone: ''` or
     `phone: null`, `optionalString` (via `requireString`, `min`
     defaulting to 1) rejected it outright with "Must be 1-200
     characters" — there was no validation path that accepted an
     empty/null value as legitimate input at all.
  3. **SQL**: `updateCompany` used `COALESCE($N, column)` with
     `patch.phone ?? null` — so even a field that *did* make it
     through as `null` collapsed to the same NULL parameter an omitted
     field would, and COALESCE always fell back to the existing value
     either way. There was no way to clear a column through this
     query, period.
- **The fix, one per layer**:
  1. **Frontend**: new `buildProfilePatch(form, original)`
     (`apps/web/src/features/company/profile-patch.ts`, extracted out
     of the component as its own pure, testable module — same
     "`only-export-components` lint warning avoided by giving logic
     its own file" pattern as `preview.ts`/`quick-save.ts`) diffs the
     current form state against an `original` snapshot (new
     `useState`, updated alongside `form` after every successful
     save). A field equal to its original value is omitted entirely;
     a changed field that's now blank is sent as `null`; a changed,
     non-blank field is sent as-is.
  2. **Validation**: new `optionalClearableString`/
     `optionalClearableEmail` (`apps/api/src/lib/validate.ts`) —
     unlike `optionalString`, these treat `null`/empty/whitespace-only
     as the valid "clear" signal (returning `null`) rather than
     rejecting it, while still returning `undefined` when the key is
     absent from the body at all and still validating/trimming a
     non-blank value exactly like before. Wired into
     `company.routes.ts` for every *nullable* profile column
     (`factoryName`, `ownerName`, `phone`, `whatsapp`, `email`,
     `address`, `taxNumber`, `invoiceTerms`); `name`,
     `defaultCurrency`, `invoicePrefix`, and `defaultInvoiceTemplate`
     stay on `optionalString` since their columns are `NOT NULL` —
     there's no "clear" state for them, so blanking one is correctly
     still a 400.
  3. **SQL**: `updateCompany` no longer builds one fixed `COALESCE`
     statement — it now builds the `SET` clause dynamically from a
     new `PATCH_COLUMNS` list of `[column, patchKey]` pairs, including
     a column only when its key is actually present in `patch`
     (`!== undefined`) and assigning its value directly (a string, or
     `null`) rather than through `COALESCE`. A key missing from the
     patch is left out of the `SET` clause entirely, so that column is
     untouched — not "coalesced with itself", genuinely never
     mentioned in the query.
- **Tests**: `apps/api/test/company-profile.test.ts` (4 new) — an
  explicit `null` clears phone/address while an omitted `invoiceTerms`/
  `factoryName` in the same patch stays unchanged (checked via both
  the PATCH response and a fresh GET refetch); an explicit empty
  string clears a field the same as `null`; clearing one field doesn't
  touch untouched sibling fields in the same patch; and `name`/
  `defaultCurrency`/`invoicePrefix`/`defaultInvoiceTemplate` still
  reject an attempt to blank them (400), confirming the NOT NULL
  columns were deliberately left out of the "clearable" contract.
  `apps/web/test/profile-patch.test.ts` (7 new, pure-function tests —
  no DOM/React needed) — every omitted/changed/cleared/blank-vs-
  untouched combination `buildProfilePatch` has to get right,
  including whitespace-only input counting as a clear and one field's
  clear never pulling in an untouched sibling.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  329/329 + web 21/21, all clean), and `npm run lint` (the one
  pre-existing `membership.service.ts` failure aside, confirmed
  untouched; `@invoice/web`'s lint run separately is clean — same two
  pre-existing unrelated warnings as before, no new ones).

## F09 — WhatsApp Customer PDF Access (Phase 49)

A security fix adding one new, deliberately public surface — every
other invoice route, including the PDF download route itself, is
completely unchanged and stays exactly as authenticated as before.

- **The vulnerability**: the WhatsApp share message's PDF link
  (`buildPublicPdfUrl`, in the old `whatsapp-share.service.ts`) pointed
  straight at `GET /api/invoices/:id/pdf` — the normal, authenticated,
  `requirePermission('invoice.view')`-gated download route. A customer
  following that link from WhatsApp has no company login or session
  cookie at all, so the link was simply unopenable by its intended
  recipient; the only way it could ever resolve to a PDF was if the
  customer happened to already be logged into the company's own
  account, which defeats the purpose of sending it to them.
- **The fix — a new, invoice-specific, expiring, unguessable public
  link**, modeled directly on this app's existing login-session
  pattern (see `auth.service.ts`/migration 001):
  - New table `invoice_pdf_share_tokens` (migration 020): `company_id`,
    `invoice_id`, `token_hash` (SHA-256 of the real token — never the
    token itself), `expires_at`. `ON DELETE CASCADE` on both foreign
    keys, so a deleted invoice or company takes its share tokens with
    it.
  - New `apps/api/src/modules/invoices/invoice-share.service.ts`:
    `createInvoicePdfShare(companyId, invoiceId)` mints a 32-random-byte
    `newToken()` (lib/token.ts — already used for sessions), stores
    only its hash, and sets `expires_at` from the new
    `config.invoicePdfShareTtlHours` (default 168h/7 days, same style
    as `sessionTtlHours`). `resolveInvoicePdfShare(token)` hashes the
    presented token and looks it up with `expires_at > now()` —an
    unknown token, an expired one, and one for an invoice that's since
    been deleted all produce the exact same `notFound` (never
    distinguished, so a public caller can't learn anything from the
    difference). `buildCustomerPdfShareUrl(base, companyId, invoiceId)`
    replaces the old `buildPublicPdfUrl`: same "omit the link entirely
    when there's no usable public base URL" guard (no point minting a
    token nobody could ever use), but when there is one, it mints a
    real token and builds `${base}/api/public/invoice-pdf/${token}`.
  - New `invoice-share.routes.ts`, mounted at `/api/public` in
    `app.ts` (its own path, deliberately never nested under
    `/api/invoices`, so it can never become reachable by someone
    loosening that router's auth middleware later) — one route,
    `GET /invoice-pdf/:token`, with **no `requireAuth`, no
    `requirePermission`, and no invoice id anywhere in the URL at
    all**: the token is the sole identifier, resolved to exactly the
    one invoice (and company) it was minted for, then served through
    the exact same `generateInvoicePdf` the authenticated route uses.
    A basic shape check (new `requireTokenParam`, matching
    `newToken`'s base64url alphabet) rejects an obviously-malformed
    token before ever touching the database. A new, generous
    `invoicePdfShareRateLimiter` (60 requests/15 min per IP) adds
    defense-in-depth against an automated guessing sweep, on top of
    the token's own 256 bits of entropy.
  - `buildInvoiceWhatsAppShare` (`whatsapp-share.service.ts`) now
    calls `buildCustomerPdfShareUrl` instead of the removed
    `buildPublicPdfUrl` — the only change to that file.
- **Security properties satisfied directly by this shape, not by
  extra checks bolted on**: the private route
  (`GET /api/invoices/:id/pdf`) is untouched and still fully
  authenticated — there is no new "public mode" flag on it, just an
  entirely separate route; a share link can only ever reach the one
  invoice its token was minted for, because there is no second
  identifier (an invoice id) anywhere in the public route's URL for
  anyone to tamper with — "changing the ID" isn't a thing this URL
  shape has; the token is 32 cryptographically random bytes
  (`node:crypto`'s `randomBytes`), stored only as a hash, so
  guessing or reading it back out of a compromised database are both
  infeasible; and every token carries its own `expires_at`, enforced
  on every resolution.
- **Tests** (`apps/api/test/invoice-share.test.ts`, 7 new, plus one
  updated in `whatsapp-business-cloud-api.test.ts` for the renamed
  pure-function cases): a valid token opens the right PDF with a bare
  unauthenticated request (no cookie at all); an unknown token and an
  explicitly-expired one (its `expires_at` force-set into the past)
  are both rejected with 404; a token minted for invoice A is proven,
  via both the resolved `invoiceId` and the served PDF's filename, to
  never reach invoice B (there being no id in the URL to change); a
  token is scoped to its own `companyId`, confirmed distinct from a
  second company's; the private PDF route is confirmed still 401
  without login and 200 with it, completely unchanged; and
  `buildCustomerPdfShareUrl` is confirmed to never embed the raw
  invoice id in the URL it builds, and the token it does produce
  resolves back to the correct invoice.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  336/336 + web 21/21, all clean), and `npm run lint` (the one
  pre-existing `membership.service.ts` failure aside, confirmed
  untouched; `@invoice/web`'s lint run separately is clean — this
  phase touched no frontend code at all).

## F10 — Reset Payment Customer Filter on Company Switch (Phase 50)

A frontend-only correctness fix — no backend behavior change, exactly
as the task allowed for. Two small, cooperating fixes, both needed:
clearing the state one level up (App) isn't enough if the consumer
(PaymentsPage) doesn't also sync to the cleared value.

- **The bug**: `App.tsx`'s `paymentsCustomerFilter` state (set by
  "View payments" from an invoice row, read by `PaymentsPage` via its
  `initialCustomerId` prop) was never reset on a company switch or a
  logout/login transition — it's plain `useState` with no effect
  watching `me?.company.id` at all, unlike `showProfile` right above
  it, which already had exactly that effect. `PaymentsPage` itself
  does remount on a company switch (`key={me.company.id}` in App), so
  it looked reset at a glance, but a freshly-mounted instance still
  read its initial `customerFilter` state from whatever stale
  `initialCustomerId` prop App handed it at that same render — Company
  A's customer id, carried straight into Company B's fresh component
  instance.
- **The fix, two parts**:
  1. New `useEffect(() => setPaymentsCustomerFilter(undefined),
     [me?.company.id])` in `App.tsx`, placed right next to the
     existing `showProfile` reset effect and following the exact same
     pattern. `me?.company.id` changes on every company switch *and*
     on every logout/login transition (it becomes `undefined` on
     logout, then whatever the next login's company is — even
     re-logging into the same company counts as a change, since it
     passes through `undefined` first), so this one effect covers
     both F10 requirements at once.
  2. `PaymentsPage.tsx`'s own `initialCustomerId`-sync effect used to
     only react when the prop was truthy (`if (initialCustomerId)
     setCustomerFilter(initialCustomerId)`) — a one-way "pick this up"
     rule written back when `initialCustomerId` could only ever go
     from unset to set, never back down. Now that App actively clears
     it to `undefined` on every company switch, this had to become
     symmetric: `setCustomerFilter(initialCustomerId ?? '')`,
     unconditionally syncing to whatever the prop now is, including
     back to "no filter". Confirmed this doesn't fight the page's own
     "Show all payments" button (`setCustomerFilter('')` directly) —
     that button never touches the `initialCustomerId` prop itself, so
     this effect's dependency never re-fires because of it.
  - Walked through the actual React commit order (child effects fire
    before parent effects in the same commit) to confirm there's no
    user-visible stale-filter flash in practice: `PaymentsPage` is
    only ever mounted while its own tab is active, and `CompanySwitcher`
    only renders under the Overview tab — the two are never mounted at
    the same time, so by the time a user actually clicks into Payments
    after switching companies (necessarily a separate tab click), the
    App-level effect has already run and `initialCustomerId` is
    already `undefined` from that component's very first render.
- **Verified live** (Playwright against the real dev server + browser,
  one freshly-registered company via the actual register/login forms,
  with a customer/invoice/payment seeded through direct API calls
  inside that authenticated browser session — same convention as
  prior frontend-only phases, e.g. Phase 34): registered Company A,
  used the real "⋮ → View payments" UI action on the invoice row to
  set the filter, confirmed the "Showing payments for one customer"
  banner was present; created Company B through the real
  "create another company" form (auto-switches the active company);
  opened Payments on Company B and confirmed the banner was *not*
  present; switched back to Company A, re-applied the filter, logged
  out and back in through the real login form, opened Payments again
  and confirmed the banner was again *not* present. **Regression-
  checked the test itself**: temporarily reverted both files (`git
  stash`) and re-ran the identical script — both scenarios then failed
  exactly as expected (stale filter visible in both cases), proving
  the verification actually exercises the bug rather than trivially
  passing; restored the fix and re-ran clean before moving on.
  `apps/web` has no dedicated test file for this change, consistent
  with this repo's established convention for a change that is
  fundamentally about React component-tree/effect timing (no pure
  logic to extract the way `preview.ts`/`quick-save.ts`/
  `profile-patch.ts` could be) — the live Playwright run, including
  its negative control, is the coverage.
- `npm run typecheck`, `npm run build`, and `npm test` (shared 61/61 +
  api 336/336 + web 21/21 — unchanged counts, since this phase added
  no new backend or pure-function code) all clean. `npm run lint`'s
  one pre-existing `membership.service.ts` failure is confirmed
  untouched; `@invoice/web`'s lint picked up two new instances of the
  same `set-state-in-effect` warning oxlint already raised on the
  pre-existing `showProfile` effect right above my new one (and on
  `PaymentsPage`'s own pre-existing sync effect) — same idiom, same
  warning-not-error severity, no new lint failures.

## Final Quality Pass After F01–F10 (Phase 51)

No new functionality — purely cleaning up the two remaining lint
issues the F01–F10 run had left as pre-existing/newly-introduced
warnings, then re-verifying all ten fixes together.

- **`membership.service.ts`'s two `no-unused-vars` errors**: these
  were never a real bug — `switchCompany`'s
  `const { status: _status, deactivatedAt: _deactivatedAt, ...membership } = rows[0]`
  deliberately destructures those two fields only to drop them from
  the returned object, and `_`-prefixing is this codebase's existing
  convention for "yes, deliberately unused" (already configured for
  function *arguments* via `argsIgnorePattern: '^_'` in
  `apps/api/eslint.config.js`). The config simply never extended that
  same convention to local/destructured *variables*. Fixed by adding
  `varsIgnorePattern: '^_'` alongside the existing `argsIgnorePattern`
  — a one-line config change, no code touched, and confirmed (via a
  repo-wide grep) that this is the only `_`-prefixed variable in the
  codebase, so nothing else is newly masked by it.
- **`App.tsx`/`PaymentsPage.tsx`'s `set-state-in-effect` warnings**
  (the F10 phase's own two new "reset state when `me?.company.id`/
  `initialCustomerId` changes" effects, plus the pre-existing
  `showProfile` effect they sat next to): rewritten using the
  React-docs-endorsed alternative to a `useEffect` for exactly this
  shape of problem — "Adjusting state when a prop changes" — a
  **state** variable (not a ref: a first attempt using `useRef` fixed
  the warning in `App.tsx` but oxlint's separate `react(refs)` rule
  caught the same pattern in `PaymentsPage.tsx`, correctly: reading
  `ref.current` during render is unreliable because mutating a ref
  never itself schedules the re-render a render-phase read depends
  on) tracks the last-seen value, compared and conditionally
  `setState`'d directly in the render body, not inside any
  `useEffect` at all. This actually resolves the underlying concern
  the lint rule flags (an extra commit-then-effect round trip) rather
  than just silencing the warning — the reset now lands in the exact
  same render the triggering value changes in. Confirmed zero oxlint
  warnings (not just zero errors) after this change, and re-ran the
  full F10 Playwright verification (register, view-payments, create a
  second company and switch, logout/login) against the refactored
  code — identical PASS results to the original `useEffect`-based
  version.
- **Full regression pass, F01–F10**: re-ran the complete `npm test`
  suite (`shared` 61/61, `api` 336/336, `web` 21/21 — 418 tests, 0
  failures) with the lint fixes in place, plus a targeted
  `--test-name-pattern` sweep for every backend finding's own tests
  individually (F01, F02, F03, F04, F06, F07, F08, F09 — all still
  pass) and the frontend-only findings' own test files (F05's
  `preview.test.ts`, F06's `quick-save.test.ts`, F08's
  `profile-patch.test.ts` — all still pass). F10 has no dedicated test
  file (frontend component-lifecycle behavior with no pure logic to
  extract — see Phase 50) and was re-verified live via the same
  Playwright script used when it was originally fixed, against the
  rewritten (no-`useEffect`) version of the reset logic.
- `npm run typecheck`, `npm run build`, `npm test`, and `npm run lint`
  — all four run clean from the repo root, `npm run lint` with zero
  errors *and* zero warnings for the first time since F01 (every
  prior phase's lint run carried the one `membership.service.ts`
  failure and/or the `set-state-in-effect` warnings as "confirmed
  pre-existing, untouched").

## F01 Re-Verification + Serving Hardening (Phase 52)

Explicitly re-audited the Phase 41 SVG-upload fix from scratch rather
than trusting it — read every layer (multer fileFilter, the frontend
`accept` attribute, `detectImageSignature`'s magic-byte check, the
saved filename/extension logic, and `/uploads`' static serving), then
independently reproduced the exact exploit attempt outside the
existing test suite (a standalone script, not the committed tests)
with three payloads: an honest `image/svg+xml` SVG, the same SVG
bytes relabeled `image/png`, and relabeled `image/jpeg`. **All three
were correctly rejected** (400, `logoUrl` stayed `null`), and a real
PNG upload through the same flow was correctly accepted — the Phase
41 fix for the core vulnerability (SVG accepted as a logo) is
genuinely effective; it was not reproducible on this branch.

- **What the audit confirmed already works, and why**: `multer`'s
  `fileFilter` is explicitly documented in its own comment as only a
  fast, spoofable first pass (checks the client-supplied
  Content-Type); the actual gate is `detectImageSignature()`
  (`apps/api/src/lib/storage/image-signature.ts`), which matches the
  file's real leading bytes against PNG/JPEG/WEBP magic numbers only
  — SVG (or anything else) can never pass no matter what Content-Type
  or filename accompanies it. The saved file's extension always comes
  from the *detected* signature, never from the client's filename, so
  there's no way to get a `.svg`-flavored URL (or any mismatched
  extension) out of the upload path at all.
- **One residual hardening gap found and fixed — not a reproducible
  bypass of the core finding**: `/uploads` (`app.ts`) was served via
  plain `express.static` with no `X-Content-Type-Options: nosniff`
  header. This doesn't let an SVG through — upload-time validation
  already blocks that — but it's exactly the kind of defense-in-depth
  the original F01 finding's "serving behavior" category calls for:
  without it, a browser's own content-sniffing (specific to older/
  edge-case browser behavior, not a gap this app's validation could
  close any other way) is the only thing standing between a served
  file's declared Content-Type and how a browser might actually treat
  it. Added `setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')`
  to the `/uploads` `express.static` options — confirmed via a live
  request that the header is now present on every served upload.
- **Regression test, proven to fail before and pass after** (the
  task's own requirement): added `'F01: served uploads carry
  X-Content-Type-Options: nosniff'` to
  `apps/api/test/company-profile.test.ts`. Verified directly — `git
  stash` the `app.ts` change, re-ran the one new test by name: fails
  (`undefined` !== `'nosniff'`); restored the change, re-ran the same
  test: passes. The three pre-existing SVG-rejection tests (plain SVG,
  script-bearing SVG, SVG-disguised-as-PNG) were also re-run directly
  and confirmed still passing unchanged — they were never broken to
  begin with.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  337/337 + web 21/21, all clean), and `npm run lint` (zero errors,
  zero warnings, same as the end of the Phase 51 quality pass) all
  clean.

## F02 Re-Verification + Fresh-Login Regression Coverage (Phase 53)

Re-audited the Phase 42 "prevent last active company lockout" fix
from scratch — read `company-lifecycle.service.ts` end to end, then
independently reproduced the exact report scenario (deactivate A,
attempt to deactivate B too) outside the existing test suite with a
standalone script, rather than trusting the already-committed tests.

- **What the audit confirmed already works, and why**: every
  requirement in this task is already satisfied by the Phase 42
  fix, unchanged:
  1. `pickAnotherActiveCompany` requires *another ACTIVE* company
     (`c.status = 'active'` in its WHERE clause) — a deactivated one
     never counts.
  2. Both `deactivateCompany` and `deleteCompanyPermanently` call it
     and reject with a clear 400 (`"You have no other active
     company. Create or reactivate another company before
     deactivating/deleting this one."`) when it returns null.
  3. Concurrency is handled by `lockUserForLifecycleChange` — a
     transaction-scoped `pg_advisory_xact_lock(hashtextextended(userId,
     0))`, taken before either the company row lock or the active-
     company check, serializing every lifecycle action a given user
     performs across concurrent sessions.
  4. `requireAuth`'s session resolution and login's default-membership
     pick (`auth.service.ts`) both independently filter on
     `c.status = 'active'` too — consistent with
     `pickAnotherActiveCompany`, so there's no path where one of the
     three checks could disagree with the others.
- **Live reproduction of the exact report scenario** (standalone
  script, not the committed tests): registered a user (company A
  active), created company B (auto-switches to B), switched back to
  A, deactivated A (succeeds — B is still active, `newActiveCompanyId:
  B`), then attempted to deactivate B too (the exact second step of
  the report's reproduction) — **rejected with 400** ("You have no
  other active company..."). `/api/auth/me` on the same session, and a
  completely fresh login with the same credentials, both continued to
  return 200 with the correct active company throughout. **The
  reported lockout is not reproducible on this branch.**
- **One real gap found and closed in test coverage, not in the fix
  itself**: the task's test category E ("after an allowed lifecycle
  action, a *fresh login* must still work") was only partially
  covered — the existing `'session redirects after deletion'` test
  checked `/api/auth/me` on the *same* session that performed the
  delete, never a brand-new login afterward, which is the other half
  of the original report's exact reproduction steps. Added two new
  tests to close that gap precisely, for both deactivate and delete:
  perform the allowed lifecycle action, then log in fresh (a second,
  independent session, same credentials) and confirm it resolves to
  the surviving active company with no 401 anywhere.
- No code in `company-lifecycle.service.ts`, `auth.service.ts`, or
  anywhere else needed to change — only
  `apps/api/test/company-lifecycle.test.ts` gained the two new tests
  above. Every other requirement/test category the task listed (A:
  single-company rejection, B: two-active allowed-with-fallback, C:
  one-active-one-inactive rejection for both actions, D: concurrent
  requests never stranding, F: memberships/permissions/tenant
  isolation/switching/auth preserved) was already exercised by the 20
  pre-existing tests in that file, each individually re-run and
  reconfirmed passing rather than assumed.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  339/339 + web 21/21, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F03 — WhatsApp Send Must Not Happen on GET (Phase 54)

A security fix separating "preview" from "send" — scoped entirely to
WhatsApp share/send architecture; invoice calculations, PDF contents,
the ledger, payments, invoice numbering, templates, and discount
logic are all untouched.

- **The vulnerability**: `GET /api/invoices/:id/whatsapp-share`
  (`buildInvoiceWhatsAppShare`, the only function that existed) always
  called `getWhatsAppService().buildShare(...)`. The moment WhatsApp
  Business Cloud API credentials are configured
  (`BusinessCloudApiWhatsAppService`), `buildShare` uploads the PDF as
  media and sends a real document message — two real `fetch` calls to
  `graph.facebook.com` — as a side effect of what is supposed to be a
  read-only GET. The report reproduced this exactly: two GETs, two
  real sends. (The default, unconfigured click-to-chat mode was always
  safe — its `buildShare` has zero network calls — so this only ever
  manifested once Business Cloud API was set up.)
- **The fix — two entry points instead of one**, in
  `whatsapp-share.service.ts`:
  - `previewInvoiceWhatsAppShare` (GET): builds the message, the F09
    customer-openable PDF share link, and the manual wa.me fallback —
    structurally incapable of sending anything, because it never
    calls `WhatsAppService.buildShare` or `generateInvoicePdf` at all,
    no matter which service is active. Returns a new
    `WhatsAppSharePreview` shape (`toPhone`, `message`, `fallbackUrl`,
    `invoiceNumber`, `cloudApiConfigured`) — no `status`/`error`
    fields, since nothing has been sent by the time this returns.
  - `sendInvoiceWhatsAppShare` (new `POST /api/invoices/:id/
    whatsapp-send`): the only function that ever calls
    `WhatsAppService.buildShare` — generates/uploads the PDF and sends
    via Business Cloud API when that's active. Wrapped in an
    idempotency guard (below) so a retried/duplicated call never
    sends twice. Returns the original `WhatsAppSharePayload` shape
    (`mode`/`status`/`error` included) — unchanged, since this is now
    the only caller that ever needed those fields.
  - `buildShareContext` is the validation + message-building logic
    both share, kept in one place so the GET preview and what an
    actual POST send uses can never drift apart.
- **Idempotency**: new table `whatsapp_send_requests` (migration
  021) — `UNIQUE (company_id, invoice_id, idempotency_key)`, with a
  nullable `result` jsonb column filled in once the attempt completes.
  `idempotencyKey` is required on the POST body (frontend mints one
  per "Send via WhatsApp" click via `crypto.randomUUID()`).
  Claim-then-send-then-finalize: `INSERT` the key first (the UNIQUE
  constraint is what makes a second INSERT with the same key fail
  instead of quietly succeeding); the winner performs the real send
  and then `UPDATE`s the row with the result; a loser whose INSERT
  conflicted replays the winner's `result` directly if it's already
  filled in, or polls briefly (250ms × up to 20 attempts) if the
  winner is still mid-send, rather than ever sending itself. If the
  winner's send throws, its row is deleted (only when `result IS
  NULL`) so a genuine retry with the same key starts clean instead of
  polling forever for a result that will never arrive. A *different*
  key for the same invoice is treated as a completely independent new
  send, by design — this guards against retries/double-clicks of one
  logical action, not against a user deliberately resending later.
- **CSRF**: no new code needed — the new POST route is mounted under
  `/api/invoices`, already behind the app-wide
  `requireJsonForMutations` middleware (JSON/multipart-only +
  `SameSite=Lax` cookies), so it inherits the exact same CSRF defense
  every other mutating route already has. Confirmed directly: a
  cross-site-style POST (`application/x-www-form-urlencoded`,
  no CORS preflight) is rejected with 415 before it ever reaches the
  send logic.
- **Authorization/tenant isolation**: POST uses the same
  `requirePermission('invoice.view')` guard and the same
  `getInvoice(companyId, invoiceId)` tenant check GET already had —
  no new permission introduced, no isolation gap: a cross-tenant POST
  404s exactly like a cross-tenant GET always has.
- **Frontend** (`InvoiceTemplateView.tsx`): `handleShare` now always
  calls the read-only preview first; only calls the new POST send
  endpoint when `preview.cloudApiConfigured` is true. When it's false
  (the default setup), the existing download-then-open-wa.me flow is
  unchanged — `window.open(preview.fallbackUrl, ...)` only ever runs
  in direct, synchronous response to this exact button click, never
  automatically and never via any GET. `shareStage` gained a
  `'sending'` value (shown only around the POST call) alongside the
  existing `'preparing'`/`'opening-whatsapp'`; "Sent"/"Failed" are
  communicated via the pre-existing `shareNotice`/`shareError`
  paragraphs, unchanged in mechanism. The button stays disabled for
  every non-idle stage (existing double-click guard); the server's
  idempotency key is the backstop that holds even if that disabling
  were ever bypassed.
- **Test-only seam added**: `setWhatsAppServiceForTesting` in
  `lib/whatsapp/index.ts` — ESM named exports are read-only bindings,
  so a test can't reassign `getWhatsAppService` itself to stub which
  service is active; this is the one sanctioned override point,
  needed to prove "GET never sends even with Business Cloud API
  configured" against the real route/service code without starting a
  second process with different environment variables.
- **Tests** (`apps/api/test/whatsapp.test.ts`, rewritten for the new
  GET shape plus 9 new): GET preview returns the new shape with zero
  outbound calls, even called twice (the report's exact reproduction)
  and even with Business Cloud API configured via the test seam; POST
  sends exactly once for a fresh key; the identical POST retried with
  the same key replays the exact same result with zero additional
  media uploads/messages sent (verified both via the returned payload
  and a `whatsapp_send_requests` row count); a different key is an
  independent send; POST requires `idempotencyKey`; POST is rejected
  unauthenticated and cross-tenant (404, same as GET); and a
  cross-site-style non-JSON POST is rejected by the existing CSRF
  guard.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  347/347 + web 21/21, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F04 — Discount Rounding Must Be Financially Consistent (Phase 55)

A correctness fix isolated to the one function that computes
discountAmount/grandTotal — `calculateDiscount`
(`apps/api/src/modules/invoices/invoice.service.ts`) — plus its exact
frontend mirror (`previewDiscount`, `preview.ts`, fixed for the same
reason: so the live edit/create preview never shows a different split
than what the server actually saves). Nothing else needed to change —
every other figure (reread, list, dashboard, ledger debit, PDF/
WhatsApp via the view model) was already *derived from* the stored
`discountAmount`/`grandTotal`, never independently recomputed, so
fixing the one source of truth fixed all of them automatically.

- **Old rounding behavior**: `calculateDiscount` computed
  `discountAmount` (raw, unrounded Decimal) and `grandTotal =
  subtotal - discountAmount` (also from the *unrounded* discountAmount)
  side by side, then called `roundMoney` on each **independently**.
  `roundMoney` uses `ROUND_HALF_UP`. For the reported case — subtotal
  1.01, 50% — the raw discount is exactly 0.505 and the raw grand
  total is also exactly 0.505 (the subtotal's own half-cent split in
  half again); `ROUND_HALF_UP` rounds *both* of those identical
  half-cent values up to 0.51, producing `0.51 + 0.51 = 1.02` for a
  1.01 subtotal — one cent manufactured out of nowhere, purely from
  rounding the same split twice from two different unrounded
  starting points.
- **New authoritative rounding rule**: round `discountAmount` exactly
  **once**, then derive `grandTotal = subtotal - roundedDiscountAmount`
  — never from the raw, unrounded discount again. `grandTotal` is
  still passed through `roundMoney` once more, but since `subtotal`
  (always a sum of already-rounded item totals) and the now-rounded
  `discountAmount` are both already at 2-decimal precision, that
  subtraction is already exact — the second `roundMoney` call is a
  formality/safety net, not a second independent rounding decision.
  This guarantees `subtotal === discountAmount + grandTotal` at money
  precision by construction, for both percentage and fixed discounts,
  because there is structurally only one rounding choice made, not
  two that can disagree.
- **Files changed**: `apps/api/src/modules/invoices/invoice.service.ts`
  (`calculateDiscount` — the fix itself; both `createInvoice` and
  `updateInvoice` already called this single function, so create and
  edit automatically share the identical rule with zero changes to
  either), and `apps/web/src/features/invoices/preview.ts`
  (`previewDiscount` — the exact same fix, mirrored, so the client-side
  live preview during typing/editing never disagrees with what the
  server will save).
- **Why nothing else needed to change**: `getInvoice`'s reread derives
  `grandTotal` from the *stored* `discountAmount` column
  (`totalAmount - discountAmount`, not a fresh percentage
  recalculation); `listInvoices`'s SQL does the same
  (`items.total - discount_amount`); the ledger debit at creation is
  `discount.grandTotal` from this same function; the invoice view
  model (`buildInvoiceViewModel`, consumed by PDF/print/WhatsApp) just
  passes through `invoice.discountAmount`/`invoice.grandTotal` from
  the already-fetched object, with no recomputation of its own. Every
  one of these was already "consume the stored authoritative value" —
  they inherited the fix automatically once the one place that *sets*
  those values was corrected.
- **Tests**: new `apps/api/test/invoice-discount-rounding.test.ts`
  (10 new) using manual (Quick Invoice) items — `unitPrice` taken
  literally with no formula engine involved — for exact, arbitrary-cent
  subtotal control: the exact reported scenario (1.01 @ 50% →
  0.51 + 0.50, never 0.51 + 0.51); create/reread/list/ledger-debit all
  reporting the identical `grandTotal`; a real, non-empty PDF response
  for the same invoice; editing a draft's discount value *and* type
  and confirming the new totals (and the updated ledger debit) stay
  consistent; a sweep of half-cent/odd-percentage edge cases (0.01 @
  50%, 10.01 @ 33.33%, a fixed discount with cents, several more);
  normal whole-cent amounts producing the exact same numbers as
  before the fix (no regression); and a dedicated check that every
  validation rule (negative discount, percentage over 100, fixed over
  subtotal, exactly-at-subtotal allowed with a zero grand total) is
  unchanged. **Verified the regression test itself**: reverted
  `calculateDiscount` (`git stash`) and re-ran — it reproduces the
  exact reported `0.51 + 0.51 = 1.02` failure; restored the fix and
  re-ran clean. New `apps/web/test/preview.test.ts` tests (4 new)
  mirror the same cases for the frontend preview function.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  357/357 + web 25/25, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F05 — Paid Invoice Must Not Become Unpaid After Later Debit (Phase 56)

A re-verification, not a new fix — this report's F05 is the exact
same root cause this session already fixed as "F04" in Phase 44 (the
two review reports use different numbering for the same finding).
Did not assume the earlier fix held; independently re-audited
`apps/api/src/lib/ledger-fifo.ts`'s `fifoPaidCtes` and reproduced
every scenario this report's finding lists — A through F — live,
outside the committed test suite, before adding any test.

- **Root cause (already fixed)**: a FIFO "oldest debt first"
  allocation that windows `cumulative_before` over only `type =
  'INVOICE'` ledger rows (instead of every positive-debit row —
  opening balance, invoice, and debit adjustment) silently drops newer
  non-invoice debits from the running sum, so a later debit
  adjustment or opening balance can make an already-paid invoice look
  unpaid again, or vice versa. Already corrected in `fifoPaidCtes`,
  which windows over every debit-positive row and only narrows to
  `type = 'INVOICE'` in each caller's *outer* query, after the window
  is computed.
- **Final allocation policy (confirmed, unchanged)**: oldest-debt-
  first FIFO across every positive-debit ledger entry type — opening
  balance, invoice, and debit adjustment — ordered by
  `created_at DESC, id DESC` with a running `cumulative_before` sum;
  a payment/credit is applied against the customer's current balance
  working backward from the newest entry, so the oldest debt is
  always satisfied first.
- **Single source of truth (confirmed, unchanged)**: `listInvoices`,
  `getInvoicePaidAmount` (invoice detail *and* the delete guard, via
  `deleteInvoice`), and the dashboard's unpaid/partial count
  (`getUnpaidOrPartialInvoiceCount`) all build on the one shared
  `fifoPaidCtes` fragment — confirmed via a direct search
  (`grep -rl fifoPaidCtes`), not assumed. PDF/WhatsApp never
  recompute anything — they consume the already-computed
  `amountPaid`/`paid` fields from the same `InvoiceWithItems`/
  `InvoiceListEntry` objects.
- **Live reproduction, independent of the test suite** (a standalone
  script, not committed): the exact report scenario (invoice 100,
  later debit adjustment 100, payment 100) — invoice detail
  `amountPaid: 100.00`, list `paid: 100.00`/`paymentStatus: PAID`,
  dashboard `unpaidOrPartialInvoiceCount: 0`, delete correctly
  rejected (400, payment applied). Also reproduced the three ordering
  variants the report calls out by name: opening balance *before* the
  invoice (older debt absorbs the payment, invoice stays `0.00` paid);
  a debit adjustment *before* the invoice (same); a debit adjustment
  *after* the invoice (the payment reaches the *older* invoice first,
  invoice correctly shows partially/fully paid instead of the newer
  adjustment). All four matched the FIFO policy exactly — **the
  reported bug does not reproduce on this branch.**
- **Files changed**: none in production code. New
  `apps/api/test/invoice-fifo-allocation.test.ts` only — 6 tests
  matching this report's own A–F lettering exactly (scenario A is the
  literal report reproduction; B/C/D are the three debt-ordering
  variants, not previously covered by name anywhere in the suite,
  even though the underlying `fifoPaidCtes` fix already handled them
  correctly; E/F reconfirm the unpaid-deletable / partially-paid-
  rejected cases this report also calls for, alongside the
  pre-existing, still-passing F04-labeled tests in
  `invoice-archive.test.ts` and `ledger.test.ts` from Phase 44).
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  363/363 + web 25/25, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F06 — Invoice Amount Paid Must Never Be Negative (Phase 57)

A re-verification, not a new fix — this report's F06 is the exact
same root cause this session already fixed as "F03" in Phase 43.
Independently re-audited `buildLedgerSummary`'s `amountPaid` and
live-reproduced the report's exact scenario before adding any test.

- **Root cause (already fixed)**: `amountPaid` used to be derived as
  `totalReceivable - currentBalance` — the customer's *overall* live
  balance, which moves whenever *any* invoice is created anywhere in
  the customer's history. Two unpaid invoices of 100 each: the older
  one's `totalReceivable` (100) minus the customer's current overall
  balance (200, both invoices' debits) is `-100` — a negative "amount
  paid" on an invoice nobody has paid anything toward.
- **How amountPaid was previously derived**: `totalReceivable -
  currentBalance`, a whole-customer snapshot subtraction, never
  scoped to the specific invoice.
- **New/current source of truth (already in place, confirmed
  unchanged)**: `buildLedgerSummary` calls `getInvoicePaidAmount`
  (invoice.service.ts) — the F05 authoritative FIFO allocation, built
  on the shared `fifoPaidCtes` fragment
  (`apps/api/src/lib/ledger-fifo.ts`), the exact same helper
  `listInvoices`, the dashboard's unpaid/partial count, and
  `deleteInvoice`'s guard all already use. The FIFO formula itself —
  `debit - LEAST(debit, GREATEST(current_balance -
  cumulative_before, 0))` — is bounded in `[0, debit]` by
  construction (subtracting a value clamped to `[0, debit]` from
  `debit` can never go negative or exceed `debit`), so `0 <=
  amountPaid <= grandTotal` holds mathematically, not just
  empirically, for every invoice.
- **Live reproduction, independent of the test suite** (a standalone
  script, not committed): the exact report scenario — invoice A=100,
  invoice B=100, no payment — both report `amountPaid: '0.00'`,
  never negative; a partial payment (40) is absorbed entirely by the
  older invoice, the newer stays 0; a payment of 150 fully pays the
  older (100) and spills the remaining 50 onto the newer; a sweep of
  5 invoices with uneven payments and a mid-sequence debit adjustment
  stayed within `[0, grandTotal]` for every single one. **The
  reported negative-paid bug does not reproduce on this branch.**
- **Files changed**: none in production code. New
  `apps/api/test/invoice-amount-paid.test.ts` only — 7 tests matching
  this report's own test list (1–6) plus one additional zero-total/
  100%-discount edge case the report's "handle according to existing
  business rules" note called for. Confirmed detail/list/PDF all
  agree on the identical `amountPaid` for the same invoice (test 5 —
  the PDF response itself is generated from the same already-computed
  `InvoiceWithItems` object `buildInvoiceViewModel` only ever passes
  `amountPaid` through, never recomputes), and a global `[0,
  grandTotal]` bounds check plus a `paymentStatus`/`balance`
  cross-check against `listInvoices` for every invoice in a 5-invoice,
  multi-payment, mid-sequence-adjustment sweep (test 6).
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  370/370 + web 25/25, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F09 — Zero-Total Invoice Historical Balance Must Remain Stable (Phase 58)

A correctness fix isolated to one line in `getInvoice`
(`apps/api/src/modules/invoices/invoice.service.ts`) — no schema
change, no migration.

- **Exact root cause**: a 100%-discounted invoice (`grandTotal`
  `'0.00'`) posts no `ledger_entries` row at all — the table's check
  constraint requires exactly one of `debit`/`credit` to be positive,
  and there's nothing to bill. `getInvoice` looked up that invoice's
  own `INVOICE`-type ledger entry's `created_at` to anchor
  `previousBalance` (via `getBalanceBefore(..., beforeCreatedAt)`,
  which sums every ledger row with `created_at < beforeCreatedAt`),
  and fell back to `new Date().toISOString()` — **"now," at read
  time** — whenever no such row existed. Every reread of a zero-total
  invoice therefore computed `previousBalance` against *today's*
  ledger state, drifting to match whatever the customer's balance
  happened to be the moment someone looked, silently rewriting
  historical invoice metadata every time a later payment, adjustment,
  or invoice was recorded. `createInvoice`'s own creation-time response
  was never affected — it already used the invoice's own just-inserted
  `created_at` for this same zero-total case; the bug was reread-only.
- **Snapshot vs. timestamp-based solution**: timestamp-based (Option
  B) — the smallest change consistent with the architecture already
  in place for every non-zero invoice (which already derives
  `previousBalance` from `ledger_entries` using a saved creation
  timestamp, never "now"). No new snapshot columns were needed: the
  invoice's own `created_at` (already selected into `header` by the
  existing `INVOICE_HEADER_COLUMNS`, and immutable once the row is
  inserted — `updateInvoice` only ever touches `updated_at`) is
  exactly the right anchor and was already sitting right there,
  unused for this fallback. For a normal invoice it's the identical
  value its own ledger entry's `created_at` would have anyway — both
  columns default to `now()`, and `createInvoice` posts the invoice
  row and its ledger entry inside one transaction, and Postgres's
  `now()` is constant for an entire transaction — so this changes
  nothing for the non-zero-total case and fixes only the zero-total
  one, which had no ledger row to anchor on at all.
- **Schema/migration changes**: none. No existing data needed
  touching, and none was.
- **Files changed**: `apps/api/src/modules/invoices/invoice.service.ts`
  (`getInvoice`'s fallback, one line) — `createInvoice`'s own
  zero-total path already used `createdAt` correctly, and
  `updateInvoice` just calls `getInvoice` at the end, so both the
  create and edit flows share the fix automatically with zero further
  changes. `buildInvoiceViewModel` (PDF/WhatsApp) never recomputes
  `previousBalance` — it only ever passes through whatever
  `getInvoice` already returned — so fixing the one function fixed
  every consumer at once, exactly as the task required.
- **Tests**: new `apps/api/test/invoice-historical-balance.test.ts`
  (6 new) — the exact report reproduction (opening balance 100, a
  fully-discounted invoice, a later 50 payment, reread still showing
  `previousBalance: '100.00'`, confirmed `currentBalance` *does*
  correctly move to `'50.00'` since that field is deliberately the
  live overall balance, not a snapshot); a later debit adjustment
  doesn't disturb the snapshot; a later credit adjustment doesn't;
  a later invoice doesn't; a normal non-zero invoice stays correct and
  stable through the same kinds of later activity (no regression);
  and a PDF-generation check confirming the same stable value feeds
  the printable view. **Verified the regression test itself**:
  reverted the one-line fix (`git stash`) and re-ran — reproduces the
  exact drift (`previousBalance` becomes `'50.00'`); restored the fix
  and re-ran clean.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  376/376 + web 25/25, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean.

## F10 — Discount Input Must Not Crash During Typing (Phase 59)

A re-verification, not a new fix: this report's F10 is the exact same
root cause already fixed as "F05" in Phase 45.

- **Exact crash source (already fixed)**: `new Decimal(discountValueRaw)`
  called directly on the raw keystroke value — decimal.js throws a
  `DecimalError` for ordinary mid-typing states like `"-"` and `"."`
  (verified live via a Node one-liner; `"0."`/`"12."` trailing-dot
  strings parse successfully to `0`/`12` and do not throw, so those
  two are legitimate values, not error states). An uncaught throw
  inside the render-time discount preview `useMemo` would crash the
  whole form component.
- **Files changed**: only
  `apps/web/test/discount-input-safety.test.ts` (new, 11 tests). No
  production code changed — independently re-audited
  `apps/web/src/features/invoices/preview.ts`,
  `CreateInvoiceForm.tsx`, and `QuickInvoiceForm.tsx` before adding
  anything; both forms already route the discount field exclusively
  through the one shared `previewDiscount`/`parseDiscountValue`
  helper, which already wraps `new Decimal(trimmed)` in try/catch,
  checks `.isFinite()`, and returns `Decimal | null` — it never
  throws regardless of input.
- **Parser/validation approach confirmed already in place**: raw
  string input and parsed numeric value are already kept separate —
  `parseDiscountValue` returns `null` for anything invalid/incomplete,
  and `previewDiscount` surfaces that as an inline `error` message
  (discount amount/grand total fall back to `0.00`/the full subtotal
  while invalid) rather than throwing or sending a bad value anywhere.
- **Tests**: new `discount-input-safety.test.ts` covers every typing
  state this report's own test list (1-9) calls for verbatim —
  `"."`, `"-"`, `"abc"` (with the exact inline validation message),
  `"12."`, `"12.5"`, clearing the field, percentage bounds validation,
  fixed bounds validation, and the F04 half-cent rounding-consistency
  case — plus a bonus `"0."` case and a 13-state sweep across both
  discount types asserting `doesNotThrow`. All 11 pass.
- **Standard Invoice and Quick Invoice both confirmed fixed**: both
  forms call the identical shared `previewDiscount` via their own
  `useMemo`; `QuickInvoiceForm`'s unrelated `previewLineAmount`
  (quantity × unit price, already guarded by `Number.isFinite` checks)
  was identified as out of scope and left untouched.
- `npm run typecheck`, `npm run build`, `npm test` (shared 61/61 + api
  376/376 + web 36/36, all clean), and `npm run lint` (zero errors,
  zero warnings) all clean. **F10 is confirmed FIXED** (already fixed
  prior to this task, now with committed regression coverage matching
  the report's exact test list).

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

39. Invoice List Scroll + Search Bar Cleanup: pure frontend layout fix,
    no data/search-backend/filter/calculation/ledger/payments/
    permissions change. The desktop table's unnecessary horizontal
    scroll came from a hardcoded `min-w-[1040px]` plus every column
    (including the two lot-number columns and Paid) always rendering —
    removed the min-width and made Internal Lot #/Customer Lot #
    (`hidden xl:table-cell`) and Paid (`hidden lg:table-cell`)
    responsively hidden instead of deleted, so the data is still one
    click away via View. The search placeholder's full field list
    became "Search invoices…" with the field list moved to a `title`
    tooltip and a small helper line underneath — the debounced search
    call itself is untouched. The 7-link Actions cell collapsed into a
    standalone "View" button plus a new `RowActionsMenu` "⋮" dropdown
    (outside-click-to-close, its own component) holding PDF/Print/
    WhatsApp/Duplicate/Archive-or-Restore/Delete — every item/label/
    disabled-reason/permission check it renders is still decided by
    the exact same logic from Phase 33, just relocated into the menu's
    item list instead of being inline buttons. See "Invoice List
    Scroll + Search Bar Cleanup (Phase 34)" below

40. Display Number Format (trim trailing zeros): a numeric(12,2)
    column always hands back a padded string ("144.00", "6666.00"),
    and most of the UI was printing that padding straight through.
    Reused the existing `formatNumber()` (`packages/shared/src/
    number-format.ts`, introduced in Phase 31 for Quick Invoice's edit
    prefill) as the one shared display formatter — `Decimal(value)
    .toString()`, which trims insignificant trailing zeros and never
    rounds ("144.00"->"144", "504.50"->"504.5", "0.00"->"0"). Applied
    it at the single most-central point for print/PDF — inside
    `buildInvoiceViewModel` (`packages/shared/src/
    invoice-view-model.ts`) — formatting every item's quantity/
    unitAmount/amount plus subtotal/discountValue/discountAmount/
    grandTotal/previousBalance/amountPaid/currentBalance once, so all
    5 templates, the server-side PDF renderer, and the web print-
    preview (all three just echo `invoice.<field>` from this one view
    model, confirmed by reading each) picked it up with zero
    per-template edits. Also applied directly in `InvoiceList.tsx`
    (Grand Total/Paid/Balance columns), `InvoiceDetails.tsx` (the
    separate, non-template detail panel: item quantity/rate/unit
    amount/total, subtotal, discount, grand total, and all 5 StatRow
    figures), and both invoice forms' `SummaryRow` component
    (Subtotal/Discount/Grand Total/Previous Balance/Amount Paid/
    Current Balance) — `CreateInvoiceForm` additionally gained it on
    edit-mode prefill (quantity/rate/generalQuantity/discountValue)
    and the live per-row preview amount, matching the pattern
    `QuickInvoiceForm` already had from Phase 31. General Quantity and
    Sets were already display-trimmed by Phase 30's `formatQuantity`/
    `calculateSets` and needed no change. Nowhere are stored values,
    API payloads, the formula engine, roundMoney, or any calculation
    touched — every edit is `formatNumber(x)` wrapped around an
    already-final string purely at render time.
    2 existing `invoice-view-model.test.ts` assertions were updated to
    expect the now-trimmed output ("14.40"->"14.4", "0.00"->"0") since
    that's the intended behavior change; 2 new tests added covering a
    7-digit whole-number total ("4406226.00"->"4406226") and a
    percentage discount's value trimming inside `discountLabel`
    itself ("Discount (10.00%)"->"Discount (10%)"). Verified live
    (Playwright, dev DB): invoice list, invoice detail, Quick
    Invoice's own detail/edit view, and all 5 templates (switched
    live in the template selector) all showing "6666"/"504"/"14.4"/
    "131.03"-style clean numbers from the same seeded data: a whole-
    number total, a one-decimal total, and a two-decimal payment
    amount side by side on one invoice — and confirmed the PDF
    download endpoint still returns 200 with a valid PDF. See
    "Display Number Format (Phase 35)" below

41. Responsive Main App Container: `App.tsx`'s one shared post-login
    shell (`max-w-5xl`, a flat 1024px, `p-6` fixed everywhere) widened
    to `w-full max-w-[1400px] mx-auto` with responsive padding
    (`p-2 sm:p-3 md:p-4 lg:p-6` on the outer page, `p-3 sm:p-4 lg:p-6`
    on the card itself) — desktop/large-desktop (1366/1920px) now get
    real room for the invoice table/filters/action menus instead of
    being squeezed into 1024px, while phone/tablet still shrink to
    fill the viewport edge-to-edge (minus the outer padding) and the
    card never grows unbounded on a huge monitor (caps at 1400px,
    centered). Also found and fixed a real mobile bug surfaced while
    verifying this at 360/390px: the top tab nav (`flex gap-4`, 6-7
    items, no wrap) was pushing the page itself wider than the
    viewport — added `overflow-x-auto` to the nav row and `shrink-0`
    on each tab button so the nav scrolls horizontally within its own
    row instead of blowing out the page. Every `print:*` class on the
    shell (`print:max-w-none print:p-0 print:border-0 print:shadow-
    none`, etc.) is untouched, so print/PDF sizing — which lives
    entirely in the invoice templates/statement document, several
    layers below this shell — is unaffected either way. No navigation
    behavior, invoice calculation, Quick/Normal Invoice, PDF/print,
    payment, ledger, or customer logic touched — layout/CSS only.
    Verified live (Playwright) at all 6 required widths (360/390/768/
    1024/1366/1920px): zero page-level horizontal scroll at any of
    them (360/390 only fixed by the nav-bar change above — the
    container width change alone didn't cause it, but didn't fix it
    either), card width measured 1400px (capped) at 1920, ~1318px at
    1366, full-width-minus-padding at 1024/768/390/360. See
    "Responsive Main App Container (Phase 36)" below

42. Totals Box Redesign + Show Item Amount: two related customer-
    facing presentation improvements, no calculation/formula/ledger/
    payment/database-amount change anywhere. (1) Every template's
    totals panel (Subtotal/Grand Total/Previous Balance/Amount Paid/
    Current Balance) redesigned from a bare top-border list into an
    actual bordered/padded box with comfortable row spacing and a
    separator line before the emphasized Current Balance row — each of
    the 5 templates keeps its own accent color/identity (navy serif
    border, bold industrial block, minimalist slate border, violet
    filled panel with a definition ring, premium slate border), none
    homogenized into identical "floating blue block" labels. (2) A
    third display toggle, `showItemAmount`/`show_item_amount`
    (migration `018_show_item_amount.sql`, `NOT NULL DEFAULT true`),
    added as a straight sibling of Phase 30's `showUnitAmount`/
    `showItemQuantity` — same backend plumbing (InvoiceInput/Invoice
    types, INVOICE_HEADER_COLUMNS, create/update/duplicate, route
    validation), same InvoiceViewModel field, same template gating
    pattern (`invoice.showItemAmount && <th>/<td>Amount</th>/</td>`)
    across all 5 templates and `render-html.ts` (PDF), same
    "Show item amount" checkbox next to the other two in
    CreateInvoiceForm's Invoice Display section. Hiding it only drops
    the per-item Amount column — every total row (Subtotal included)
    always still renders, since those read off separate
    `InvoiceViewModel` fields the toggle never touches. Backward
    compatible: an old invoice with no column has the migration's
    default (true/shown), identical to today's behavior. See "Totals
    Box Redesign + Show Item Amount (Phase 37)" below

43. Optional Bill Number Visibility on Print/PDF: `showBillNumber`/
    `show_bill_number` (migration `019_show_bill_number.sql`, `NOT
    NULL DEFAULT true`) — a fourth display toggle, same backend
    plumbing pattern as Phase 37's `showItemAmount`, but implemented
    with a different, more minimal mechanism than a per-template flag:
    `buildInvoiceViewModel` nulls out the view model's own `billNumber`
    field whenever the toggle is off (`invoice.showBillNumber ?
    invoice.billNumber : null`), so all 5 templates and `render-
    html.ts` need zero individual edits — every one of them already
    hides the "Bill #: ..." row (and, for Industrial Blue, drops it
    from its dynamic info-cell grid column count) whenever
    `invoice.billNumber` is null, the same convention
    customerLotNumber/gatePassNumber/generalQuantity already use. The
    stored `Invoice.billNumber` column itself is completely untouched
    by this toggle — never cleared, and InvoiceList/InvoiceDetails/
    CreateInvoiceForm/search all read it directly from the Invoice
    type (not the gated view model), so it stays visible, editable,
    and searchable inside the app regardless of the print preference.
    See "Optional Bill Number Visibility on Print/PDF (Phase 38)"
    below

44. Invoice Detail Metadata Reorganization: `InvoiceDetails.tsx`'s
    header metadata — previously one long middot-joined text line
    (Customer · Date · Status · Bill # · Internal Lot # · Customer
    Lot # · Gate Pass # · General Quantity · Sets) — replaced with a
    bordered "Invoice Information" card containing a responsive grid
    (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) split into three
    logical groups (Invoice: Invoice No./Date/Status, always shown;
    References: Bill Number/Internal Lot/Customer Lot/Gate Pass;
    Quantity: General Quantity/Sets), each field a small muted label
    over a bold value via new `MetaGroup`/`MetaField` components. An
    empty optional field is never rendered at all (no "Internal Lot:
    —"), and an entirely-empty group (no References/Quantity data) is
    skipped as a whole — verified live with a minimal invoice showing
    only the always-present Invoice group. Customer name moved to a
    subtitle under the invoice number; Edit/View·Print/Back stay in
    their own separate top-right row, untouched. Pure presentation —
    no calculation, data, database field, formula, ledger, payment, or
    API behavior changed; the item table/totals below were untouched
    except where this reorganization added a card the table flows
    below. See "Invoice Detail Metadata Reorganization (Phase 39)"
    below

45. Per-Invoice Rate Override (clarification, not a new feature): the
    ability to use a category at a different rate per invoice/customer
    — auto-fill from `embroideryCategories.defaultRate`, a fully
    editable Rate field, the formula recalculating live, the chosen
    rate saved as a per-item snapshot (`invoice_items.rate`) that a
    later change to the category's own default never touches, and a
    category switch resetting to the *new* category's default — was
    already completely implemented (`createInvoiceItem`'s `input.rate
    ?? category.defaultRate`, `CreateInvoiceForm`'s editable Rate
    `<input>` with the category-change handler that resets it). This
    phase only closed test-coverage gaps the task's checklist called
    for that weren't covered yet — editing (not just creating)
    preserves/updates the snapshot, a category switch during an edit
    resets to the new category's default, and confirming Quick
    Invoice's manual items are untouched — plus a small UI clarity
    pass: the category form's "Default rate" label capitalized to
    "Default Rate" with a one-line hint ("Starting point only — can be
    overridden per invoice item"), and a `title` tooltip on the
    invoice form's own Rate input saying the same. See "Per-Invoice
    Rate Override (Phase 40)" below

46. F01 — SVG Logo Upload Stored XSS (security fix): the company logo
    upload accepted `image/svg+xml` and served it raw, same-origin,
    from `/uploads/logos/...` — a malicious SVG's `<script>` or
    `onload=` executes if the raw file URL is ever opened directly.
    With no SVG sanitizer in the app, the fix removes SVG from the
    allowlist entirely (PNG/JPEG/WEBP only) and adds a new
    `detectImageSignature()` helper (`apps/api/src/lib/storage/
    image-signature.ts`) that sniffs the file's actual magic-number
    bytes as the authoritative check — never trusting the client's
    Content-Type/filename alone, so an SVG renamed to `logo.png` is
    still rejected. See "F01 — SVG Logo Upload Stored XSS (Phase 41)"
    below

47. F02 — Prevent Last Active Company Lockout (security fix): the
    deactivate/delete safety check counted every `company_members`
    row the user had (`countMemberships`), active or deactivated —
    so a user with one active company and one already-deactivated one
    could deactivate or delete their only active company and be
    stranded with zero. Fixed by gating on `pickAnotherActiveCompany`
    (already existed, already filtered `c.status = 'active'`, but was
    only ever used for the post-action session repoint, never the
    safety check itself) instead — one query now serves both jobs, so
    the check and the repoint target can never disagree. Concurrent
    deactivate/delete races (two sessions of the same user each
    racing to remove one of their last two active companies) are
    serialized with a new transaction-scoped Postgres advisory lock
    (`pg_advisory_xact_lock(hashtextextended(userId, 0))`) taken
    before either the company row lock or the active-company check,
    so the second racing transaction always sees the first's already-
    committed result. See "F02 — Prevent Last Active Company Lockout
    (Phase 42)" below

48. F03 — Historical Invoice Amount Paid Must Never Go Negative
    (correctness fix): `buildLedgerSummary`'s `amountPaid` was derived
    as `totalReceivable - currentBalance`, where `currentBalance` is
    the customer's *overall* live balance — so a later invoice's own
    debit could push an older, completely unpaid invoice's derived
    `amountPaid` negative (invoice A=100, invoice B=50, no payment at
    all: `100 - 150 = -50`). Fixed by making `amountPaid` call the
    pre-existing `getInvoicePaidAmount` FIFO function instead (already
    used by `listInvoices` and `deleteInvoice`'s safety check) —
    invariant under later invoices by construction, since it's keyed
    to this invoice's own ledger entry and FIFO-ordered strictly among
    debits, never derived from a whole-customer snapshot that moves
    for unrelated reasons. `currentBalance` itself is intentionally
    unchanged. See "F03 — Historical Invoice Amount Paid Must Never Go
    Negative (Phase 43)" below

49. F04 — Paid Draft Invoice Delete Guard (correctness fix): the FIFO
    "how much has been paid" window in `listInvoices` and
    `getInvoicePaidAmount` filtered `type = 'INVOICE'` *inside* the
    window that sums newer ledger entries, so a later debit
    ADJUSTMENT raised the customer's overall balance without ever
    counting toward that running sum — making an already-fully-paid
    older invoice look unpaid again, which could wrongly let
    `deleteInvoice`'s safety check permit a hard delete. Fixed by
    extracting the one correct pattern (already used by the
    dashboard's unpaid/partial count) into a shared
    `fifoPaidCtes()` helper (`apps/api/src/lib/ledger-fifo.ts`) that
    windows over every positive-debit entry and narrows to
    `type = 'INVOICE'` only in the outer query — reused by all three
    consumers so they can't drift apart again. See "F04 — Paid Draft
    Invoice Delete Guard (Phase 44)" below

50. F05 — Discount Input Must Not Crash During Typing (correctness
    fix): `previewDiscount` (`apps/web/src/features/invoices/
    preview.ts`) built `new Decimal(discountValueRaw || '0')` straight
    from the raw Discount field on every render, and `decimal.js`
    throws a `DecimalError` for `'-'`/`'.'`/`'abc'` — all everyday
    mid-typing states — crashing the render and losing the whole
    in-progress invoice form. Fixed with a new `parseDiscountValue()`
    helper that catches the throw (and checks `.isFinite()` for
    `'Infinity'`/`'NaN'`) and returns `null` instead, which
    `previewDiscount` turns into its normal non-throwing
    `DiscountPreview` shape with a field validation error — reusing
    the exact same error-reporting path the pre-existing negative/
    bounds checks already used. Added `apps/web`'s first-ever test
    runner (mirroring `packages/shared`'s `tsx --test` convention,
    since `preview.ts` has no React/DOM dependency) with 9 new tests.
    See "F05 — Discount Input Must Not Crash During Typing (Phase 45)"
    below

51. F06 — Quick Invoice Save Must Be Retry-Safe (correctness fix):
    `QuickInvoiceForm`'s "Paid" convenience made three unguarded
    network calls in sequence (createInvoice, createPayment,
    getInvoice); a failure in either of the last two followed by a
    user retry re-ran `createInvoice` and created a duplicate invoice.
    A 100%-discount invoice guaranteed this, since the backend rejects
    a zero-amount payment outright. Fixed by extracting the sequence
    into `saveQuickInvoice()` (`apps/web/src/features/invoices/
    quick-save.ts`), driven by a caller-owned `state` object
    (`{ invoice, paymentCreated }`, kept in a `useRef` so it survives
    a failed attempt but resets after a successful one) that's filled
    in the instant each step succeeds, so a retry with the same state
    skips whatever already completed and resumes only from the step
    that failed; a zero-total invoice skips the payment step
    entirely. See "F06 — Quick Invoice Save Must Be Retry-Safe
    (Phase 46)" below

52. F07 — Quick Invoice Duplicate (correctness fix): `duplicateInvoice`
    treated any item with `categoryId === null` as a deleted-category
    item and rejected it — but a manual (Quick Invoice) item always
    has `categoryId === null` by design, so every Quick Invoice failed
    to duplicate, 100% of the time. Fixed by gating that rejection on
    `original.invoiceMode !== 'quick'` (server-derived, never
    client-supplied) — the one signal that tells "this item is
    manual, by design" apart from "this item's category was deleted
    out from under it". A Quick Invoice's items now rebuild as
    `{ description, quantity, unitPrice }` (unitPrice from the saved
    item's `calculatedUnitAmount`) instead of the category-item shape;
    the category-item path itself is unchanged. See "F07 — Quick
    Invoice Duplicate (Phase 47)" below

53. F08 — Company Optional Fields Must Be Clearable (correctness fix):
    three layers each independently made it impossible to clear an
    optional company field (phone/address/invoiceTerms/etc.) — the
    frontend only sent a field when non-blank, `optionalString`
    rejected an empty value as invalid, and `updateCompany`'s
    `COALESCE($N, column)` always fell back to the existing value for
    a NULL parameter regardless of why it was NULL. Fixed at each
    layer: new `buildProfilePatch()` (`apps/web/.../profile-patch.ts`)
    diffs against an `original` snapshot so only a truly-changed field
    is sent, blank-if-changed as explicit `null`; new
    `optionalClearableString`/`Email` (`validate.ts`) accept
    null/empty as a valid "clear" signal instead of rejecting it;
    `updateCompany` now builds its `SET` clause dynamically from
    whichever keys are actually present in the patch, assigning
    directly rather than through `COALESCE`, so an omitted key is
    truly left out of the query and a `null` value truly clears. The
    NOT NULL columns (name, defaultCurrency, invoicePrefix,
    defaultInvoiceTemplate) deliberately stay non-clearable. See "F08
    — Company Optional Fields Must Be Clearable (Phase 48)" below

54. F09 — WhatsApp Customer PDF Access (security fix): the WhatsApp
    share message's PDF link pointed straight at the authenticated
    GET /api/invoices/:id/pdf — unopenable by a customer with no
    company login. Added a new, deliberately public route,
    GET /api/public/invoice-pdf/:token (invoice-share.routes.ts,
    mounted at its own /api/public path, never under /api/invoices),
    gated only by an unguessable (32 random bytes), expiring,
    invoice-specific token — new table `invoice_pdf_share_tokens`
    (migration 020, hash-only storage, same shape as `sessions`), new
    invoice-share.service.ts (createInvoicePdfShare/
    resolveInvoicePdfShare/buildCustomerPdfShareUrl, replacing the old
    buildPublicPdfUrl). The route takes no invoice id at all — only
    the token — so there is no second identifier for anyone to swap to
    reach a different invoice; the private PDF route itself is
    completely unchanged and still fully authenticated. See "F09 —
    WhatsApp Customer PDF Access (Phase 49)" below

55. F10 — Reset Payment Customer Filter on Company Switch (correctness
    fix): `App.tsx`'s `paymentsCustomerFilter` state survived a
    company switch and a logout/login transition, so a freshly
    switched-to company's Payments tab could open pre-filtered to a
    previous company's customer. Fixed with a new effect in App
    (`setPaymentsCustomerFilter(undefined)` on `me?.company.id`
    change — covers both company-switch and logout/login, since the
    latter always passes through `undefined`), plus making
    `PaymentsPage`'s own `initialCustomerId`-sync effect symmetric
    (sync to `undefined` too, not just a truthy value) so the cleared
    prop actually clears the page's own filter state. Verified live
    via Playwright against the real dev server (register, seed data
    via API, use the real "View payments"/company-switcher/logout-
    login UI flows), including a regression check that reverting the
    fix made the same script fail. See "F10 — Reset Payment Customer
    Filter on Company Switch (Phase 50)" below

56. Final Quality Pass After F01–F10 (lint cleanup, no functional
    change): fixed the two remaining lint issues — added
    `varsIgnorePattern: '^_'` to `apps/api/eslint.config.js` (matching
    the existing `argsIgnorePattern: '^_'`) so
    `membership.service.ts`'s deliberately-unused destructured
    `_status`/`_deactivatedAt` stop erroring; rewrote the F10 phase's
    "reset state when `me?.company.id`/`initialCustomerId` changes"
    logic (and the pre-existing `showProfile` effect alongside it) to
    use the React-docs "adjust state during render" pattern instead of
    `useEffect` — a state variable (not a ref, which oxlint's
    `react(refs)` rule correctly flags for the same reason) tracks the
    last-seen value and conditionally calls `setState` directly in the
    render body. `npm run lint` now passes with zero errors and zero
    warnings. Full regression pass confirmed all ten findings' tests
    (and a live Playwright re-check for F10, which has none) still
    pass. See "Final Quality Pass After F01–F10 (Phase 51)" below

57. F01 Re-Verification + Serving Hardening: independently re-audited
    and live-reproduced the Phase 41 SVG-upload fix from scratch (not
    trusting the prior fix) — confirmed the core vulnerability (SVG
    accepted as a logo, via honest Content-Type or disguised as PNG/
    JPEG) is NOT reproducible; `detectImageSignature`'s magic-byte
    check genuinely blocks all three. Found and fixed one residual
    serving-layer hardening gap in scope ("/uploads serving behavior"):
    no `X-Content-Type-Options: nosniff` header on served uploads.
    Added it via `express.static`'s `setHeaders` option in `app.ts`.
    New regression test proven to fail before this change and pass
    after. See "F01 Re-Verification + Serving Hardening (Phase 52)"
    below

58. F02 Re-Verification + Fresh-Login Regression Coverage:
    independently re-audited and live-reproduced the Phase 42 "prevent
    last active company lockout" fix — confirmed the exact reported
    scenario (deactivate A, then attempt to deactivate B too) is NOT
    reproducible; `pickAnotherActiveCompany`'s `status = 'active'`
    filter, the advisory-lock concurrency guard, and `auth.service.ts`/
    `requireAuth`'s matching active-only filters all still agree. Found
    one gap in *test coverage* (not the fix): no existing test tried a
    completely fresh login after an allowed deactivate/delete, only
    the same session's `/auth/me` — added two tests closing that gap
    for both actions. No service code changed. See "F02
    Re-Verification + Fresh-Login Regression Coverage (Phase 53)"
    below

59. F03 — WhatsApp Send Must Not Happen on GET (security fix): GET
    /api/invoices/:id/whatsapp-share always called
    WhatsAppService.buildShare, which uploads the PDF and sends a real
    WhatsApp Business Cloud API document message the moment
    credentials are configured — two GETs, two real sends, exactly as
    reported. Split into `previewInvoiceWhatsAppShare` (GET,
    structurally incapable of sending — never calls buildShare/
    generateInvoicePdf) and new `sendInvoiceWhatsAppShare` (new POST
    /api/invoices/:id/whatsapp-send, the only caller of buildShare),
    wrapped in an idempotency guard keyed on a required
    caller-supplied `idempotencyKey` against a new
    `whatsapp_send_requests` table (migration 021,
    UNIQUE(company, invoice, key)) so a retried/duplicated POST never
    sends twice. POST inherits the same tenant-isolation and CSRF
    protection (app-wide requireJsonForMutations) every other mutating
    route already has — no new code needed for either. Frontend only
    calls POST when the preview reports Business Cloud API is
    configured; otherwise unchanged (download PDF, user opens wa.me
    themselves). See "F03 — WhatsApp Send Must Not Happen on GET
    (Phase 54)" below

60. F04 — Discount Rounding Must Be Financially Consistent
    (correctness fix): `calculateDiscount` rounded `discountAmount`
    and `grandTotal` independently from the same unrounded Decimal,
    so a half-cent split (e.g. subtotal 1.01 @ 50% -> raw 0.505 twice)
    rounded both halves up under ROUND_HALF_UP: 0.51 + 0.51 = 1.02 for
    a 1.01 subtotal. Fixed by rounding discountAmount exactly once,
    then deriving grandTotal from that rounded value instead of the
    raw one — `subtotal === discountAmount + grandTotal` holds by
    construction. Every other consumer (reread, list, ledger debit,
    PDF/WhatsApp view model) already derived its figures from the
    stored discountAmount/grandTotal rather than recomputing, so
    fixing this one function fixed all of them; mirrored the identical
    fix in the frontend's previewDiscount so the live edit preview
    never disagrees with what gets saved. See "F04 — Discount
    Rounding Must Be Financially Consistent (Phase 55)" below

61. F05 — Paid Invoice Must Not Become Unpaid After Later Debit
    (re-verification, not a new fix): this report's F05 is the same
    root cause already fixed as "F04" in Phase 44 — the two review
    reports number the same finding differently. Independently
    re-audited `fifoPaidCtes` and live-reproduced every scenario this
    report lists (A: the exact report reproduction; B/C/D: opening-
    balance/adjustment-before/adjustment-after orderings) outside the
    test suite before adding anything — none reproduce the bug.
    Confirmed the one shared helper is still used by all four
    consumers (list, detail/delete-guard, dashboard — PDF/WhatsApp
    only ever consume the result). Added
    `invoice-fifo-allocation.test.ts` (6 tests, matching this report's
    own A–F lettering) as committed regression coverage for the B/C/D
    orderings specifically, which weren't previously tested by name
    anywhere even though already correctly handled. No production
    code changed. See "F05 — Paid Invoice Must Not Become Unpaid
    After Later Debit (Phase 56)" below

62. F06 — Invoice Amount Paid Must Never Be Negative
    (re-verification, not a new fix): this report's F06 is the exact
    same root cause already fixed as "F03" in Phase 43
    (`totalReceivable - currentBalance`, a whole-customer snapshot
    subtraction, going negative for an older unpaid invoice once a
    sibling invoice raised the customer's overall balance).
    Independently re-audited `buildLedgerSummary`/`getInvoicePaidAmount`
    and live-reproduced the exact report scenario (two unpaid 100
    invoices) and every test case the report lists before adding
    anything — none reproduce; the FIFO formula is mathematically
    bounded in [0, grandTotal] by construction. No production code
    changed. Added `invoice-amount-paid.test.ts` (7 tests) as
    committed regression coverage matching the report's own test
    list, including a global bounds sweep and a detail/list/PDF
    agreement check. See "F06 — Invoice Amount Paid Must Never Be
    Negative (Phase 57)" below

63. F09 — Zero-Total Invoice Historical Balance Must Remain Stable
    (correctness fix): a 100%-discounted invoice posts no ledger
    entry at all (nothing to bill), so `getInvoice`'s lookup of its
    own ledger entry's `created_at` (used to anchor `previousBalance`)
    found nothing and fell back to `new Date().toISOString()` — "now"
    — on every reread, making the historical `previousBalance` drift
    to match whatever the customer's balance happened to be at read
    time. Fixed by falling back to the invoice's own immutable
    `created_at` instead (timestamp-based, Option B — no new
    snapshot columns, no migration) — identical to what a non-zero
    invoice's own ledger entry's `created_at` would already be, since
    both default to `now()` inside the same creation transaction.
    `createInvoice`'s own creation-time response was never affected;
    `updateInvoice` and every PDF/WhatsApp consumer share the fix
    automatically since they all route through this one function. See
    "F09 — Zero-Total Invoice Historical Balance Must Remain Stable
    (Phase 58)" below

64. F10 — Discount Input Must Not Crash During Typing
    (re-verification, not a new fix): this report's F10 is the exact
    same root cause already fixed as "F05" in Phase 45 — raw
    mid-typing discount values like `"."`/`"-"`/`"abc"` could throw
    via `new Decimal(discountValueRaw)` outside safe validation.
    Independently re-audited `preview.ts`, `CreateInvoiceForm.tsx`,
    and `QuickInvoiceForm.tsx`: both forms already route exclusively
    through the shared `previewDiscount`/`parseDiscountValue` helper,
    which already never throws (try/catch + `.isFinite()` check,
    returns `Decimal | null`). No production code changed. Added
    `discount-input-safety.test.ts` (11 tests) as committed regression
    coverage matching the report's own test list, including a 13-state
    sweep across both discount types. See "F10 — Discount Input Must
    Not Crash During Typing (Phase 59)" below

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
