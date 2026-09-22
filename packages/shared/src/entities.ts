/**
 * Shared entity shapes used across apps/api and apps/web.
 * Business modules (customers, formulas, invoices, ...) add their own
 * types here as those phases are implemented.
 */

/** Money is always a decimal string (e.g. "1234.50"), never a float. */
export type Money = string;

export type Role = 'owner' | 'admin' | 'staff';

/** Minimal company identity, as returned by GET /api/auth/me and GET/POST /api/companies. */
export interface Company {
  id: string;
  name: string;
  defaultCurrency: string;
}

/**
 * Full company profile (Phase 3), returned by GET /api/company. Fields
 * are pre-filled from here onto future invoices.
 */
export interface CompanyProfile extends Company {
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

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  company: Company;
}

export type CustomerStatus = 'active' | 'archived';

/** Returned by the customers endpoints (Phase 4). */
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  openingBalance: Money;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
}

/**
 * A company-defined embroidery work category (Phase 5): the examples in
 * the product brief (HS/HP, Daman Lace, Motia, ...) are just that —
 * examples. Nothing in the app hard-codes them; every company creates
 * its own. formulaType is a free-form label the application interprets;
 * formulaConfig's shape depends on it. New formula types are added in
 * code, never by changing this type or the database schema.
 */
export interface EmbroideryCategory {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  defaultRate: Money;
  formulaType: string;
  formulaConfig: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}
