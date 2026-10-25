import type { InvoiceWithItems, PaymentMethod } from '@invoice/shared';
import { Decimal } from '@invoice/shared';
import type { InvoiceInput } from './api';
import type { PaymentInput } from '../payments/api';

/**
 * F06: Quick Invoice's "create, then optionally mark Paid" save is
 * three separate network calls (createInvoice, createPayment,
 * getInvoice) with no backend transaction tying them together. If
 * anything after the first call fails — the payment post, or the
 * refetch — and the caller retries the whole save, naively re-running
 * all three from scratch re-POSTs createInvoice and creates a second,
 * duplicate invoice for a single user action.
 *
 * This module is the one place that sequence lives, extracted out of
 * the form component so it can be driven by injected (and in tests,
 * mocked/failing) dependencies rather than real fetch calls. The
 * retry-safety itself comes from `state`: it's a plain, mutable object
 * the *caller* owns and keeps around across retries (QuickInvoiceForm
 * keeps it in a ref) — `saveQuickInvoice` fills in `state.invoice` the
 * moment createInvoice succeeds, and `state.paymentCreated` the moment
 * createPayment succeeds, *before* either can throw on what comes
 * next. A retry that passes the same `state` back in skips any step
 * already marked done and resumes from whatever failed — the invoice
 * (and its payment, if one happened) is created at most once no matter
 * how many times a given `state` is retried.
 *
 * A zero-total invoice (e.g. a 100% discount) is deliberately never
 * paid even if the "Paid" box is checked — the backend rejects a
 * zero-amount payment (`requirePositiveDecimal`), so this skips the
 * doomed request instead of surfacing that rejection as a confusing
 * save failure.
 */
export interface QuickInvoiceSaveState {
  invoice: InvoiceWithItems | null;
  paymentCreated: boolean;
}

export function newQuickInvoiceSaveState(): QuickInvoiceSaveState {
  return { invoice: null, paymentCreated: false };
}

export interface QuickInvoiceSaveDeps {
  createInvoice: (input: InvoiceInput) => Promise<InvoiceWithItems>;
  createPayment: (input: PaymentInput) => Promise<unknown>;
  getInvoice: (invoiceId: string) => Promise<InvoiceWithItems>;
}

export interface QuickInvoiceSaveInput {
  invoiceInput: InvoiceInput;
  customerId: string;
  paid: boolean;
  paymentMethod: PaymentMethod;
}

export async function saveQuickInvoice(
  state: QuickInvoiceSaveState,
  input: QuickInvoiceSaveInput,
  deps: QuickInvoiceSaveDeps,
): Promise<InvoiceWithItems> {
  if (!state.invoice) {
    state.invoice = await deps.createInvoice(input.invoiceInput);
  }
  const invoice = state.invoice;

  const shouldPay = input.paid && new Decimal(invoice.grandTotal).greaterThan(0);
  if (shouldPay && !state.paymentCreated) {
    await deps.createPayment({
      customerId: input.customerId,
      amount: invoice.grandTotal,
      date: invoice.invoiceDate,
      paymentMethod: input.paymentMethod,
    });
    state.paymentCreated = true;
  }

  if (shouldPay) {
    // `invoice`'s amountPaid/currentBalance were computed at creation,
    // before the payment above existed — refetch so the view that
    // opens next shows the real, ledger-derived figures.
    return await deps.getInvoice(invoice.id);
  }
  return invoice;
}
