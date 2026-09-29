import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import {
  ALLOWED_VARIABLES,
  Decimal,
  FormulaError,
  type DiscountType,
  type FormulaVariable,
  type InvoiceArchivedFilter,
  evaluateFormula,
  roundMoney,
} from '@invoice/shared';
import { postAuditLog } from '../audit/audit.service.js';
import { getBalanceBefore, getCustomerBalance, postLedgerEntry } from '../ledger/ledger.service.js';

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

export interface InvoiceItemInput {
  categoryId: string;
  description?: string;
  stitches: number;
  /** Overrides the category's default_rate for this item, if given. */
  rate?: string;
}

export interface InvoiceInput {
  customerId: string;
  invoiceDate?: string;
  quantity: string;
  notes?: string;
  status?: InvoiceStatus;
  /** Batch/material/job identifier, e.g. "LOT-001" — free text, optional, never required to be unique. */
  lotNumber?: string;
  /** Omitted/undefined means no discount — same as passing 'percentage'/'fixed' with a value of "0.00". */
  discountType?: DiscountType;
  discountValue?: string;
  items: InvoiceItemInput[];
}

/** Same shape as InvoiceInput minus customerId — a draft's customer is fixed once created; see updateInvoice. */
export type InvoiceUpdateInput = Omit<InvoiceInput, 'customerId' | 'status'>;

export interface DiscountResult {
  discountType: DiscountType | null;
  discountValue: string;
  discountAmount: string;
  grandTotal: string;
}

/**
 * Server-side-authoritative discount calculation (never trusts a total
 * sent from the frontend) — subtotal is always this invoice's own
 * sum-of-items, computed the same call it's used in, never passed in
 * from anywhere the client could influence.
 *
 *   percentage: discountAmount = subtotal * discountValue / 100, and
 *     discountValue must be within [0, 100].
 *   fixed: discountAmount = discountValue, and discountValue must not
 *     exceed subtotal (which also guarantees grandTotal can't go
 *     negative — the same guarantee percentage gets from the 0-100
 *     bound).
 *
 * No discountType (undefined/null) means no discount at all: any
 * discountValue passed alongside it is ignored, not an error — the
 * caller didn't ask for a discount.
 */
export function calculateDiscount(
  subtotal: string,
  discountType: DiscountType | null | undefined,
  discountValue: string | undefined,
): DiscountResult {
  if (!discountType) {
    return { discountType: null, discountValue: '0.00', discountAmount: '0.00', grandTotal: roundMoney(new Decimal(subtotal)) };
  }

  const value = new Decimal(discountValue ?? '0');
  if (value.isNegative()) {
    throw badRequest('Validation failed', { discountValue: 'Discount cannot be negative' });
  }

  let discountAmount: Decimal;
  if (discountType === 'percentage') {
    if (value.greaterThan(100)) {
      throw badRequest('Validation failed', { discountValue: 'Percentage discount must be between 0 and 100' });
    }
    discountAmount = new Decimal(subtotal).times(value).dividedBy(100);
  } else {
    if (value.greaterThan(subtotal)) {
      throw badRequest('Validation failed', { discountValue: 'Fixed discount cannot exceed the subtotal' });
    }
    discountAmount = value;
  }

  const grandTotal = new Decimal(subtotal).minus(discountAmount);
  if (grandTotal.isNegative()) {
    // Defensive only — unreachable given the checks above, kept so a
    // future change to this function can't silently let the total go negative.
    throw badRequest('Validation failed', { discountValue: 'Discount cannot exceed the invoice subtotal' });
  }

  return {
    discountType,
    discountValue: roundMoney(value),
    discountAmount: roundMoney(discountAmount),
    grandTotal: roundMoney(grandTotal),
  };
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  categoryId: string | null;
  categoryName: string;
  description: string | null;
  stitches: number;
  rate: string;
  formulaType: string;
  formulaConfig: Record<string, unknown>;
  calculationInputs: Record<string, unknown>;
  calculatedUnitAmount: string;
  calculatedTotal: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  quantity: string;
  notes: string | null;
  status: InvoiceStatus;
  createdAt: string;
  archivedAt: string | null;
  lotNumber: string | null;
  discountType: DiscountType | null;
  discountValue: string;
  discountAmount: string;
}

