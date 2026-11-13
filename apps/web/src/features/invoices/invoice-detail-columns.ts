import type { InvoiceMode } from '@invoice/shared';

/**
 * UI/UX-07 Part 9: which item-table columns InvoiceDetails shows,
 * decided purely from the invoice's own server-computed `invoiceMode`
 * (never inferred from whether an item happens to carry a categoryId —
 * see invoiceModeFromItems in invoice.service.ts, the one place that
 * discriminator is actually computed). Pulled out as a pure function
 * so the column set is unit-testable without a React renderer, same
 * convention as this repo's other extracted decision logic.
 */
export type InvoiceItemColumn = 'category' | 'description' | 'quantity' | 'stitches' | 'rate' | 'unitAmount' | 'total';

const QUICK_COLUMNS: InvoiceItemColumn[] = ['description', 'quantity', 'unitAmount', 'total'];
const STANDARD_COLUMNS: InvoiceItemColumn[] = ['category', 'description', 'quantity', 'stitches', 'rate', 'unitAmount', 'total'];

export function invoiceItemColumnsForMode(invoiceMode: InvoiceMode): readonly InvoiceItemColumn[] {
  return invoiceMode === 'quick' ? QUICK_COLUMNS : STANDARD_COLUMNS;
}
