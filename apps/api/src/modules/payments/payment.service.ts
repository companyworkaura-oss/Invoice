import { pool, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';
import { postAuditLog } from '../audit/audit.service.js';
import { postLedgerEntry, requireCustomer } from '../ledger/ledger.service.js';

export type PaymentMethod = 'cash' | 'bank' | 'cheque' | 'other';

export interface Payment {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  amount: string;
  date: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PaymentInput {
  customerId: string;
  amount: string;
  date?: string;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface PaymentListFilter {
  customerId?: string;
}

const COLUMNS = `
  p.id, p.company_id AS "companyId", p.customer_id AS "customerId", c.name AS "customerName",
  p.amount, p.date, p.payment_method AS "paymentMethod", p.reference, p.notes,
  p.created_at AS "createdAt"
`;

function ledgerNote(paymentMethod: PaymentMethod, reference: string | undefined | null): string {
  return reference ? `Payment (${paymentMethod}, ref ${reference})` : `Payment (${paymentMethod})`;
}

/**
 * Creates a payment and its ledger credit entry in one transaction —
 * both commit together or neither does. This is the only way a PAYMENT
 * ledger entry is ever created; there is no separate "post a payment
 * credit" path that could leave a ledger entry with no payment record
 * behind it, or vice versa.
 */
export async function createPayment(companyId: string, userId: string, input: PaymentInput): Promise<Payment> {
  return withTransaction(async (client) => {
    await requireCustomer(client, companyId, input.customerId);

    const { rows } = await client.query<Omit<Payment, 'customerName'>>(
      `INSERT INTO payments (company_id, customer_id, amount, date, payment_method, reference, notes)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7)
       RETURNING id, company_id AS "companyId", customer_id AS "customerId",
                 amount, date, payment_method AS "paymentMethod", reference, notes,
                 created_at AS "createdAt"`,
      [companyId, input.customerId, input.amount, input.date ?? null, input.paymentMethod, input.reference ?? null, input.notes ?? null],
    );
    const payment = rows[0];

    // Same transaction as the insert above — see the doc comment.
    await postLedgerEntry(client, {
      companyId,
      customerId: input.customerId,
      type: 'PAYMENT',
      referenceId: payment.id,
      credit: payment.amount,
      date: payment.date,
      notes: ledgerNote(payment.paymentMethod, payment.reference),
    });

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'PAYMENT_CREATED',
      entityType: 'payment',
      entityId: payment.id,
      metadata: { customerId: input.customerId, amount: payment.amount, paymentMethod: payment.paymentMethod },
    });

    const customerRes = await client.query<{ name: string }>('SELECT name FROM customers WHERE id = $1', [
      input.customerId,
    ]);
    return { ...payment, customerName: customerRes.rows[0].name };
  });
}

export async function listPayments(companyId: string, filter: PaymentListFilter): Promise<Payment[]> {
  const conditions = ['p.company_id = $1'];
  const params: unknown[] = [companyId];
  if (filter.customerId) {
    params.push(filter.customerId);
    conditions.push(`p.customer_id = $${params.length}`);
  }

  const { rows } = await pool.query<Payment>(
    `SELECT ${COLUMNS} FROM payments p JOIN customers c ON c.id = p.customer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

export async function getPayment(companyId: string, paymentId: string): Promise<Payment> {
  const { rows } = await pool.query<Payment>(
    `SELECT ${COLUMNS} FROM payments p JOIN customers c ON c.id = p.customer_id
      WHERE p.id = $1 AND p.company_id = $2`,
    [paymentId, companyId],
  );
  if (!rows[0]) throw notFound('Payment not found');
  return rows[0];
}

/**
 * Permanently deletes a payment and reverses its accounting effect —
 * never just the payment row by itself. Unlike an invoice (which a
 * payment can be "applied to" only implicitly, via FIFO order over the
 * customer's whole ledger — see invoice.service.ts's listInvoices),
 * there is no invoice_id on a payment and nothing else references it,
 * so there's no separate "is this payment linked to something that
 * would be orphaned" check the way deleteInvoice has for a paid
 * invoice: removing this payment's own ledger credit is the entire
 * reversal, and it's enough on its own.
 *
 * Both deletes happen in one transaction:
 *  - the payment's own PAYMENT-type ledger credit (and only that entry
 *    — scoped by type='PAYMENT' AND reference_id, so an INVOICE or
 *    ADJUSTMENT row is never touched even by accident);
 *  - the payment row itself.
 *
 * Nothing else needs to change to make this correct: every invoice's
 * paid/balance/paymentStatus (Phase 15's FIFO allocation) and every
 * customer's balance (Phase 8) are always computed live from
 * ledger_entries on read, never stored — so the instant this payment's
 * credit is gone, every invoice and statement that was affected by it
 * recalculates correctly on its very next read, with no separate
 * "recompute invoice status" step required here.
 *
 * This app has no locked/closed accounting period concept (no such
 * column or feature exists anywhere in this schema) — the only gates
 * are the tenant-isolation check below and the permission the route
 * requires; there is nothing else to block on.
 */
export async function deletePayment(companyId: string, userId: string, paymentId: string): Promise<void> {
  await withTransaction(async (client) => {
    // FOR UPDATE serializes a doubled click / concurrent delete against
    // the same payment, and doubles as the tenant-isolation + existence
    // check (a foreign or missing paymentId is a 404, not a silent no-op).
    const { rows } = await client.query<{
      customerId: string;
      amount: string;
      date: string;
      paymentMethod: PaymentMethod;
      reference: string | null;
      notes: string | null;
    }>(
      `SELECT customer_id AS "customerId", amount, date, payment_method AS "paymentMethod", reference, notes
         FROM payments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [paymentId, companyId],
    );
    const payment = rows[0];
    if (!payment) throw notFound('Payment not found');

    await client.query(`DELETE FROM ledger_entries WHERE company_id = $1 AND reference_id = $2 AND type = 'PAYMENT'`, [
      companyId,
      paymentId,
    ]);
    await client.query('DELETE FROM payments WHERE id = $1 AND company_id = $2', [paymentId, companyId]);

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'PAYMENT_DELETED',
      entityType: 'payment',
      entityId: paymentId,
      metadata: {
        customerId: payment.customerId,
        amount: payment.amount,
        date: payment.date,
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        notes: payment.notes,
      },
    });
  });
}
