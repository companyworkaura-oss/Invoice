import type { Customer, CustomerStatus } from '@invoice/shared';
import { api } from '../../lib/api';

export interface CustomerInput {
  name: string;
  businessName?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
  openingBalance?: string;
  notes?: string;
}

export type CustomerPatch = Partial<CustomerInput>;

export interface ListParams {
  search?: string;
  status?: CustomerStatus | 'all';
}

export function listCustomers(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);
  const qs = query.toString();
  return api<Customer[]>(`/customers${qs ? `?${qs}` : ''}`);
}

export const getCustomer = (id: string) => api<Customer>(`/customers/${id}`);

export const createCustomer = (input: CustomerInput) => api<Customer>('/customers', {
  method: 'POST',
  body: JSON.stringify(input),
});

export const updateCustomer = (id: string, patch: CustomerPatch) => api<Customer>(`/customers/${id}`, {
  method: 'PATCH',
  body: JSON.stringify(patch),
});

export const archiveCustomer = (id: string) => api<Customer>(`/customers/${id}/archive`, { method: 'POST' });
