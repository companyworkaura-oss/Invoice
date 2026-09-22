/**
 * Shared entity shapes used across apps/api and apps/web.
 * Business modules (customers, formulas, invoices, ...) add their own
 * types here as those phases are implemented — this file intentionally
 * only carries what Phase 1 (auth + company) already exposes.
 */

/** Money is always a decimal string (e.g. "1234.50"), never a float. */
export type Money = string;

export type Role = 'owner' | 'admin' | 'staff';

export interface Company {
  id: string;
  name: string;
  currencyCode: string;
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  company: Company;
}