/**
 * The ledger-derived statement for one invoice (Phase 8):
 *   previousBalance   — customer's balance immediately before this invoice was posted
 *   totalReceivable    — previousBalance + this invoice's grandTotal (post-discount)
 *   currentBalance      — the customer's live balance right now (total debit - total credit, overall)
 *   amountPaid          — totalReceivable - currentBalance
 * All five are generated from ledger_entries on every read, never stored.
 */
export interface InvoiceLedgerSummary {
  previousBalance: string;
  totalReceivable: string;
  amountPaid: string;
  currentBalance: string;
}

export interface InvoiceWithItems extends Invoice, InvoiceLedgerSummary {
  items: InvoiceItem[];
  /** Sum of items' calculated_total — derived on read, never stored. Pre-discount subtotal. */
  totalAmount: string;
  /** totalAmount - discountAmount — derived on read, never stored. What the ledger debit equals. */
  grandTotal: string;
}

export type InvoicePaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED';

export interface InvoiceListEntry extends Invoice {
  totalAmount: string;
  grandTotal: string;
  paid: string;
  balance: string;
  paymentStatus: InvoicePaymentStatus;
}

export type { InvoiceArchivedFilter };

export interface InvoiceListFilter {
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  paymentStatus?: InvoicePaymentStatus;
  search?: string;
  /** Defaults to 'active' (archived invoices hidden) when not given. */
  archived?: InvoiceArchivedFilter;
}

// A pg Pool and a pg PoolClient (inside a transaction) share this shape,
// so every read/write helper below works with either.
type Queryable = Pick<typeof pool, 'query'>;

const INVOICE_HEADER_COLUMNS = `
  i.id, i.company_id AS "companyId", i.customer_id AS "customerId", c.name AS "customerName",
  i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate", i.quantity, i.notes, i.status,
  i.created_at AS "createdAt", i.archived_at AS "archivedAt",
  i.lot_number AS "lotNumber", i.discount_type AS "discountType",
  i.discount_value AS "discountValue", i.discount_amount AS "discountAmount"
`;

const ITEM_COLUMNS = `
  id, invoice_id AS "invoiceId", category_id AS "categoryId", category_name AS "categoryName",
  description, stitches, rate,
  formula_type AS "formulaType", formula_config AS "formulaConfig",
  calculation_inputs AS "calculationInputs",
  calculated_unit_amount AS "calculatedUnitAmount", calculated_total AS "calculatedTotal",
  created_at AS "createdAt"
`;

function sumDecimalStrings(values: string[]): string {
  return roundMoney(values.reduce((sum, value) => sum.plus(new Decimal(value)), new Decimal(0)));
}

async function buildLedgerSummary(
  client: Queryable,
  companyId: string,
  customerId: string,
  invoiceAmount: string,
  invoiceLedgerCreatedAt: string,
): Promise<InvoiceLedgerSummary> {
  const previousBalance = await getBalanceBefore(client, companyId, customerId, invoiceLedgerCreatedAt);
  const totalReceivable = roundMoney(new Decimal(previousBalance).plus(invoiceAmount));
  const currentBalance = await getCustomerBalance(client, companyId, customerId);
  const amountPaid = roundMoney(new Decimal(totalReceivable).minus(currentBalance));
  return { previousBalance, totalReceivable, amountPaid, currentBalance };
}

/**
 * Assigns the next invoice number for a company: {invoicePrefix}-{n},
 * zero-padded. The row lock the UPDATE takes serializes concurrent
 * callers for the same company, so two requests can never be handed the
 * same number — this only runs inside the invoice-creating transaction,
 * so a failed invoice also rolls the counter back.
 */
async function nextInvoiceNumber(client: Queryable, companyId: string): Promise<string> {
  await client.query('INSERT INTO invoice_counters (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING', [
    companyId,
  ]);
  const counter = await client.query<{ assigned: number }>(
    'UPDATE invoice_counters SET next_number = next_number + 1 WHERE company_id = $1 RETURNING next_number - 1 AS assigned',
    [companyId],
  );
  const prefixRes = await client.query<{ invoicePrefix: string }>(
    'SELECT invoice_prefix AS "invoicePrefix" FROM companies WHERE id = $1',
    [companyId],
  );
  const prefix = prefixRes.rows[0]?.invoicePrefix || 'INV';
  return `${prefix}-${String(counter.rows[0].assigned).padStart(6, '0')}`;
}

