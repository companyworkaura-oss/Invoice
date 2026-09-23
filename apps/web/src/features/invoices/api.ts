import type {
  InvoiceListEntry,
  InvoicePaymentStatus,
  InvoiceStatus,
  InvoiceWithItems,
  WhatsAppSharePayload,
} from '@invoice/shared';
import { ApiError, api } from '../../lib/api';

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
  from?: string;
  to?: string;
  paymentStatus?: InvoicePaymentStatus;
  search?: string;
}

export function listInvoices(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.paymentStatus) query.set('paymentStatus', params.paymentStatus);
  if (params.search) query.set('search', params.search);
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

/**
 * The PDF endpoint returns a binary body, not JSON, so this bypasses the
 * api() wrapper and talks to fetch directly. The PDF itself is rendered
 * server-side from the invoice's saved snapshots (see apps/api's
 * pdf.service.ts) — this call has no input beyond which template to use.
 */
export async function fetchInvoicePdf(invoiceId: string, templateId?: string): Promise<Blob> {
  const qs = templateId ? `?template=${encodeURIComponent(templateId)}` : '';
  const res = await fetch(`/api/invoices/${invoiceId}/pdf${qs}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Could not generate the PDF' }));
    throw new ApiError(res.status, body);
  }
  return res.blob();
}

/**
 * Builds a WhatsApp share payload (message text + wa.me link) server-side
 * from the customer's saved WhatsApp number. Behind the same interface on
 * the API side that a future paid WhatsApp Business Cloud API would slot
 * into — this call never changes shape.
 */
export const getWhatsAppShare = (invoiceId: string) =>
  api<WhatsAppSharePayload>(`/invoices/${invoiceId}/whatsapp-share`);

/**
 * Copies this invoice's items into a brand-new draft (server-side, via
 * the exact same createInvoice path a fresh invoice takes) — never
 * copies payments or ledger entries. See apps/api's duplicateInvoice.
 */
export const duplicateInvoice = (invoiceId: string) =>
  api<InvoiceWithItems>(`/invoices/${invoiceId}/duplicate`, { method: 'POST' });
