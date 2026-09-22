import type { EmbroideryCategory } from '@invoice/shared';
import { api } from '../../lib/api';

export interface CategoryInput {
  name: string;
  description?: string;
  defaultRate?: string;
  formulaType?: string;
  formulaConfig?: Record<string, unknown>;
}

export type CategoryPatch = Partial<CategoryInput>;

export type StatusFilter = 'active' | 'disabled' | 'all';

export function listCategories(status: StatusFilter = 'active') {
  return api<EmbroideryCategory[]>(`/categories?status=${status}`);
}

export const createCategory = (input: CategoryInput) => api<EmbroideryCategory>('/categories', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const updateCategory = (id: string, patch: CategoryPatch) => api<EmbroideryCategory>(`/categories/${id}`, {
  method: 'PATCH',
  body: JSON.stringify(patch),
});

export const disableCategory = (id: string) => api<EmbroideryCategory>(`/categories/${id}/disable`, { method: 'POST' });
export const enableCategory = (id: string) => api<EmbroideryCategory>(`/categories/${id}/enable`, { method: 'POST' });
