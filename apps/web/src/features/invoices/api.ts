import type { InvoiceListEntry, InvoiceStatus, InvoiceWithItems } from '@invoice/shared';
import { api } from '../../lib/api';

export interface InvoiceItemInput {
  categoryId: string;
  description?: string;
  stitches: number;
  /** Overrides the category's default rate for this item, if given. */
  rate?: string;
}

export interface InvoiceInput {
  customerId: string;
  invoiceDate?: string;
  quantity: string;
  notes?: string;
  status?: InvoiceStatus;
  items: InvoiceItemInput[];
}

export interface ListParams {
  status?: string;
  customerId?: string;
}

export function listInvoices(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  const qs = query.toString();
  return api<InvoiceListEntry[]>(`/invoices${qs ? `?${qs}` : ''}`);
}

export const getInvoice = (id: string) => api<InvoiceWithItems>(`/invoices/${id}`);

// The server calculates every amount via the formula engine; nothing
// here ever sends a calculated amount — there is nothing to send.
export const createInvoice = (input: InvoiceInput) => api<InvoiceWithItems>('/invoices', {
  method: 'POST',
  body: JSON.stringify(input),
});
