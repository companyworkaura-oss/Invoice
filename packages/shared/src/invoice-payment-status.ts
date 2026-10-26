import { Decimal } from 'decimal.js';
import type { InvoicePaymentStatus, InvoiceStatus, Money } from './entities.js';
import { roundMoney } from './formula-engine/formula-engine.js';

/**
 * UI/UX-01: InvoiceWithItems (returned by POST/GET one invoice) carries
 * `grandTotal` and `amountPaid` — both already authoritative,
 * backend-computed values — but not a ready-made `paymentStatus` or
 * "remaining on this invoice" figure the way InvoiceListEntry does (see
 * its own `paid`/`balance`/`paymentStatus`, computed in
 * invoice.service.ts's listInvoices SQL). These two functions mirror
 * that exact SQL CASE/subtraction, so the invoice detail screen can
 * show "Remaining on this invoice" and an invoice payment status badge
 * without inventing any new accounting rule — just restating the same
 * two already-given numbers for display. `amountPaid` is mathematically
 * bounded in [0, grandTotal] by construction (see getInvoicePaidAmount
 * in invoice.service.ts), so the remaining amount can never go
 * negative here either.
 */
export function invoiceRemainingBalance(grandTotal: Money, amountPaid: Money): Money {
  const remaining = new Decimal(grandTotal).minus(amountPaid);
  return roundMoney(remaining.isNegative() ? new Decimal(0) : remaining);
}

/** Same CASE order/thresholds as invoice.service.ts's listInvoices: cancelled first, then paid-off (<=0 remaining), then any payment at all, else unpaid. */
export function deriveInvoicePaymentStatus(
  invoiceStatus: InvoiceStatus,
  grandTotal: Money,
  amountPaid: Money,
): InvoicePaymentStatus {
  if (invoiceStatus === 'cancelled') return 'CANCELLED';
  const remaining = new Decimal(grandTotal).minus(amountPaid);
  if (remaining.lessThanOrEqualTo(0)) return 'PAID';
  if (new Decimal(amountPaid).greaterThan(0)) return 'PARTIAL';
  return 'UNPAID';
}

/**
 * UI/UX-01: a payment amount is only ever worth suggesting when the
 * customer's live overall account balance is actually positive (they
 * owe something) — a customer with nothing outstanding, or one in
 * credit (a negative balance, e.g. from an overpayment or a credit
 * adjustment), has no amount to prompt a payment toward. Pre-filling
 * a negative or zero amount would either be silently wrong or get
 * rejected by the backend's own positive-amount check, so this
 * returns `undefined` (no suggestion at all) in both of those cases,
 * never a negative or zero string.
 */
export function suggestedCustomerPaymentAmount(currentBalance: Money): Money | undefined {
  // decimal.js's isPositive() is true for 0 as well (no "is this
  // actually greater than zero" distinction) — greaterThan(0) is the
  // check that actually excludes a zero balance, not just a negative one.
  return new Decimal(currentBalance).greaterThan(0) ? currentBalance : undefined;
}
