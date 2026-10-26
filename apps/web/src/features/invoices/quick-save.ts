import type { InvoiceWithItems, PaymentMethod } from '@invoice/shared';
import type { InvoiceInput } from './api';

/**
 * F11: Quick Invoice's "create, then optionally mark Paid" save used
 * to be up to three separate network calls (createInvoice,
 * createPayment, a refetch) with no backend transaction tying them
 * together — a failure after the invoice was created but before the
 * client learned the save succeeded, followed by a naive retry, could
 * re-POST the whole save and create a second, duplicate invoice.
 *
 * The invoice and its initial payment are now created atomically in
 * one server-side transaction (see apps/api's createInvoiceCore) —
 * there is no window where one exists without the other, so this
 * module no longer has multiple steps to sequence. What's left is
 * purely about retry-safety: `state.idempotencyKey` is generated once
 * per save attempt and reused across every retry of that same
 * attempt (the caller keeps `state` in a ref, same as before), so a
 * dropped response followed by a retry replays the *same* server-side
 * idempotency key — the server returns the original invoice instead
 * of creating another one. See invoice.service.ts's
 * createInvoiceIdempotent for the server side of this.
 *
 * A zero-total invoice (e.g. a 100% discount) is deliberately never
 * paid even if the "Paid" box is checked — the backend never attempts
 * a zero-amount payment for it regardless of what's sent, so there is
 * nothing here that could surface that as a confusing save failure.
 */
export interface QuickInvoiceSaveState {
  invoice: InvoiceWithItems | null;
  idempotencyKey: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `quick-invoice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newQuickInvoiceSaveState(): QuickInvoiceSaveState {
  return { invoice: null, idempotencyKey: generateIdempotencyKey() };
}

export interface QuickInvoiceSaveDeps {
  createInvoice: (input: InvoiceInput) => Promise<InvoiceWithItems>;
}

export interface QuickInvoiceSaveInput {
  invoiceInput: InvoiceInput;
  paid: boolean;
  paymentMethod: PaymentMethod;
}

export async function saveQuickInvoice(
  state: QuickInvoiceSaveState,
  input: QuickInvoiceSaveInput,
  deps: QuickInvoiceSaveDeps,
): Promise<InvoiceWithItems> {
  if (!state.invoice) {
    state.invoice = await deps.createInvoice({
      ...input.invoiceInput,
      paid: input.paid,
      paymentMethod: input.paid ? input.paymentMethod : undefined,
      idempotencyKey: state.idempotencyKey,
    });
  }
  return state.invoice;
}
