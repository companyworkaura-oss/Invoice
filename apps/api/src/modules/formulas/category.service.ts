import { pool } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';

export interface EmbroideryCategory {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  /** Decimal string, e.g. "12.50" — never a float. */
  defaultRate: string;
  /** Free-form label; the application decides how to interpret it (see formula_config). */
  formulaType: string;
  formulaConfig: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export interface CategoryInput {
  name: string;
  description?: string;
  defaultRate?: string;
  formulaType?: string;
  formulaConfig?: Record<string, unknown>;
}

export interface CategoryPatch {
  name?: string;
  description?: string;
  defaultRate?: string;
  formulaType?: string;
  formulaConfig?: Record<string, unknown>;
}

export interface ListFilter {
  status: 'active' | 'disabled' | 'all';
}

const COLUMNS = `
  id, company_id AS "companyId", name, description,
  default_rate AS "defaultRate",
  formula_type AS "formulaType",
  formula_config AS "formulaConfig",
  active,
  created_at AS "createdAt"
`;

// Every query is scoped by companyId from the caller's session — see the
// routes file — never from the request body or URL.

export async function createCategory(companyId: string, input: CategoryInput): Promise<EmbroideryCategory> {
  const { rows } = await pool.query<EmbroideryCategory>(
    `INSERT INTO embroidery_categories (company_id, name, description, default_rate, formula_type, formula_config)
     VALUES ($1, $2, $3, COALESCE($4::numeric, 0), COALESCE($5, 'fixed'), COALESCE($6, '{}')::jsonb)
     RETURNING ${COLUMNS}`,
    [
      companyId,
      input.name,
      input.description ?? null,
      input.defaultRate ?? null,
      input.formulaType ?? null,
      input.formulaConfig ? JSON.stringify(input.formulaConfig) : null,
    ],
  );
  return rows[0];
}

export async function listCategories(companyId: string, filter: ListFilter): Promise<EmbroideryCategory[]> {
  const conditions = ['company_id = $1'];
  const params: unknown[] = [companyId];

  if (filter.status !== 'all') {
    params.push(filter.status === 'active');
    conditions.push(`active = $${params.length}`);
  }

  const { rows } = await pool.query<EmbroideryCategory>(
    `SELECT ${COLUMNS} FROM embroidery_categories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return rows;
}

export async function getCategory(companyId: string, categoryId: string): Promise<EmbroideryCategory> {
  const { rows } = await pool.query<EmbroideryCategory>(
    `SELECT ${COLUMNS} FROM embroidery_categories WHERE id = $1 AND company_id = $2`,
    [categoryId, companyId],
  );
  if (!rows[0]) throw notFound('Category not found');
  return rows[0];
}

export async function updateCategory(
  companyId: string,
  categoryId: string,
  patch: CategoryPatch,
): Promise<EmbroideryCategory> {
  const { rows } = await pool.query<EmbroideryCategory>(
    `UPDATE embroidery_categories
        SET name = COALESCE($3, name),
            description = COALESCE($4, description),
            default_rate = COALESCE($5::numeric, default_rate),
            formula_type = COALESCE($6, formula_type),
            formula_config = COALESCE($7::jsonb, formula_config),
            updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING ${COLUMNS}`,
    [
      categoryId,
      companyId,
      patch.name ?? null,
      patch.description ?? null,
      patch.defaultRate ?? null,
      patch.formulaType ?? null,
      patch.formulaConfig ? JSON.stringify(patch.formulaConfig) : null,
    ],
  );
  if (!rows[0]) throw notFound('Category not found');
  return rows[0];
}

export async function setActive(companyId: string, categoryId: string, active: boolean): Promise<EmbroideryCategory> {
  const { rows } = await pool.query<EmbroideryCategory>(
    `UPDATE embroidery_categories SET active = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING ${COLUMNS}`,
    [categoryId, companyId, active],
  );
  if (!rows[0]) throw notFound('Category not found');
  return rows[0];
}
