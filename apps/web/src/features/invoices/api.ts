import type {
  DiscountType,
  InvoiceArchivedFilter,
  InvoiceListEntry,
  InvoicePaymentStatus,
  InvoiceStatus,
  InvoiceWithItems,
  WhatsAppSharePayload,
} from '@invoice/shared';
import { api } from '../../lib/api';

export interface InvoiceItemInput {
  /** Omit for a manual (Quick Invoice) item — see unitPrice below. Normal Invoice always sends this. */
  categoryId?: string;
  description?: string;
  /** Required with categoryId; omit for a manual item. */
  stitches?: number;
  /** Overrides the category's default rate for this item, if given. Only meaningful with categoryId. */
  rate?: string;
  /** This item's own quantity — each category/line has its own, e.g. BAZU=12, FRONT=8. Defaults to "1" when omitted. */
  quantity?: string;
  /** Manual (Quick Invoice) item only: a fixed price for one unit. lineAmount = quantity * unitPrice is recalculated server-side. Requires categoryId to be omitted and description to be given. */
  unitPrice?: string;
}

export interface InvoiceInput {
  customerId: string;
  invoiceDate?: string;
  notes?: string;
  status?: InvoiceStatus;
  /** Internal lot/batch/job identifier, e.g. "LOT-001" — never shown on customer-facing print/PDF. */
  lotNumber?: string;
  /** The customer's own lot number — the only one shown on customer-facing print/PDF. */
  customerLotNumber?: string;
  /** A second, business-assigned number — separate from the system-generated invoice number. Shown on customer-facing print/PDF. */
  billNumber?: string;
  /** The gate pass number that came with the client's material — manual, free text. Shown on customer-facing print/PDF. */
  gatePassNumber?: string;
  /** The overall suit quantity for the invoice/job as a whole — never an item's own quantity, never used in a calculation. */
  generalQuantity?: string;
  /** Display-only toggle for the customer-facing Unit Amount column. Defaults to true (shown) when omitted. */
  showUnitAmount?: boolean;
  /** Display-only toggle for the customer-facing per-item Quantity column. Defaults to true (shown) when omitted. */
  showItemQuantity?: boolean;
  discountType?: DiscountType;
  discountValue?: string;
  items: InvoiceItemInput[];
}

/** Same shape as InvoiceInput minus customerId/status — a draft's customer is fixed; see PATCH /invoices/:id. */
export type InvoiceUpdateInput = Omit<InvoiceInput, 'customerId' | 'status'>;

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

/** Edits a draft invoice in place — see apps/api's updateInvoice. Only drafts can be edited. */
export const updateInvoice = (invoiceId: string, input: InvoiceUpdateInput) =>
  api<InvoiceWithItems>(`/invoices/${invoiceId}`, { method: 'PATCH', body: JSON.stringify(input) });

/**
 * A same-origin URL, not a fetch call — actually downloading it goes
 * through the shared downloadPdf() helper (see lib/downloadPdf.ts),
 * the same one the customer statement download uses. The PDF itself is
 * rendered server-side from the invoice's saved snapshots (see apps/api's
 * pdf.service.ts) — this has no input beyond which template to use.
 */
export const invoicePdfUrl = (invoiceId: string, templateId?: string) =>
  `/api/invoices/${invoiceId}/pdf${templateId ? `?template=${encodeURIComponent(templateId)}` : ''}`;

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
