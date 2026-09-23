import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import {
  ALLOWED_VARIABLES,
  Decimal,
  FormulaError,
  type FormulaVariable,
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
  items: InvoiceItemInput[];
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
}

/**
 * The ledger-derived statement for one invoice (Phase 8):
 *   previousBalance   — customer's balance immediately before this invoice was posted
 *   totalAmount        — this invoice's own total ("Current Invoice Amount")
 *   totalReceivable    — previousBalance + totalAmount
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
  /** Sum of items' calculated_total — derived on read, never stored. Also "Current Invoice Amount". */
  totalAmount: string;
}

export type InvoicePaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED';

export interface InvoiceListEntry extends Invoice {
  totalAmount: string;
  paid: string;
  balance: string;
  paymentStatus: InvoicePaymentStatus;
}

export interface InvoiceListFilter {
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  paymentStatus?: InvoicePaymentStatus;
  search?: string;
}

// A pg Pool and a pg PoolClient (inside a transaction) share this shape,
// so every read/write helper below works with either.
type Queryable = Pick<typeof pool, 'query'>;

const INVOICE_HEADER_COLUMNS = `
  i.id, i.company_id AS "companyId", i.customer_id AS "customerId", c.name AS "customerName",
  i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate", i.quantity, i.notes, i.status,
  i.created_at AS "createdAt"
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
      `INSERT INTO invoices (company_id, customer_id, invoice_number, invoice_date, quantity, notes, status)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, COALESCE($7, 'draft'))
       RETURNING id, invoice_date AS "invoiceDate", quantity, created_at AS "createdAt"`,
      [companyId, input.customerId, invoiceNumber, input.invoiceDate ?? null, input.quantity, input.notes ?? null, input.status ?? null],
    );
    // Use the DB-normalized quantity (e.g. "10.00") everywhere below, so a
    // freshly created invoice's response matches what a later GET returns.
    const { id: invoiceId, invoiceDate, quantity, createdAt } = invoiceRes.rows[0];

    const items: InvoiceItem[] = [];
    for (const itemInput of input.items) {
      items.push(await createInvoiceItem(client, companyId, invoiceId, quantity, itemInput));
    }
    const totalAmount = sumDecimalStrings(items.map((item) => item.calculatedTotal));

    // Posting this in the same transaction as the invoice and its items
    // means all of it commits together or none of it does.
    const ledgerEntry = await postLedgerEntry(client, {
      companyId,
      customerId: input.customerId,
      type: 'INVOICE',
      referenceId: invoiceId,
      debit: totalAmount,
      date: invoiceDate,
      notes: `Invoice ${invoiceNumber}`,
    });
    const summary = await buildLedgerSummary(client, companyId, input.customerId, totalAmount, ledgerEntry.createdAt);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'INVOICE_CREATED',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoiceNumber, customerId: input.customerId, totalAmount, ...auditMetadataExtra },
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
      items,
      totalAmount,
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
    conditions.push(`("invoiceNumber" ILIKE $${params.length} OR "customerName" ILIKE $${params.length})`);
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
         i.status, i.created_at AS "createdAt",
         COALESCE(items.total, 0) AS "totalAmount",
         COALESCE(pa.paid, 0) AS paid,
         COALESCE(items.total, 0) - COALESCE(pa.paid, 0) AS balance,
         CASE
           WHEN i.status = 'cancelled' THEN 'CANCELLED'
           WHEN COALESCE(items.total, 0) - COALESCE(pa.paid, 0) <= 0 THEN 'PAID'
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

  const ledgerRes = await pool.query<{ createdAt: string }>(
    `SELECT created_at AS "createdAt" FROM ledger_entries WHERE reference_id = $1 AND type = 'INVOICE' LIMIT 1`,
    [invoiceId],
  );
  // Every invoice posts its own INVOICE entry at creation time (see
  // createInvoice), so this should always be found; fall back to "now"
  // defensively rather than fail the whole read if it somehow isn't.
  const ledgerCreatedAt = ledgerRes.rows[0]?.createdAt ?? new Date().toISOString();
  const summary = await buildLedgerSummary(pool, companyId, header.customerId, totalAmount, ledgerCreatedAt);

  return { ...header, items: itemsRes.rows, totalAmount, ...summary };
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
