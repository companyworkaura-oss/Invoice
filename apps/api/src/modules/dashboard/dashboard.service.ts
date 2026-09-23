import { Decimal, roundMoney } from '@invoice/shared';
import type {
  DashboardRange,
  DashboardRecentInvoice,
  DashboardRecentPayment,
  DashboardOutstandingCustomer,
  DashboardSummary,
} from '@invoice/shared';
import { pool } from '../../db/pool.js';
import { badRequest } from '../../lib/http-error.js';

const RECENT_LIMIT = 10;
const OUTSTANDING_LIMIT = 20;

interface Period {
  from: string;
  to: string;
}

/**
 * "today"/"month" are resolved from the database's own CURRENT_DATE
 * (not the Node process clock) so they line up exactly with how
 * invoice_date/date columns already default — one server-authoritative
 * notion of "today" for the whole app.
 */
async function resolvePeriod(range: DashboardRange, from?: string, to?: string): Promise<Period> {
  if (range === 'custom') {
    if (!from || !to) {
      throw badRequest('Validation failed', { range: 'Custom range requires both from and to' });
    }
    if (from > to) {
      throw badRequest('Validation failed', { to: 'Must be on or after from' });
    }
    return { from, to };
  }

  const { rows } = await pool.query<{ today: string; monthStart: string; monthEnd: string }>(
    `SELECT CURRENT_DATE::text AS today,
            date_trunc('month', CURRENT_DATE)::date::text AS "monthStart",
            (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date::text AS "monthEnd"`,
  );
  const { today, monthStart, monthEnd } = rows[0];
  return range === 'today' ? { from: today, to: today } : { from: monthStart, to: monthEnd };
}

async function getInvoiceAmount(companyId: string, period: Period): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(it.calculated_total), 0) AS total
       FROM invoices i
       JOIN invoice_items it ON it.invoice_id = i.id
      WHERE i.company_id = $1 AND i.status != 'cancelled' AND i.invoice_date BETWEEN $2 AND $3`,
    [companyId, period.from, period.to],
  );
  return roundMoney(new Decimal(rows[0].total));
}

async function getPaymentsReceived(companyId: string, period: Period): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments WHERE company_id = $1 AND date BETWEEN $2 AND $3`,
    [companyId, period.from, period.to],
  );
  return roundMoney(new Decimal(rows[0].total));
}

/** Sum of positive customer balances only — a customer in credit doesn't reduce what others owe. */
async function getTotalReceivable(companyId: string): Promise<string> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) AS total
       FROM (
         SELECT SUM(debit) - SUM(credit) AS balance
           FROM ledger_entries WHERE company_id = $1 GROUP BY customer_id
       ) t`,
    [companyId],
  );
  return roundMoney(new Decimal(rows[0].total));
}

/**
 * Counts invoices that are still (fully or partially) unpaid, applying
 * payments/credits FIFO against the oldest debt first — the standard AR
 * aging rule. Concretely: per customer, walk every debit ledger entry
 * (opening balance, invoices, debit adjustments) newest-first, summing
 * as we go; entries reached before that running sum hits the customer's
 * current balance are the ones still (at least partly) unpaid. Among
 * those, only INVOICE-type entries are counted here — an unpaid opening
 * balance isn't an "invoice". One SQL query, no N+1 per-customer loop.
 */
async function getUnpaidOrPartialInvoiceCount(companyId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `WITH balances AS (
       SELECT customer_id, SUM(debit) - SUM(credit) AS current_balance
         FROM ledger_entries WHERE company_id = $1 GROUP BY customer_id
     ),
     ordered AS (
       SELECT
         le.customer_id,
         le.type,
         SUM(le.debit) OVER (
           PARTITION BY le.customer_id
           ORDER BY le.created_at DESC, le.id DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS cumulative_before
       FROM ledger_entries le
       WHERE le.company_id = $1 AND le.debit > 0
     )
     SELECT COUNT(*) AS count
       FROM ordered o
       JOIN balances b ON b.customer_id = o.customer_id
      WHERE o.type = 'INVOICE'
        AND b.current_balance > 0
        AND COALESCE(o.cumulative_before, 0) < b.current_balance`,
    [companyId],
  );
  return Number(rows[0].count);
}

async function getRecentInvoices(companyId: string, period: Period): Promise<DashboardRecentInvoice[]> {
  const { rows } = await pool.query<DashboardRecentInvoice>(
    `SELECT i.id, i.invoice_number AS "invoiceNumber", c.name AS "customerName",
            i.invoice_date AS "invoiceDate", i.status,
            COALESCE((SELECT SUM(it.calculated_total) FROM invoice_items it WHERE it.invoice_id = i.id), 0) AS "totalAmount"
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
      WHERE i.company_id = $1 AND i.invoice_date BETWEEN $2 AND $3
      ORDER BY i.created_at DESC
      LIMIT ${RECENT_LIMIT}`,
    [companyId, period.from, period.to],
  );
  return rows;
}

async function getRecentPayments(companyId: string, period: Period): Promise<DashboardRecentPayment[]> {
  const { rows } = await pool.query<DashboardRecentPayment>(
    `SELECT p.id, c.name AS "customerName", p.amount, p.date, p.payment_method AS "paymentMethod"
       FROM payments p
       JOIN customers c ON c.id = p.customer_id
      WHERE p.company_id = $1 AND p.date BETWEEN $2 AND $3
      ORDER BY p.created_at DESC
      LIMIT ${RECENT_LIMIT}`,
    [companyId, period.from, period.to],
  );
  return rows;
}

/** Current outstanding balance per customer — not period-bound, same reasoning as totalReceivable. */
async function getOutstandingCustomers(companyId: string): Promise<DashboardOutstandingCustomer[]> {
  const { rows } = await pool.query<DashboardOutstandingCustomer>(
    `SELECT c.id, c.name, bal.balance
       FROM customers c
       JOIN (
         SELECT customer_id, SUM(debit) - SUM(credit) AS balance
           FROM ledger_entries WHERE company_id = $1 GROUP BY customer_id
       ) bal ON bal.customer_id = c.id
      WHERE c.company_id = $1 AND bal.balance > 0
      ORDER BY bal.balance DESC
      LIMIT ${OUTSTANDING_LIMIT}`,
    [companyId],
  );
  return rows;
}

export async function getDashboard(
  companyId: string,
  range: DashboardRange,
  from?: string,
  to?: string,
): Promise<DashboardSummary> {
  const period = await resolvePeriod(range, from, to);

  const [invoiceAmount, paymentsReceived, totalReceivable, unpaidOrPartialInvoiceCount, recentInvoices, recentPayments, customersWithOutstandingBalance] =
    await Promise.all([
      getInvoiceAmount(companyId, period),
      getPaymentsReceived(companyId, period),
      getTotalReceivable(companyId),
      getUnpaidOrPartialInvoiceCount(companyId),
      getRecentInvoices(companyId, period),
      getRecentPayments(companyId, period),
      getOutstandingCustomers(companyId),
    ]);

  return {
    period: { range, from: period.from, to: period.to },
    cards: { invoiceAmount, paymentsReceived, totalReceivable, unpaidOrPartialInvoiceCount },
    recentInvoices,
    recentPayments,
    customersWithOutstandingBalance,
  };
}
