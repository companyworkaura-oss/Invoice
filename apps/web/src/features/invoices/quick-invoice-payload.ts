import type { DiscountType } from '@invoice/shared';
import type { InvoiceInput, InvoiceItemInput } from './api';

export interface QuickInvoiceItemRow {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface QuickInvoiceFormState {
  lotNumber: string;
  customerLotNumber: string;
  billNumber: string;
  gatePassNumber: string;
  generalQuantity: string;
  notes: string;
  discountType: DiscountType | '';
  discountValue: string;
  items: QuickInvoiceItemRow[];
}

/**
 * UI/UX-02: same reasoning as create-invoice-payload.ts's
 * buildCreateInvoicePayload — pulled out of QuickInvoiceForm's
 * handleSubmit so the exact shape sent to the server (never
 * categoryId; a manual item is what keeps this invoice's
 * invoiceMode 'quick' — see invoiceModeFromItems in
 * invoice.service.ts) can be asserted without rendering anything.
 * Straight extraction: the reorganization only moved where Job
 * details are shown, never what gets sent.
 */
/** UI/UX-03 Part 5: what gets saved to/restored from localStorage for a Quick Invoice still being entered — the shared fields plus customerId, paid, and paymentMethod (not part of QuickInvoiceFormState itself, but part of what this draft needs to recover). */
export interface QuickInvoiceDraftData extends QuickInvoiceFormState {
  customerId: string;
  paid: boolean;
  paymentMethod: string;
}

/** Same reasoning as create-invoice-payload.ts's isStandardDraftMeaningful — an untouched form (default customer, one blank item row) must never prompt or persist. */
export function isQuickDraftMeaningful(data: QuickInvoiceDraftData): boolean {
  if (data.customerId) return true;
  if (data.discountType) return true;
  if (data.paid) return true;
  if (data.lotNumber || data.customerLotNumber || data.billNumber || data.gatePassNumber || data.generalQuantity || data.notes) return true;
  return data.items.some(
    (item) => Boolean(item.description || item.unitPrice) || (item.quantity !== '' && item.quantity !== '1'),
  );
}

export function buildQuickInvoiceSharedFields(form: QuickInvoiceFormState): Omit<InvoiceInput, 'customerId'> {
  return {
    lotNumber: form.lotNumber || undefined,
    customerLotNumber: form.customerLotNumber || undefined,
    billNumber: form.billNumber || undefined,
    gatePassNumber: form.gatePassNumber || undefined,
    generalQuantity: form.generalQuantity || undefined,
    notes: form.notes || undefined,
    discountType: form.discountType || undefined,
    discountValue: form.discountType ? form.discountValue || '0' : undefined,
    items: form.items.map((row): InvoiceItemInput => ({
      description: row.description.trim(),
      quantity: row.quantity || undefined,
      unitPrice: row.unitPrice,
    })),
  };
}
