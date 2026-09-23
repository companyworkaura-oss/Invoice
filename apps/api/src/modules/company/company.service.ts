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

export interface CompanyProfilePatch {
  name?: string;
  defaultCurrency?: string;
  factoryName?: string;
  ownerName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  invoicePrefix?: string;
  defaultInvoiceTemplate?: string;
  invoiceTerms?: string;
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

/**
 * Updates the company profile and, if anything was actually provided in
 * the patch, logs one COMPANY_SETTINGS_CHANGED entry naming which
 * fields changed (not their old/new values — several are free text, so
 * "what changed" is the useful audit fact here, not a full diff). Both
 * writes share one transaction, same as every other audited write.
 */
export async function updateCompany(companyId: string, userId: string, patch: CompanyProfilePatch): Promise<Company> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Company>(
      `UPDATE companies
          SET name = COALESCE($2, name),
              default_currency = COALESCE($3, default_currency),
              factory_name = COALESCE($4, factory_name),
              owner_name = COALESCE($5, owner_name),
              phone = COALESCE($6, phone),
              whatsapp = COALESCE($7, whatsapp),
              email = COALESCE($8, email),
              address = COALESCE($9, address),
              tax_number = COALESCE($10, tax_number),
              invoice_prefix = COALESCE($11, invoice_prefix),
              default_invoice_template = COALESCE($12, default_invoice_template),
              invoice_terms = COALESCE($13, invoice_terms),
              updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [
        companyId,
        patch.name ?? null,
        patch.defaultCurrency ?? null,
        patch.factoryName ?? null,
        patch.ownerName ?? null,
        patch.phone ?? null,
        patch.whatsapp ?? null,
        patch.email ?? null,
        patch.address ?? null,
        patch.taxNumber ?? null,
        patch.invoicePrefix ?? null,
        patch.defaultInvoiceTemplate ?? null,
        patch.invoiceTerms ?? null,
      ],
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