/**
 * Calculates and inserts one invoice item. The category's current
 * default_rate, formula_type, and formula_config are read once, right
 * now, and copied onto the row — nothing about this item ever changes
 * again just because the category later does.
 */
async function createInvoiceItem(
  client: Queryable,
  companyId: string,
  invoiceId: string,
  invoiceQuantity: string,
  input: InvoiceItemInput,
): Promise<InvoiceItem> {
  const categoryRes = await client.query<{
    id: string;
    name: string;
    defaultRate: string;
    formulaType: string;
    formulaConfig: Record<string, unknown>;
    active: boolean;
  }>(
    `SELECT id, name, default_rate AS "defaultRate", formula_type AS "formulaType",
            formula_config AS "formulaConfig", active
       FROM embroidery_categories WHERE id = $1 AND company_id = $2`,
    [input.categoryId, companyId],
  );
  const category = categoryRes.rows[0];
  if (!category) throw notFound('Category not found');
  if (!category.active) throw badRequest('Validation failed', { categoryId: `Category "${category.name}" is disabled` });

  // Convention (Phase 5 left formula_config free-form on purpose): the
  // formula text lives at formula_config.expression, evaluated by the
  // Phase 6 engine. Any other numeric entries in formula_config that
  // match an engine variable name are fixed values for this category
  // (e.g. a baked-in multiplier/divisor); stitches/rate/quantity below
  // always take precedence over anything of the same name in there.
  const expression = category.formulaConfig.expression;
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw badRequest('Validation failed', { categoryId: `Category "${category.name}" has no formula configured` });
  }

  const rate = input.rate ?? category.defaultRate;
  const baseInputs: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(category.formulaConfig)) {
    if ((ALLOWED_VARIABLES as readonly string[]).includes(key) && (typeof value === 'number' || typeof value === 'string')) {
      baseInputs[key as FormulaVariable] = value;
    }
  }
  const calculationInputs: Record<string, string | number> = {
    ...baseInputs,
    stitches: input.stitches,
    rate,
    quantity: invoiceQuantity,
  };

  let unitAmount: string;
  try {
    unitAmount = roundMoney(evaluateFormula(expression, calculationInputs));
  } catch (err) {
    if (err instanceof FormulaError) {
      throw badRequest('Validation failed', { categoryId: `Category "${category.name}": ${err.message}` });
    }
    throw err;
  }
  const total = roundMoney(new Decimal(unitAmount).times(invoiceQuantity));

  const { rows } = await client.query<InvoiceItem>(
    `INSERT INTO invoice_items
       (invoice_id, category_id, category_name, description, stitches, rate,
        formula_type, formula_config, calculation_inputs, calculated_unit_amount, calculated_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${ITEM_COLUMNS}`,
    [
      invoiceId,
      category.id,
      category.name,
      input.description ?? null,
      input.stitches,
      rate,
      category.formulaType,
      JSON.stringify(category.formulaConfig),
      JSON.stringify(calculationInputs),
      unitAmount,
      total,
    ],
  );
  return rows[0];
}

/**
 * Creates an invoice with all of its items in a single transaction: the
 * invoice number, every item's formula evaluation, and the rows
 * themselves all commit together or not at all. All amounts are
 * computed here, server-side, via the formula engine — nothing about
 * calculated_unit_amount or calculated_total is ever accepted from the
 * request.
 */
