import { pool, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';
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

export interface CustomerPatch {
  name?: string;
  businessName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  // No openingBalance here: once a customer exists, its opening balance
  // is fixed (it already seeded a ledger entry). A later correction is
  // its own ADJUSTMENT entry, posted through the ledger, not a silent
  // edit to this column — see modules/ledger.
  notes?: string;
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

export async function updateCustomer(companyId: string, customerId: string, patch: CustomerPatch): Promise<Customer> {
  const { rows } = await pool.query<Customer>(
    `UPDATE customers
        SET name = COALESCE($3, name),
            business_name = COALESCE($4, business_name),
            phone = COALESCE($5, phone),
            whatsapp = COALESCE($6, whatsapp),
            address = COALESCE($7, address),
            notes = COALESCE($8, notes),
            updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING ${COLUMNS}`,
    [
      customerId,
      companyId,
      patch.name ?? null,
      patch.businessName ?? null,
      patch.phone ?? null,
      patch.whatsapp ?? null,
      patch.address ?? null,
      patch.notes ?? null,
    ],
  );
  if (!rows[0]) throw notFound('Customer not found');
  return rows[0];
}

export async function archiveCustomer(companyId: string, customerId: string): Promise<Customer> {
  const { rows } = await pool.query<Customer>(
    `UPDATE customers SET status = 'archived', updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING ${COLUMNS}`,
    [customerId, companyId],
  );
  if (!rows[0]) throw notFound('Customer not found');
  return rows[0];
}
