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
