import type { Company, CompanyStatus, Role } from '@invoice/shared';
import { api } from '../../lib/api';

export interface CompanyMembership extends Company {
  role: Role;
}

/** GET /companies returns status too (active and deactivated companies alike), so the switcher can still offer "Reactivate" on one it hides from the normal switch list. */
export interface CompanyMembershipWithStatus extends CompanyMembership {
  status: CompanyStatus;
  deactivatedAt: string | null;
}

export const listCompanies = () => api<CompanyMembershipWithStatus[]>('/companies');

export const createCompany = (name: string) => api<CompanyMembership>('/companies', {
  method: 'POST',
  body: JSON.stringify({ name }),
});

export const switchCompany = (companyId: string) => api<CompanyMembership>(`/companies/${companyId}/switch`, {
  method: 'POST',
});

export const reactivateCompany = (companyId: string) => api<CompanyMembershipWithStatus>(`/companies/${companyId}/reactivate`, {
  method: 'POST',
});
