import type {
  InvoiceArchivedFilter,
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
  /** Omitted = 'active' (archived invoices hidden), matching the backend's default. */
  archived?: InvoiceArchivedFilter;
}

export function listInvoices(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.paymentStatus) query.set('paymentStatus', params.paymentStatus);
  if (params.search) query.set('search', params.search);
  if (params.archived) query.set('archived', params.archived);
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
  const blob = await res.blob();
  // A 200 with a 0-byte body is exactly the shape of the "downloads but
  // won't open" bug this guards against — treat it as a failure instead
  // of handing the caller an empty file to save.
  if (blob.size === 0) {
    throw new ApiError(res.status, { error: 'The generated PDF was empty — please try again.' });
  }
  return blob;
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

/**
 * Hides the invoice from the default list. Never touches ledger entries,
 * items, or payments — see apps/api's archiveInvoice.
 */
export const archiveInvoice = (invoiceId: string) =>
  api<InvoiceWithItems>(`/invoices/${invoiceId}/archive`, { method: 'PATCH' });

/** Restores an archived invoice to the default list. */
export const unarchiveInvoice = (invoiceId: string) =>
  api<InvoiceWithItems>(`/invoices/${invoiceId}/unarchive`, { method: 'PATCH' });

/**
 * Permanently deletes an invoice. The backend only allows this for a
 * draft invoice with no payment applied to it — see apps/api's
 * deleteInvoice for the exact rule; any other invoice throws a 400 with
 * a clear reason instead.
 */
export const deleteInvoice = (invoiceId: string) =>
  api<{ deleted: true; id: string }>(`/invoices/${invoiceId}`, { method: 'DELETE' });
