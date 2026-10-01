import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, forbidden } from '../../lib/http-error.js';
import type { Role } from '../../middleware/auth.js';

// Lightweight shape for cross-company listing/switching — the full profile
// (logo, address, invoice settings, ...) is only fetched for the active
// tenant via GET /api/company.
export interface CompanyMembership {
  id: string;
  name: string;
  defaultCurrency: string;
  role: Role;
}

/** listMyCompanies also needs status (to show/offer-reactivate a deactivated company) — the active-tenant shapes above don't, since a session can never be pointing at a deactivated one. */
export interface CompanyMembershipWithStatus extends CompanyMembership {
  status: 'active' | 'deactivated';
  deactivatedAt: string | null;
}

const COLUMNS = 'c.id, c.name, c.default_currency AS "defaultCurrency", m.role';
const COLUMNS_WITH_STATUS = `${COLUMNS}, c.status, c.deactivated_at AS "deactivatedAt"`;

/** Every company the user belongs to, with their role in each — active and deactivated alike, so the switcher can still offer "Reactivate" on one it's hiding from the normal switch list. */
export async function listMyCompanies(userId: string): Promise<CompanyMembershipWithStatus[]> {
  const { rows } = await pool.query<CompanyMembershipWithStatus>(
    `SELECT ${COLUMNS_WITH_STATUS}
       FROM company_members m
       JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = $1
      ORDER BY m.created_at`,
    [userId],
  );
  return rows;
}

/**
 * Creates a new company owned by the user and makes it that session's
 * active tenant. A user can own or join any number of companies.
 */
export async function createCompany(
  userId: string,
  sessionId: string,
  name: string,
): Promise<CompanyMembership> {
  return withTransaction(async (client) => {
    const company = await client.query<Omit<CompanyMembership, 'role'>>(
      'INSERT INTO companies (name) VALUES ($1) RETURNING id, name, default_currency AS "defaultCurrency"',
      [name],
    );
    const companyId = company.rows[0].id;
    await client.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      companyId,
      userId,
    ]);
    await setActiveCompany(client, sessionId, userId, companyId);
    return { ...company.rows[0], role: 'owner' as Role };
  });
}

/**
 * Switches the session's active tenant. Membership is re-checked against
 * company_members here — the requested companyId is never trusted on its
 * own, only as a lookup key for a membership the database confirms.
 */
export async function switchCompany(
  userId: string,
  sessionId: string,
  companyId: string,
): Promise<CompanyMembership> {
  const { rows } = await pool.query<CompanyMembershipWithStatus>(
    `SELECT ${COLUMNS_WITH_STATUS}
       FROM company_members m
       JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = $1 AND m.company_id = $2`,
    [userId, companyId],
  );
  if (!rows[0]) throw forbidden('Not a member of this company');
  if (rows[0].status === 'deactivated') {
    throw badRequest('Validation failed', { company: 'This company is deactivated. Reactivate it first.' });
  }
  await setActiveCompany(pool, sessionId, userId, companyId);
  const { status: _status, deactivatedAt: _deactivatedAt, ...membership } = rows[0];
  return membership;
}

async function setActiveCompany(
  q: { query: typeof pool.query },
  sessionId: string,
  userId: string,
  companyId: string,
): Promise<void> {
  await q.query('UPDATE sessions SET company_id = $1 WHERE id = $2 AND user_id = $3', [
    companyId,
    sessionId,
    userId,
  ]);
}