export async function createInvoice(
  companyId: string,
  userId: string,
  input: InvoiceInput,
  auditMetadataExtra: Record<string, unknown> = {},
): Promise<InvoiceWithItems> {
  if (input.items.length === 0) {
    throw badRequest('Validation failed', { items: 'At least one item is required' });
  }

  return withTransaction(async (client) => {
    const customerRes = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM customers WHERE id = $1 AND company_id = $2',
      [input.customerId, companyId],
    );
    const customer = customerRes.rows[0];
    if (!customer) throw notFound('Customer not found');

    const invoiceNumber = await nextInvoiceNumber(client, companyId);

    const invoiceRes = await client.query<{ id: string; invoiceDate: string; quantity: string; createdAt: string }>(
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, quantity, notes, status, lot_number)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, COALESCE($7, 'draft'), $8)
       RETURNING id, invoice_date AS "invoiceDate", quantity, created_at AS "createdAt"`,
      [
        companyId,
        input.customerId,
        invoiceNumber,
        input.invoiceDate ?? null,
        input.quantity,
        input.notes ?? null,
        input.status ?? null,
        input.lotNumber ?? null,
      ],
    );
    // Use the DB-normalized quantity (e.g. "10.00") everywhere below, so a
    // freshly created invoice's response matches what a later GET returns.
    const { id: invoiceId, invoiceDate, quantity, createdAt } = invoiceRes.rows[0];

    const items: InvoiceItem[] = [];
    for (const itemInput of input.items) {
      items.push(await createInvoiceItem(client, companyId, invoiceId, quantity, itemInput));
    }
    const totalAmount = sumDecimalStrings(items.map((item) => item.calculatedTotal));
    const discount = calculateDiscount(totalAmount, input.discountType, input.discountValue);

    await client.query(
      'UPDATE invoices SET discount_type = $2, discount_value = $3, discount_amount = $4 WHERE id = $1',
      [invoiceId, discount.discountType, discount.discountValue, discount.discountAmount],
    );

    // Posting this in the same transaction as the invoice and its items
    // means all of it commits together or none of it does. The ledger
    // debit — and everything derived from it (balances, statements,
    // dashboard totals) — is the post-discount grand total, never the
    // subtotal: a discounted invoice never bills the customer for more
    // than what they actually owe. A 100%-discounted invoice has nothing
    // to bill at all (grandTotal "0.00") — ledger_entries requires
    // exactly one of debit/credit to be positive, so there's simply no
    // entry to post here; the invoice and its items are still saved.
    const ledgerCreatedAt = discount.grandTotal === '0.00'
      ? createdAt
      : (
          await postLedgerEntry(client, {
            companyId,
            customerId: input.customerId,
            type: 'INVOICE',
            referenceId: invoiceId,
            debit: discount.grandTotal,
            date: invoiceDate,
            notes: `Invoice ${invoiceNumber}`,
          })
        ).createdAt;
    const summary = await buildLedgerSummary(client, companyId, input.customerId, discount.grandTotal, ledgerCreatedAt);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_CREATED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber, customerId: input.customerId, totalAmount, grandTotal: discount.grandTotal, ...auditMetadataExtra },
    });

    return {
      id: invoiceId,
      companyId,
      customerId: input.customerId,
      customerName: customer.name,
      invoiceNumber,
      invoiceDate,
      quantity,
      notes: input.notes ?? null,
      status: input.status ?? 'draft',
      createdAt,
      archivedAt: null,
      lotNumber: input.lotNumber ?? null,
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      discountAmount: discount.discountAmount,
      items,
      totalAmount,
      grandTotal: discount.grandTotal,
      ...summary,
    };
  });
}

/**
 * Invoice history (Phase 15). Each row's `paid`/`balance`/`paymentStatus`
 * apply standard AR aging: a customer's payments/credits pay off their
 * *oldest* debt first (same FIFO rule as the dashboard's unpaid/partial
 * count — see dashboard.service.ts), so an invoice already fully covered
 * by later payments shows PAID even if the customer has since run up a
 * new, unpaid balance elsewhere. This needs the customer's *entire*
 * ledger to compute correctly, so the FIFO CTEs below are scoped only by
 * company_id — every other filter (customer/date/status/search) is
 * applied in the outer WHERE, after paymentStatus is already computed,
 * never by trimming which ledger rows feed the FIFO math.
 *
 * A cancelled invoice's own ledger debit is *not* currently reversed
 * (this app has no route that actually sets status='cancelled' yet), so
 * if that's ever added, the FIFO math here would need the same reversal
 * to keep other invoices' paymentStatus correct.
 */
export async function listInvoices(companyId: string, filter: InvoiceListFilter): Promise<InvoiceListEntry[]> {
  const conditions = ['1 = 1'];
  const params: unknown[] = [companyId];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.customerId) {
    params.push(filter.customerId);
    conditions.push(`"customerId" = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    conditions.push(`"invoiceDate" >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    conditions.push(`"invoiceDate" <= $${params.length}`);
  }
  if (filter.paymentStatus) {
    params.push(filter.paymentStatus);
    conditions.push(`"paymentStatus" = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    conditions.push(`("invoiceNumber" ILIKE $${params.length} OR "customerName" ILIKE $${params.length} OR "lotNumber" ILIKE $${params.length})`);
  }
  // Default 'active': archived invoices are hidden unless explicitly
  // asked for — see InvoiceArchivedFilter. Archiving never deletes or
  // recalculates anything, so an 'all'/'archived' read returns exactly
  // the same totals/paymentStatus math as 'active', just a different
  // WHERE clause.
  if ((filter.archived ?? 'active') === 'active') {
    conditions.push(`"archivedAt" IS NULL`);
  } else if (filter.archived === 'archived') {
    conditions.push(`"archivedAt" IS NOT NULL`);
  }

  const { rows } = await pool.query<InvoiceListEntry>(
    `WITH balances AS (
       SELECT customer_id, SUM(debit) - SUM(credit) AS current_balance
         FROM ledger_entries WHERE company_id = $1 GROUP BY customer_id
     ),
     ordered AS (
       SELECT
         le.customer_id,
         le.reference_id AS invoice_id,
         le.debit,
         SUM(le.debit) OVER (
           PARTITION BY le.customer_id
           ORDER BY le.created_at DESC, le.id DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS cumulative_before
       FROM ledger_entries le
       WHERE le.company_id = $1 AND le.type = 'INVOICE' AND le.debit > 0
     ),
     paid_amounts AS (
       SELECT
         o.invoice_id,
         o.debit - LEAST(o.debit, GREATEST(b.current_balance - COALESCE(o.cumulative_before, 0), 0)) AS paid
       FROM ordered o
       JOIN balances b ON b.customer_id = o.customer_id
     ),
     invoice_rows AS (
       SELECT
         i.id, i.company_id AS "companyId", i.customer_id AS "customerId", c.name AS "customerName",
         i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate", i.quantity, i.notes,
         i.status, i.created_at AS "createdAt", i.archived_at AS "archivedAt",
         i.lot_number AS "lotNumber", i.discount_type AS "discountType",
         i.discount_value AS "discountValue", i.discount_amount AS "discountAmount",
         COALESCE(items.total, 0) AS "totalAmount",
         COALESCE(items.total, 0) - i.discount_amount AS "grandTotal",
         COALESCE(pa.paid, 0) AS paid,
         COALESCE(items.total, 0) - i.discount_amount - COALESCE(pa.paid, 0) AS balance,
         CASE
           WHEN i.status = 'cancelled' THEN 'CANCELLED'
           WHEN COALESCE(items.total, 0) - i.discount_amount - COALESCE(pa.paid, 0) <= 0 THEN 'PAID'
           WHEN COALESCE(pa.paid, 0) > 0 THEN 'PARTIAL'
           ELSE 'UNPAID'
         END AS "paymentStatus"
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN paid_amounts pa ON pa.invoice_id = i.id
       LEFT JOIN LATERAL (
         SELECT SUM(it.calculated_total) AS total FROM invoice_items it WHERE it.invoice_id = i.id
       ) items ON true
       WHERE i.company_id = $1
     )
     SELECT * FROM invoice_rows
      WHERE ${conditions.join(' AND ')}
      ORDER BY "createdAt" DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

export async function getInvoice(companyId: string, invoiceId: string): Promise<InvoiceWithItems> {
  const headerRes = await pool.query<Invoice>(
    `SELECT ${INVOICE_HEADER_COLUMNS} FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.id = $1 AND i.company_id = $2`,
    [invoiceId, companyId],
  );
  const header = headerRes.rows[0];
  if (!header) throw notFound('Invoice not found');

  const itemsRes = await pool.query<InvoiceItem>(
    `SELECT ${ITEM_COLUMNS} FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId],
  );
  const totalAmount = sumDecimalStrings(itemsRes.rows.map((i) => i.calculatedTotal));
  const grandTotal = roundMoney(new Decimal(totalAmount).minus(header.discountAmount));

  const ledgerRes = await pool.query<{ createdAt: string }>(
    `SELECT created_at AS "createdAt" FROM ledger_entries WHERE reference_id = $1 AND type = 'INVOICE' LIMIT 1`,
    [invoiceId],
  );
  // Every invoice posts its own INVOICE entry at creation time (see
  // createInvoice), so this should always be found; fall back to "now"
  // defensively rather than fail the whole read if it somehow isn't.
  const ledgerCreatedAt = ledgerRes.rows[0]?.createdAt ?? new Date().toISOString();
  const summary = await buildLedgerSummary(pool, companyId, header.customerId, grandTotal, ledgerCreatedAt);

  return { ...header, items: itemsRes.rows, totalAmount, grandTotal, ...summary };
}

