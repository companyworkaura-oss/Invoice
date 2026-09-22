import { pool, withTransaction } from '../../db/pool.js';
import { forbidden } from '../../lib/http-error.js';
import type { Role } from '../../middleware/auth.js';
import type { Company } from './company.service.js';

export interface CompanyMembership extends Company {
  role: Role;
}

const COLUMNS = 'c.id, c.name, c.currency_code AS "currencyCode", m.role';

/** Every company the user belongs to, with their role in each. */
export async function listMyCompanies(userId: string): Promise<CompanyMembership[]> {
  const { rows } = await pool.query<CompanyMembership>(
    `SELECT ${COLUMNS}
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
    const company = await client.query<Company>(
      'INSERT INTO companies (name) VALUES ($1) RETURNING id, name, currency_code AS "currencyCode"',
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
  const { rows } = await pool.query<CompanyMembership>(
    `SELECT ${COLUMNS}
       FROM company_members m
       JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = $1 AND m.company_id = $2`,
    [userId, companyId],
  );
  if (!rows[0]) throw forbidden('Not a member of this company');
  await setActiveCompany(pool, sessionId, userId, companyId);
  return rows[0];
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
