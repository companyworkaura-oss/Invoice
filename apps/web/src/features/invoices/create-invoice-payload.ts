import type { DiscountType } from '@invoice/shared';
import type { InvoiceInput, InvoiceItemInput } from './api';

export interface CreateInvoiceItemRow {
  categoryId: string;
  description: string;
  quantity: string;
  stitches: string;
  rate: string;
}

export interface CreateInvoiceFormState {
  invoiceDate: string;
  lotNumber: string;
  customerLotNumber: string;
  billNumber: string;
  gatePassNumber: string;
  generalQuantity: string;
  showUnitAmount: boolean;
  showItemQuantity: boolean;
  showItemAmount: boolean;
  showBillNumber: boolean;
  discountType: DiscountType | '';
  discountValue: string;
  items: CreateInvoiceItemRow[];
}

/**
 * UI/UX-02: pulled out of CreateInvoiceForm's handleSubmit so the
 * exact shape of what gets sent to the server can be asserted by a
 * test independently of rendering anything — this repo has no DOM
 * test runner (no React Testing Library/jsdom), so a pure function
 * is the only way to cover "invoice submit payload remains
 * unchanged" after reorganizing the form's visual layout. This is a
 * straight extraction, not a rewrite: the reorganization moved
 * *where* these fields are shown (Job details / Print options,
 * now collapsible, placed after Work Items instead of before), never
 * what they mean, what their defaults are, or what gets sent — same
 * `|| undefined` blank-means-omit rule every field already had.
 */
/** UI/UX-03 Part 4: what gets saved to/restored from localStorage for a Standard Invoice still being entered — the form state plus `customerId` (not part of the submit payload type itself, since that's added separately at submit time, but very much part of what a draft needs to recover). */
export interface StandardInvoiceDraftData extends CreateInvoiceFormState {
  customerId: string;
}

/**
 * Whether a draft (or the current in-progress form) actually has
 * anything worth prompting the user about or persisting — an
 * untouched form (default customer/discount, the one default blank
 * item row) must never trigger "Unsaved invoice found" on its own
 * next visit, and must never get written to storage as a draft in
 * the first place.
 */
export function isStandardDraftMeaningful(data: StandardInvoiceDraftData): boolean {
  if (data.customerId) return true;
  if (data.discountType) return true;
  if (data.lotNumber || data.customerLotNumber || data.billNumber || data.gatePassNumber || data.generalQuantity) return true;
  return data.items.some(
    (item) => Boolean(item.categoryId || item.description || item.stitches || item.rate) || (item.quantity !== '' && item.quantity !== '1'),
  );
}

export function buildCreateInvoicePayload(form: CreateInvoiceFormState): Omit<InvoiceInput, 'customerId'> {
  return {
    invoiceDate: form.invoiceDate,
    lotNumber: form.lotNumber || undefined,
    customerLotNumber: form.customerLotNumber || undefined,
    billNumber: form.billNumber || undefined,
    gatePassNumber: form.gatePassNumber || undefined,
    generalQuantity: form.generalQuantity || undefined,
    showUnitAmount: form.showUnitAmount,
    showItemQuantity: form.showItemQuantity,
    showItemAmount: form.showItemAmount,
    showBillNumber: form.showBillNumber,
    discountType: form.discountType || undefined,
    discountValue: form.discountType ? form.discountValue || '0' : undefined,
    items: form.items.map((row): InvoiceItemInput => ({
      categoryId: row.categoryId,
      description: row.description || undefined,
      quantity: row.quantity || undefined,
      stitches: Number(row.stitches),
      rate: row.rate || undefined,
    })),
  };
}
