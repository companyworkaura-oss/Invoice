import { pool, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';
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
export async function createPayment(companyId: string, input: PaymentInput): Promise<Payment> {
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
