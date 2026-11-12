import type { InvoicePaymentStatus } from '@invoice/shared';

/**
 * UI/UX-05: the non-component half of the shared ui kit (ui.tsx) — a
 * plain-value/type module split out purely so ui.tsx itself only
 * exports components (keeps Fast Refresh working there); nothing here
 * is a separate concept from ui.tsx, just a different file for
 * tooling's sake.
 */

/** The shared visual recipe for a text/number/date/select control — same height/border/focus ring everywhere. */
export const FIELD_INPUT_CLASS =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/** The one shared color meaning for an invoice's payment status — used by both InvoiceList and InvoiceDetails so the same status never reads as two different tones in two places. */
export const INVOICE_PAYMENT_STATUS_TONE: Record<InvoicePaymentStatus, BadgeTone> = {
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
  CANCELLED: 'neutral',
};
