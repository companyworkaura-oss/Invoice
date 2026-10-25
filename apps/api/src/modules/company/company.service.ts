import { pool, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/http-error.js';
import { postAuditLog } from '../audit/audit.service.js';

export interface Company {
  id: string;
  name: string;
  defaultCurrency: string;
  factoryName: string | null;
  ownerName: string | null;
  logoUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  invoicePrefix: string;
  defaultInvoiceTemplate: string;
  invoiceTerms: string | null;
}

/**
 * F08: every nullable-column field below is `string | null`, not just
 * `string` — `undefined` (the key omitted entirely) means "leave
 * unchanged", while `null` is the explicit "clear this field" signal,
 * and the two must never be collapsed into each other (see
 * updateCompany). name/defaultCurrency/invoicePrefix/
 * defaultInvoiceTemplate stay plain `string` — their columns are
 * NOT NULL, so there is no "clear" state for them to begin with.
 */
export interface CompanyProfilePatch {
  name?: string;
  defaultCurrency?: string;
  factoryName?: string | null;
  ownerName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  invoicePrefix?: string;
  defaultInvoiceTemplate?: string;
  invoiceTerms?: string | null;
}

const COLUMNS = `
  id, name,
  default_currency AS "defaultCurrency",
  factory_name AS "factoryName",
  owner_name AS "ownerName",
  logo_url AS "logoUrl",
  phone, whatsapp, email, address,
  tax_number AS "taxNumber",
  invoice_prefix AS "invoicePrefix",
  default_invoice_template AS "defaultInvoiceTemplate",
  invoice_terms AS "invoiceTerms"
`;

export async function getCompany(companyId: string): Promise<Company> {
  const { rows } = await pool.query<Company>(`SELECT ${COLUMNS} FROM companies WHERE id = $1`, [companyId]);
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}

/** `column, patchKey` pairs in the exact order updateCompany's columns were always listed in. */
const PATCH_COLUMNS: readonly [string, keyof CompanyProfilePatch][] = [
  ['name', 'name'],
  ['default_currency', 'defaultCurrency'],
  ['factory_name', 'factoryName'],
  ['owner_name', 'ownerName'],
  ['phone', 'phone'],
  ['whatsapp', 'whatsapp'],
  ['email', 'email'],
  ['address', 'address'],
  ['tax_number', 'taxNumber'],
  ['invoice_prefix', 'invoicePrefix'],
  ['default_invoice_template', 'defaultInvoiceTemplate'],
  ['invoice_terms', 'invoiceTerms'],
];

/**
 * Updates the company profile and, if anything was actually provided in
 * the patch, logs one COMPANY_SETTINGS_CHANGED entry naming which
 * fields changed (not their old/new values — several are free text, so
 * "what changed" is the useful audit fact here, not a full diff). Both
 * writes share one transaction, same as every other audited write.
 *
 * F08: `COALESCE($N, column)` can't tell "omitted" apart from
 * "explicitly cleared" — both arrive as a SQL NULL parameter, so
 * COALESCE always falls back to the existing value and a field could
 * never actually be cleared at all. Only a key *present* in `patch` is
 * included in the UPDATE at all (built dynamically below); its value —
 * a string, or `null` for an explicit clear — is then assigned
 * directly, never COALESCE'd. A key missing from `patch` entirely
 * (`undefined`) is left out of the SET clause, so that column is
 * untouched, exactly as if this were a single-column UPDATE.
 */
export async function updateCompany(companyId: string, userId: string, patch: CompanyProfilePatch): Promise<Company> {
  return withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [companyId];
    for (const [column, key] of PATCH_COLUMNS) {
      const value = patch[key];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    sets.push('updated_at = now()');

    const { rows } = await client.query<Company>(
      `UPDATE companies SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    );
    if (!rows[0]) throw notFound('Company not found');

    const changedFields = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (changedFields.length > 0) {
      await postAuditLog(client, {
        companyId,
        userId,
        action: 'COMPANY_SETTINGS_CHANGED',
        entityType: 'company',
        entityId: companyId,
        metadata: { changedFields },
      });
    }

    return rows[0];
  });
}

export async function getLogoUrl(companyId: string): Promise<string | null> {
  const { rows } = await pool.query<{ logoUrl: string | null }>(
    'SELECT logo_url AS "logoUrl" FROM companies WHERE id = $1',
    [companyId],
  );
  if (!rows[0]) throw notFound('Company not found');
  return rows[0].logoUrl;
}

export async function setLogoUrl(companyId: string, logoUrl: string | null): Promise<Company> {
  const { rows } = await pool.query<Company>(
    `UPDATE companies SET logo_url = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [companyId, logoUrl],
  );
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}
