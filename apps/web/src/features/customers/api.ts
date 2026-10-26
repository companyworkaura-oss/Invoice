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

/**
 * F12: `name` is never nullable (there's nothing to clear it to) and
 * stays a plain optional string. Every other field here is a nullable
 * column server-side (customer.service.ts), so each is
 * `string | null`: omitted (the key missing from the patch) leaves it
 * unchanged, `null` explicitly clears it, a non-blank string sets it.
 * `CustomerPatch` is intentionally not `Partial<CustomerInput>` —
 * that would make every field `string | undefined`, with no way to
 * express "clear this" at all.
 */
export interface CustomerPatch {
  name?: string;
  businessName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  notes?: string | null;
}

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

/** Restores an archived customer to the active list. Never touches invoices/ledger/payments. */
export const unarchiveCustomer = (id: string) => api<Customer>(`/customers/${id}/unarchive`, { method: 'POST' });
