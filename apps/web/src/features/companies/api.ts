import type { Company, Role } from '@invoice/shared';
import { api } from '../../lib/api';

export interface CompanyMembership extends Company {
  role: Role;
}

export const listCompanies = () => api<CompanyMembership[]>('/companies');

export const createCompany = (name: string) => api<CompanyMembership>('/companies', {
  method: 'POST',
  body: JSON.stringify({ name }),
});

export const switchCompany = (companyId: string) => api<CompanyMembership>(`/companies/${companyId}/switch`, {
  method: 'POST',
});
