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
