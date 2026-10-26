import { pool, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';
import { postAuditLog } from '../audit/audit.service.js';
import { postLedgerEntry } from '../ledger/ledger.service.js';

export type CustomerStatus = 'active' | 'archived';

export interface Customer {
  id: string;
  companyId: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  /** Decimal string, e.g. "1234.50" — never a float. */
  openingBalance: string;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
}

export interface CustomerInput {
  name: string;
  businessName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  openingBalance?: string;
  notes?: string;
}

/**
 * F12: `name` is NOT NULL (with a non-blank CHECK) — there is no
 * "clear" state for it, so it stays a plain optional string, same as
 * company.service.ts's name/defaultCurrency/invoicePrefix/
 * defaultInvoiceTemplate. Every other field here is a nullable
 * column, so each is `string | null`: omitted (`undefined`, the key
 * missing from the patch) leaves it unchanged, `null` explicitly
 * clears it, a non-blank string sets it — see updateCustomer.
 */
export interface CustomerPatch {
  name?: string;
  businessName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  // No openingBalance here: once a customer exists, its opening balance
  // is fixed (it already seeded a ledger entry). A later correction is
  // its own ADJUSTMENT entry, posted through the ledger, not a silent
  // edit to this column — see modules/ledger.
  notes?: string | null;
}

export interface ListFilter {
  search?: string;
  status: 'active' | 'archived' | 'all';
}

const COLUMNS = `
  id, company_id AS "companyId", name,
  business_name AS "businessName",
  phone, whatsapp, address,
  opening_balance AS "openingBalance",
  notes, status,
  created_at AS "createdAt"
`;

// Every query here takes companyId from the caller's session (see the
// routes file), never from the request body or URL — that is the tenant
// isolation boundary for this whole module.

export async function createCustomer(companyId: string, input: CustomerInput): Promise<Customer> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Customer>(
      `INSERT INTO customers (company_id, name, business_name, phone, whatsapp, address, opening_balance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::numeric, 0), $8)
       RETURNING ${COLUMNS}`,
      [
        companyId,
        input.name,
        input.businessName ?? null,
        input.phone ?? null,
        input.whatsapp ?? null,
        input.address ?? null,
        input.openingBalance ?? null,
        input.notes ?? null,
      ],
    );
    const customer = rows[0];

    // Seed the ledger so the customer's balance is derivable from ledger
    // rows alone from day one — opening_balance above is just the input
    // that produced this entry, never read again as the source of truth.
    if (Number(customer.openingBalance) > 0) {
      await postLedgerEntry(client, {
        companyId,
        customerId: customer.id,
        type: 'OPENING_BALANCE',
        debit: customer.openingBalance,
        notes: 'Opening balance',
      });
    }

    return customer;
  });
}

export async function listCustomers(companyId: string, filter: ListFilter): Promise<Customer[]> {
  const conditions = ['company_id = $1'];
  const params: unknown[] = [companyId];

  if (filter.status !== 'all') {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    conditions.push(`(name ILIKE $${params.length} OR business_name ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }

  const { rows } = await pool.query<Customer>(
    `SELECT ${COLUMNS} FROM customers WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return rows;
}

export async function getCustomer(companyId: string, customerId: string): Promise<Customer> {
  const { rows } = await pool.query<Customer>(`SELECT ${COLUMNS} FROM customers WHERE id = $1 AND company_id = $2`, [
    customerId,
    companyId,
  ]);
  if (!rows[0]) throw notFound('Customer not found');
  return rows[0];
}

/** `column, patchKey` pairs — same shape/order updateCustomer's columns were always listed in. */
const PATCH_COLUMNS: readonly [string, keyof CustomerPatch][] = [
  ['name', 'name'],
  ['business_name', 'businessName'],
  ['phone', 'phone'],
  ['whatsapp', 'whatsapp'],
  ['address', 'address'],
  ['notes', 'notes'],
];

/**
 * F12: `COALESCE($N, column)` can't tell "omitted" apart from
 * "explicitly cleared" — both arrive as a SQL NULL parameter, so
 * COALESCE always falls back to the existing value and a field could
 * never actually be cleared (see company.service.ts's updateCompany,
 * fixed the same way for F08). Only a key *present* in `patch` is
 * included in the UPDATE at all (built dynamically below); its value
 * — a string, or `null` for an explicit clear — is then assigned
 * directly, never COALESCE'd. A key missing from `patch` entirely
 * (`undefined`) is left out of the SET clause, so that column is
 * untouched, exactly as if this were a single-column UPDATE.
 */
export async function updateCustomer(companyId: string, customerId: string, patch: CustomerPatch): Promise<Customer> {
  const sets: string[] = [];
  const params: unknown[] = [customerId, companyId];
  for (const [column, key] of PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  sets.push('updated_at = now()');

  const { rows } = await pool.query<Customer>(
    `UPDATE customers SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2 RETURNING ${COLUMNS}`,
    params,
  );
  if (!rows[0]) throw notFound('Customer not found');
  return rows[0];
}

/**
 * Archive/unarchive are visibility/lifecycle only — they flip
 * `customers.status` and nothing else. Invoices, ledger entries,
 * payments, and opening_balance never change here; the customer row
 * itself is never duplicated or replaced, just toggled and re-read —
 * so every historical record (statements, invoice snapshots, payment
 * history) stays exactly as it was, archived or not.
 */
export async function archiveCustomer(companyId: string, userId: string, customerId: string): Promise<Customer> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Customer>(
      `UPDATE customers SET status = 'archived', updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING ${COLUMNS}`,
      [customerId, companyId],
    );
    const customer = rows[0];
    if (!customer) throw notFound('Customer not found');

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'CUSTOMER_ARCHIVED',
      entityType: 'customer',
      entityId: customerId,
      metadata: { customerName: customer.name },
    });

    return customer;
  });
}

/** Restores an archived customer to the active list. Never touches invoices/ledger/payments/opening_balance — see archiveCustomer. */
export async function unarchiveCustomer(companyId: string, userId: string, customerId: string): Promise<Customer> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Customer>(
      `UPDATE customers SET status = 'active', updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING ${COLUMNS}`,
      [customerId, companyId],
    );
    const customer = rows[0];
    if (!customer) throw notFound('Customer not found');

    await postAuditLog(client, {
      companyId,
      userId,
      action: 'CUSTOMER_UNARCHIVED',
      entityType: 'customer',
      entityId: customerId,
      metadata: { customerName: customer.name },
    });

    return customer;
  });
}