/**
 * Duplicates an invoice's items into a brand-new draft (Phase 15).
 * Goes through createInvoice exactly like any other new invoice, so
 * every amount is recalculated fresh from the current formula engine
 * and category state, and exactly one new ledger entry is posted for
 * the new invoice — the original's payments and ledger entries are
 * never touched or copied. A deleted category (categoryId now null)
 * can't be re-validated by createInvoice, so that's rejected up front
 * with a clear reason instead of silently dropping the item.
 *
 * The discount type/value carry over (a duplicate is usually "the same
 * order again"), but the lot number deliberately does not — each new
 * batch/job is expected to get its own lot number, so leaving the field
 * blank is safer than silently reusing the original's.
 */
export async function duplicateInvoice(companyId: string, userId: string, invoiceId: string): Promise<InvoiceWithItems> {
  const original = await getInvoice(companyId, invoiceId);

  if (original.items.some((item) => !item.categoryId)) {
    throw badRequest('Validation failed', {
      items: 'One or more items reference a deleted category and cannot be duplicated',
    });
  }

  return createInvoice(
    companyId,
    userId,
    {
      customerId: original.customerId,
      quantity: original.quantity,
      notes: original.notes ?? undefined,
      status: 'draft',
      discountType: original.discountType ?? undefined,
      discountValue: original.discountType ? original.discountValue : undefined,
      items: original.items.map((item) => ({
        categoryId: item.categoryId as string,
        description: item.description ?? undefined,
        stitches: item.stitches,
        rate: item.rate,
      })),
    },
    { duplicatedFromInvoiceId: original.id, duplicatedFromInvoiceNumber: original.invoiceNumber },
  );
}

