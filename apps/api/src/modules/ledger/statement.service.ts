import { Decimal, roundMoney } from '@invoice/shared';
import { pool } from '../../db/pool.js';
import { getCustomer } from '../customers/customer.service.js';
import type { LedgerEntryType } from './ledger.service.js';

export interface StatementFilter {
  from?: string;
  to?: string;
  type?: LedgerEntryType;
}

export interface StatementEntry {
  id: string;
  date: string;
  type: LedgerEntryType;
  reference: string | null;
  description: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface CustomerStatement {
  customerId: string;
  customerName: string;
  from: string | null;
  to: string | null;
  openingBalance: string;
  invoiceTotal: string;
  payments: string;
  closingBalance: string;
  entries: StatementEntry[];
}

interface RawRow {
  id: string;
  type: LedgerEntryType;
  referenceId: string | null;
  debit: string;
  credit: string;
  date: string;
  notes: string | null;
  invoiceNumber: string | null;
  paymentReference: string | null;
  paymentMethod: string | null;
}

function resolveReference(row: RawRow): string | null {
  switch (row.type) {
    case 'INVOICE':
      return row.invoiceNumber;
    case 'PAYMENT':
      return row.paymentReference || (row.paymentMethod ? row.paymentMethod[0].toUpperCase() + row.paymentMethod.slice(1) : null);
    case 'OPENING_BALANCE':
      return 'Opening Balance';
    case 'ADJUSTMENT':
      return 'Adjustment';
  }
}

/**
 * Builds a customer statement straight from ledger_entries — the same
 * append-only table every balance in this app derives from. Unlike the
 * rest of the app (which orders the ledger by created_at, since that's
 * the true sequence writes actually happened in — see getBalanceBefore
 * in ledger.service.ts), a *statement* is a reporting document a
 * business owner reads chronologically by transaction date, so this
 * orders by `date` (with created_at only as a same-day tiebreak) and
 * computes its own running balance in that order. That's a deliberate,
 * statement-only choice — it never changes how balances are computed
 * anywhere else in the app.
 *
 * Entries dated before `from` aren't shown, but still fold into
 * `openingBalance`; entries dated after `to` are excluded entirely,
 * from both the row list and every summary figure. The `type` filter
 * only narrows which rows are returned — openingBalance/invoiceTotal/
 * payments/closingBalance always reflect the *whole* selected date
 * range, regardless of it.
 */
export async function getCustomerStatement(
  companyId: string,
  customerId: string,
  filter: StatementFilter,
): Promise<CustomerStatement> {
  const customer = await getCustomer(companyId, customerId);

  const { rows } = await pool.query<RawRow>(
    `SELECT le.id, le.type, le.reference_id AS "referenceId", le.debit, le.credit, le.date, le.notes,
            i.invoice_number AS "invoiceNumber",
            p.reference AS "paymentReference", p.payment_method AS "paymentMethod"
       FROM ledger_entries le
       LEFT JOIN invoices i ON le.type = 'INVOICE' AND i.id = le.reference_id
       LEFT JOIN payments p ON le.type = 'PAYMENT' AND p.id = le.reference_id
      WHERE le.company_id = $1 AND le.customer_id = $2
      ORDER BY le.date, le.created_at`,
    [companyId, customerId],
  );

  let opening = new Decimal(0);
  let running: Decimal | null = null;
  const inRange: StatementEntry[] = [];

  for (const row of rows) {
    const net = new Decimal(row.debit).minus(row.credit);
    if (filter.from && row.date < filter.from) {
      opening = opening.plus(net);
      continue;
    }
    if (filter.to && row.date > filter.to) {
      continue;
    }
    running = (running ?? opening).plus(net);
    inRange.push({
      id: row.id,
      date: row.date,
      type: row.type,
      reference: resolveReference(row),
      description: row.notes,
      debit: roundMoney(new Decimal(row.debit)),
      credit: roundMoney(new Decimal(row.credit)),
      runningBalance: roundMoney(running),
    });
  }

  const closingBalance = running ?? opening;
  const invoiceTotal = inRange
    .filter((e) => e.type === 'INVOICE')
    .reduce((sum, e) => sum.plus(e.debit), new Decimal(0));
  const payments = inRange
    .filter((e) => e.type === 'PAYMENT')
    .reduce((sum, e) => sum.plus(e.credit), new Decimal(0));

  const entries = filter.type ? inRange.filter((e) => e.type === filter.type) : inRange;

  return {
    customerId,
    customerName: customer.name,
    from: filter.from ?? null,
    to: filter.to ?? null,
    openingBalance: roundMoney(opening),
    invoiceTotal: roundMoney(invoiceTotal),
    payments: roundMoney(payments),
    closingBalance: roundMoney(closingBalance),
    entries,
  };
}
