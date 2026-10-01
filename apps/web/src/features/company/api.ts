import type { CompanyProfile } from '@invoice/shared';
import { api } from '../../lib/api';

export const fetchProfile = () => api<CompanyProfile>('/company');

export type ProfilePatch = Partial<
  Omit<CompanyProfile, 'id' | 'logoUrl'>
>;

export const updateProfile = (patch: ProfilePatch) => api<CompanyProfile>('/company', {
  method: 'PATCH',
  body: JSON.stringify(patch),
});

export const uploadLogo = (file: File) => {
  const form = new FormData();
  form.append('logo', file);
  return api<CompanyProfile>('/company/logo', { method: 'POST', body: form });
};

export interface LifecycleResult {
  newActiveCompanyId: string | null;
}

/** Deactivates the session's own active company — see apps/api's company-lifecycle.service.ts for what this preserves. */
export const deactivateCompany = () => api<LifecycleResult>('/company/deactivate', { method: 'PATCH' });

/** Permanently deletes the session's own active company; `confirmName` must match the company's name exactly. */
export const deleteCompanyPermanently = (confirmName: string) =>
  api<LifecycleResult>('/company', { method: 'DELETE', body: JSON.stringify({ confirmName }) });