/**
 * Edits a draft invoice in place: quantity, date, notes, lot number,
 * discount, and the full item list are all replaceable — but only while
 * `status === 'draft'`. Once issued, an invoice is immutable (archive or
 * duplicate instead), same boundary deleteInvoice already draws. The
 * customer can't be reassigned here (that would mean moving the ledger
 * debit to a different customer's history, a bigger operation this app
 * doesn't support yet) — to bill a different customer, duplicate the
 * invoice instead.
 *
 * Items are fully replaced (delete + recreate) rather than diffed, same
 * as createInvoice's own item-creation path — every amount is
 * recalculated fresh from the current formula engine and category state,
 * exactly like a brand-new invoice would be. The invoice's own ledger
 * entry is updated in place (not deleted and reposted) so its
 * created_at — and therefore its position in every customer's FIFO
 * payment allocation — never moves just because the invoice was edited.
 */
export async function updateInvoice(
  companyId: string,
  userId: string,
  invoiceId: string,
  input: InvoiceUpdateInput,
): Promise<InvoiceWithItems> {
  if (input.items.length === 0) {
    throw badRequest('Validation failed', { items: 'At least one item is required' });
  }

  await withTransaction(async (client) => {
    const existing = await lockInvoiceForUpdate(client, companyId, invoiceId);
    if (existing.status !== 'draft') {
      throw badRequest('Validation failed', { status: 'Only draft invoices can be edited.' });
    }

    const invoiceRes = await client.query<{ invoiceDate: string; quantity: string }>(
      `UPDATE invoices
          SET invoice_date = COALESCE($3::date, invoice_date),
              quantity = $4,
              notes = $5,
              lot_number = $6,
              updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING invoice_date AS "invoiceDate", quantity`,
      [invoiceId, companyId, input.invoiceDate ?? null, input.quantity, input.notes ?? null, input.lotNumber ?? null],
    );
    const { invoiceDate, quantity } = invoiceRes.rows[0];

    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    const items: InvoiceItem[] = [];
    for (const itemInput of input.items) {
      items.push(await createInvoiceItem(client, companyId, invoiceId, quantity, itemInput));
    }
    const totalAmount = sumDecimalStrings(items.map((item) => item.calculatedTotal));
    const discount = calculateDiscount(totalAmount, input.discountType, input.discountValue);

    await client.query(
      'UPDATE invoices SET discount_type = $2, discount_value = $3, discount_amount = $4 WHERE id = $1',
      [invoiceId, discount.discountType, discount.discountValue, discount.discountAmount],
    );

    // Same row, same created_at — only debit/date/notes move, so this
    // invoice's place in FIFO payment allocation across the customer's
    // whole ledger never shifts just because it was edited. A
    // 100%-discounted edit has nothing to bill (see the same case in
    // createInvoice above), so the entry is removed rather than updated
    // to a zero debit, which the ledger_entries check constraint
    // forbids; editing back up from zero re-creates it as a fresh row.
    if (discount.grandTotal === '0.00') {
      await client.query(`DELETE FROM ledger_entries WHERE company_id = $1 AND reference_id = $2 AND type = 'INVOICE'`, [
        companyId,
        invoiceId,
      ]);
    } else {
      const updated = await client.query(
        `UPDATE ledger_entries SET debit = $3, date = $4, notes = $5
          WHERE company_id = $1 AND reference_id = $2 AND type = 'INVOICE'`,
        [companyId, invoiceId, discount.grandTotal, invoiceDate, `Invoice ${existing.invoiceNumber}`],
      );
      if (updated.rowCount === 0) {
        await postLedgerEntry(client, {
          companyId,
          customerId: existing.customerId,
          type: 'INVOICE',
          referenceId: invoiceId,
          debit: discount.grandTotal,
          date: invoiceDate,
          notes: `Invoice ${existing.invoiceNumber}`,
        });
      }
    }

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_EDITED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: existing.invoiceNumber, customerId: existing.customerId, totalAmount, grandTotal: discount.grandTotal },
    });
  });

  return getInvoice(companyId, invoiceId);
}

