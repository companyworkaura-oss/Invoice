import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvoiceWithItems } from '@invoice/shared';
import type { InvoiceInput } from '../src/features/invoices/api.js';
import {
  newQuickInvoiceSaveState,
  saveQuickInvoice,
  type QuickInvoiceSaveDeps,
  type QuickInvoiceSaveInput,
} from '../src/features/invoices/quick-save.js';

// F06: Quick Invoice's create -> (optional) payment -> (optional)
// refetch is three separate network calls with no backend transaction.
// These tests drive saveQuickInvoice with mocked, sometimes-failing
// dependencies and the exact same `state` object a retry would reuse,
// to prove a retry after any one of those three calls fails never
// re-creates the invoice.

function fakeInvoice(overrides: Partial<InvoiceWithItems> = {}): InvoiceWithItems {
  return {
    id: 'invoice-1',
    invoiceDate: '2026-01-01',
    grandTotal: '100.00',
    ...overrides,
  } as InvoiceWithItems;
}

function baseInput(overrides: Partial<QuickInvoiceSaveInput> = {}): QuickInvoiceSaveInput {
  return {
    invoiceInput: { customerId: 'customer-1', items: [] } as unknown as InvoiceInput,
    customerId: 'customer-1',
    paid: false,
    paymentMethod: 'cash',
    ...overrides,
  };
}

test('F06: a Paid Quick Invoice with a 100% discount (zero total) saves once, skipping the doomed zero payment', async () => {
  const state = newQuickInvoiceSaveState();
  let createInvoiceCalls = 0;
  let createPaymentCalls = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      createInvoiceCalls++;
      return fakeInvoice({ grandTotal: '0.00' });
    },
    createPayment: async () => {
      createPaymentCalls++;
      throw new Error('backend rejects zero-amount payments — must never be called');
    },
    getInvoice: async () => fakeInvoice({ grandTotal: '0.00' }),
  };

  const result = await saveQuickInvoice(state, baseInput({ paid: true }), deps);

  assert.equal(createInvoiceCalls, 1);
  assert.equal(createPaymentCalls, 0, 'zero-amount payment must never be attempted');
  assert.equal(result.grandTotal, '0.00');
});

test('F06: a payment failure after invoice creation does not duplicate the invoice on retry', async () => {
  const state = newQuickInvoiceSaveState();
  let createInvoiceCalls = 0;
  let paymentAttempt = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      createInvoiceCalls++;
      return fakeInvoice();
    },
    createPayment: async () => {
      paymentAttempt++;
      if (paymentAttempt === 1) throw new Error('simulated payment network failure');
    },
    getInvoice: async () => fakeInvoice(),
  };
  const input = baseInput({ paid: true });

  await assert.rejects(saveQuickInvoice(state, input, deps));
  assert.equal(createInvoiceCalls, 1, 'the invoice must exist after the first attempt');

  // Retry with the SAME state, as the real form does via its ref.
  const result = await saveQuickInvoice(state, input, deps);

  assert.equal(createInvoiceCalls, 1, 'retry must not create a second invoice');
  assert.equal(paymentAttempt, 2, 'the payment itself is retried');
  assert.equal(result.id, 'invoice-1');
});

test('F06: a refetch/network failure after a successful payment does not duplicate the invoice or the payment', async () => {
  const state = newQuickInvoiceSaveState();
  let createInvoiceCalls = 0;
  let createPaymentCalls = 0;
  let getInvoiceAttempt = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      createInvoiceCalls++;
      return fakeInvoice();
    },
    createPayment: async () => {
      createPaymentCalls++;
    },
    getInvoice: async () => {
      getInvoiceAttempt++;
      if (getInvoiceAttempt === 1) throw new Error('simulated refetch network failure');
      return fakeInvoice({ amountPaid: '100.00' } as Partial<InvoiceWithItems>);
    },
  };
  const input = baseInput({ paid: true });

  await assert.rejects(saveQuickInvoice(state, input, deps));
  assert.equal(createInvoiceCalls, 1);
  assert.equal(createPaymentCalls, 1);

  // Retry with the SAME state.
  const result = await saveQuickInvoice(state, input, deps);

  assert.equal(createInvoiceCalls, 1, 'retry must not create a second invoice');
  assert.equal(createPaymentCalls, 1, 'retry must not create a second payment — it already succeeded');
  assert.equal(getInvoiceAttempt, 2);
  assert.equal(result.id, 'invoice-1');
});

test('F06: invoice count (createInvoice call count) remains 1 across a create -> fail -> retry -> succeed sequence', async () => {
  const state = newQuickInvoiceSaveState();
  const counts = { createInvoice: 0, createPayment: 0, getInvoice: 0 };
  let attempt = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      counts.createInvoice++;
      return fakeInvoice();
    },
    createPayment: async () => {
      counts.createPayment++;
    },
    getInvoice: async () => {
      counts.getInvoice++;
      attempt++;
      if (attempt < 3) throw new Error('simulated flaky network');
      return fakeInvoice();
    },
  };
  const input = baseInput({ paid: true });

  await assert.rejects(saveQuickInvoice(state, input, deps));
  await assert.rejects(saveQuickInvoice(state, input, deps));
  const result = await saveQuickInvoice(state, input, deps);

  assert.equal(counts.createInvoice, 1, 'exactly one invoice must ever be created across all retries');
  assert.equal(counts.createPayment, 1, 'exactly one payment must ever be created across all retries');
  assert.equal(result.id, 'invoice-1');
});

test('F06: an unpaid Quick Invoice never calls createPayment or getInvoice at all', async () => {
  const state = newQuickInvoiceSaveState();
  const counts = { createInvoice: 0, createPayment: 0, getInvoice: 0 };
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      counts.createInvoice++;
      return fakeInvoice();
    },
    createPayment: async () => {
      counts.createPayment++;
    },
    getInvoice: async () => {
      counts.getInvoice++;
      return fakeInvoice();
    },
  };

  const result = await saveQuickInvoice(state, baseInput({ paid: false }), deps);

  assert.equal(counts.createInvoice, 1);
  assert.equal(counts.createPayment, 0);
  assert.equal(counts.getInvoice, 0);
  assert.equal(result.id, 'invoice-1');
});
