import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { Decimal, roundMoney } from '@invoice/shared';

export type LedgerEntryType = 'OPENING_BALANCE' | 'INVOICE' | 'PAYMENT' | 'ADJUSTMENT';

export interface LedgerEntry {
  id: string;
  companyId: string;
  customerId: string;
  type: LedgerEntryType;
  referenceId: string | null;
  debit: string;
  credit: string;
  date: string;
  notes: string | null;
  createdAt: string;
}

// A pg Pool and a pg PoolClient (inside a transaction) share this shape.
type Queryable = Pick<typeof pool, 'query'>;

const COLUMNS = `
  id, company_id AS "companyId", customer_id AS "customerId", type,
  reference_id AS "referenceId", debit, credit, date, notes, created_at AS "createdAt"
`;

/**
 * Inserts one ledger row. This is the only way a row is ever written —
 * there is no update or delete for ledger_entries anywhere in this
 * module. Callers that post an entry as a side effect of something else
 * (an invoice, a payment) must pass the *same* transaction client they
 * used for that other write, so both commit or roll back together.
 */
export async function postLedgerEntry(
  client: Queryable,
  entry: {
    companyId: string;
    customerId: string;
    type: LedgerEntryType;
    referenceId?: string | null;
    debit?: string;
    credit?: string;
    date?: string;
    notes?: string | null;
  },
): Promise<LedgerEntry> {
  const { rows } = await client.query<LedgerEntry>(
    `INSERT INTO ledger_entries (company_id, customer_id, type, reference_id, debit, credit, date, notes)
     VALUES ($1, $2, $3, $4, COALESCE($5::numeric, 0), COALESCE($6::numeric, 0), COALESCE($7::date, CURRENT_DATE), $8)
     RETURNING ${COLUMNS}`,
    [
      entry.companyId,
      entry.customerId,
      entry.type,
      entry.referenceId ?? null,
      entry.debit ?? null,
      entry.credit ?? null,
      entry.date ?? null,
      entry.notes ?? null,
    ],
  );
  return rows[0];
}

export async function listLedgerEntries(companyId: string, customerId: string): Promise<LedgerEntry[]> {
  const { rows } = await pool.query<LedgerEntry>(
    `SELECT ${COLUMNS} FROM ledger_entries WHERE company_id = $1 AND customer_id = $2 ORDER BY created_at`,
    [companyId, customerId],
  );
  return rows;
}

/**
 * Entries + live balance for one customer. A customer with no ledger
 * activity yet has an empty ledger and a real zero balance; a customer
 * that doesn't belong to this company is a 404, not an empty result —
 * without this check, a foreign customerId would silently return an
 * empty ledger instead of failing, which is not the same thing as "not
 * found" and would be easy to mistake for "this customer owes nothing".
 */
export async function getCustomerLedger(
  companyId: string,
  customerId: string,
): Promise<{ entries: LedgerEntry[]; balance: string }> {
  await requireCustomer(pool, companyId, customerId);
  const [entries, balance] = await Promise.all([
    listLedgerEntries(companyId, customerId),
    getCustomerBalance(pool, companyId, customerId),
  ]);
  return { entries, balance };
}

/** Customer balance = total debit - total credit — generated from ledger rows, never stored. */
export async function getCustomerBalance(client: Queryable, companyId: string, customerId: string): Promise<string> {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS balance
       FROM ledger_entries WHERE company_id = $1 AND customer_id = $2`,
    [companyId, customerId],
  );
  return roundMoney(new Decimal(rows[0].balance));
}

/** The customer's balance immediately before a given ledger entry was posted (by creation order). */
export async function getBalanceBefore(
  client: Queryable,
  companyId: string,
  customerId: string,
  beforeCreatedAt: string,
): Promise<string> {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS balance
       FROM ledger_entries WHERE company_id = $1 AND customer_id = $2 AND created_at < $3`,
    [companyId, customerId, beforeCreatedAt],
  );
  return roundMoney(new Decimal(rows[0].balance));
}

/**
 * Confirms a customer belongs to this company, or throws 404. Exported
 * for other modules (payments) that need the same tenant-scoped
 * existence check before posting a ledger entry of their own.
 */
export async function requireCustomer(client: Queryable, companyId: string, customerId: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM customers WHERE id = $1 AND company_id = $2', [
    customerId,
    companyId,
  ]);
  if (!rows[0]) throw notFound('Customer not found');
}

/** Records a manual correction: exactly one of debit or credit, never both. */
export async function recordAdjustment(
  companyId: string,
  customerId: string,
  input: { debit?: string; credit?: string; date?: string; notes?: string },
): Promise<LedgerEntry> {
  const hasDebit = Boolean(input.debit) && Number(input.debit) > 0;
  const hasCredit = Boolean(input.credit) && Number(input.credit) > 0;
  if (hasDebit === hasCredit) {
    throw badRequest('Validation failed', { amount: 'Provide exactly one of debit or credit, greater than zero' });
  }

  return withTransaction(async (client) => {
    await requireCustomer(client, companyId, customerId);
    return postLedgerEntry(client, {
      companyId,
      customerId,
      type: 'ADJUSTMENT',
      debit: input.debit,
      credit: input.credit,
      date: input.date,
      notes: input.notes,
    });
  });
}