/**
 * This one invoice's own FIFO-allocated paid amount — the exact same
 * "oldest debt gets paid first" rule listInvoices applies per row (see
 * its paid_amounts CTE above), just scoped to a single invoice instead
 * of a whole company. Used by deleteInvoice to decide whether any
 * payment has actually reached this invoice before allowing a hard
 * delete — never by anything that touches balances themselves.
 */
async function getInvoicePaidAmount(
  client: Queryable,
  companyId: string,
  customerId: string,
  invoiceId: string,
): Promise<string> {
  const { rows } = await client.query<{ paid: string | null }>(
    `WITH balances AS (
       SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS current_balance
         FROM ledger_entries WHERE company_id = $1 AND customer_id = $2
     ),
     ordered AS (
       SELECT
         le.reference_id AS invoice_id,
         le.debit,
         SUM(le.debit) OVER (
           ORDER BY le.created_at DESC, le.id DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS cumulative_before
       FROM ledger_entries le
       WHERE le.company_id = $1 AND le.customer_id = $2 AND le.type = 'INVOICE' AND le.debit > 0
     )
     SELECT o.debit - LEAST(o.debit, GREATEST(b.current_balance - COALESCE(o.cumulative_before, 0), 0)) AS paid
       FROM balances b
       LEFT JOIN ordered o ON o.invoice_id = $3
      WHERE o.invoice_id = $3`,
    [companyId, customerId, invoiceId],
  );
  return roundMoney(new Decimal(rows[0]?.paid ?? 0));
}

/**
 * Fetches an invoice header row-locked (FOR UPDATE) for a lifecycle
 * mutation (archive/unarchive/delete) — the lock serializes two
 * concurrent requests against the same invoice (e.g. a doubled click on
 * Archive) so the second one sees the first one's committed change
 * instead of racing it.
 */
