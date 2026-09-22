import { pool } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';

export interface Company {
  id: string;
  name: string;
  currencyCode: string;
}

const COLUMNS = 'id, name, currency_code AS "currencyCode"';

export async function getCompany(companyId: string): Promise<Company> {
  const { rows } = await pool.query<Company>(`SELECT ${COLUMNS} FROM companies WHERE id = $1`, [companyId]);
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}

export async function updateCompany(
  companyId: string,
  patch: { name?: string; currencyCode?: string },
): Promise<Company> {
  const { rows } = await pool.query<Company>(
    `UPDATE companies
        SET name = COALESCE($2, name),
            currency_code = COALESCE($3, currency_code),
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [companyId, patch.name ?? null, patch.currencyCode ?? null],
  );
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}