async function lockInvoiceForUpdate(
  client: Queryable,
  companyId: string,
  invoiceId: string,
): Promise<{ invoiceNumber: string; customerId: string; status: InvoiceStatus; archivedAt: string | null }> {
  const { rows } = await client.query<{
    invoiceNumber: string;
    customerId: string;
    status: InvoiceStatus;
    archivedAt: string | null;
  }>(
    `SELECT invoice_number AS "invoiceNumber", customer_id AS "customerId", status, archived_at AS "archivedAt"
       FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  const row = rows[0];
  if (!row) throw notFound('Invoice not found');
  return row;
}

/**
 * Archive (Phase 21): hides the invoice from the default list. Never
 * touches ledger_entries, invoice_items, or payments — purely a
 * visibility flag, so every balance/statement/dashboard figure derived
 * from those tables is unaffected.
 */
export async function archiveInvoice(companyId: string, userId: string, invoiceId: string): Promise<InvoiceWithItems> {
  await withTransaction(async (client) => {
    const invoice = await lockInvoiceForUpdate(client, companyId, invoiceId);
    if (invoice.archivedAt) {
      throw badRequest('Validation failed', { archived: 'This invoice is already archived' });
    }

    await client.query('UPDATE invoices SET archived_at = now(), archived_by = $3 WHERE id = $1 AND company_id = $2', [
      invoiceId,
      companyId,
      userId,
    ]);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_ARCHIVED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: invoice.invoiceNumber, customerId: invoice.customerId },
    });
  });
  return getInvoice(companyId, invoiceId);
}

/** Restores an archived invoice to the default list. Recalculates nothing — see archiveInvoice. */
export async function unarchiveInvoice(companyId: string, userId: string, invoiceId: string): Promise<InvoiceWithItems> {
  await withTransaction(async (client) => {
    const invoice = await lockInvoiceForUpdate(client, companyId, invoiceId);
    if (!invoice.archivedAt) {
      throw badRequest('Validation failed', { archived: 'This invoice is not archived' });
    }

    await client.query('UPDATE invoices SET archived_at = NULL, archived_by = NULL WHERE id = $1 AND company_id = $2', [
      invoiceId,
      companyId,
    ]);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_UNARCHIVED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: invoice.invoiceNumber, customerId: invoice.customerId },
    });
  });
  return getInvoice(companyId, invoiceId);
}

/**
 * Permanently deletes an invoice, but only when doing so can never
 * corrupt accounting history:
 *
 *  - status must be 'draft' — an issued (or cancelled) invoice is never
 *    hard-deleted; archive it instead.
 *  - this invoice's own FIFO-allocated paid amount (see
 *    getInvoicePaidAmount) must be exactly zero — if any payment has
 *    actually reached this invoice, deleting it would erase the record
 *    of what that payment was for.
 *
 * When both hold, the invoice's own ledger debit (and only that entry —
 * the DELETE below is scoped to type='INVOICE' AND reference_id, so a
 * PAYMENT or ADJUSTMENT row is never touched even by accident) is
 * removed in the same transaction as the invoice row itself;
 * invoice_items cascades via its own foreign key. Archived-ness has no
 * bearing on eligibility — an archived draft with no payments is just
 * as safe to delete as an active one.
 */
export async function deleteInvoice(companyId: string, userId: string, invoiceId: string): Promise<void> {
  await withTransaction(async (client) => {
    const invoice = await lockInvoiceForUpdate(client, companyId, invoiceId);

    if (invoice.status !== 'draft') {
      throw badRequest('Validation failed', {
        status: 'Only draft invoices can be permanently deleted. Cancel or archive an issued invoice instead.',
      });
    }

    const paid = await getInvoicePaidAmount(client, companyId, invoice.customerId, invoiceId);
    if (new Decimal(paid).greaterThan(0)) {
      throw badRequest('Validation failed', {
        payments:
          'This invoice has a payment applied to it and cannot be permanently deleted — archive it instead to preserve accounting history.',
      });
    }

    const totalRes = await client.query<{ total: string | null }>(
      'SELECT SUM(calculated_total) AS total FROM invoice_items WHERE invoice_id = $1',
      [invoiceId],
    );
    const totalAmount = roundMoney(new Decimal(totalRes.rows[0].total ?? 0));

    await client.query(`DELETE FROM ledger_entries WHERE company_id = $1 AND reference_id = $2 AND type = 'INVOICE'`, [
      companyId,
      invoiceId,
    ]);
    await client.query('DELETE FROM invoices WHERE id = $1 AND company_id = $2', [invoiceId, companyId]);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_DELETED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber: invoice.invoiceNumber, customerId: invoice.customerId, totalAmount },
    });
  });
}
