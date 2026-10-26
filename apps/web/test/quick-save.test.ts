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

// F11: Quick Invoice's create-and-pay is now a single atomic
// server-side call (see apps/api's createInvoiceCore) carrying a
// per-save idempotency key. These tests drive saveQuickInvoice with a
// mocked, sometimes-failing createInvoice to prove a retry (the same
// `state`, as a real retry reuses via its ref) never generates a new
// key and therefore can never cause the server to treat it as a
// second, independent save.

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
    paid: false,
    paymentMethod: 'cash',
    ...overrides,
  };
}

test('F11: a new save state carries a fresh idempotency key each time', () => {
  const a = newQuickInvoiceSaveState();
  const b = newQuickInvoiceSaveState();
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  assert.ok(a.idempotencyKey.length > 0);
});

test('F11: paid + zero-total (100% discount) sends paid=true but never a paymentMethod-less call fails — the backend skips the zero payment, not this layer', async () => {
  const state = newQuickInvoiceSaveState();
  let calls = 0;
  let received: InvoiceInput | undefined;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async (input) => {
      calls++;
      received = input;
      return fakeInvoice({ grandTotal: '0.00' });
    },
  };

  const result = await saveQuickInvoice(state, baseInput({ paid: true }), deps);

  assert.equal(calls, 1);
  assert.equal(received?.paid, true);
  assert.equal(received?.idempotencyKey, state.idempotencyKey);
  assert.equal(result.grandTotal, '0.00');
});

test('F11: a save failure followed by a retry reuses the exact same idempotency key', async () => {
  const state = newQuickInvoiceSaveState();
  const keysSeen: (string | undefined)[] = [];
  let attempt = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async (input) => {
      attempt++;
      keysSeen.push(input.idempotencyKey);
      if (attempt === 1) throw new Error('simulated network failure');
      return fakeInvoice();
    },
  };
  const input = baseInput({ paid: true });

  await assert.rejects(saveQuickInvoice(state, input, deps));
  const result = await saveQuickInvoice(state, input, deps);

  assert.equal(attempt, 2, 'the create call itself is retried');
  assert.equal(keysSeen[0], keysSeen[1], 'retry must reuse the same idempotency key, not generate a new one');
  assert.equal(result.id, 'invoice-1');
});

test('F11: once createInvoice has succeeded, a further call with the same state never calls createInvoice again', async () => {
  const state = newQuickInvoiceSaveState();
  let calls = 0;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async () => {
      calls++;
      return fakeInvoice();
    },
  };
  const input = baseInput({ paid: true });

  const first = await saveQuickInvoice(state, input, deps);
  const second = await saveQuickInvoice(state, input, deps);

  assert.equal(calls, 1, 'the client itself never re-issues the call once this state has a cached invoice');
  assert.equal(first.id, second.id);
});

test('F11: an unpaid Quick Invoice sends paid=false and no paymentMethod', async () => {
  let received: InvoiceInput | undefined;
  const deps: QuickInvoiceSaveDeps = {
    createInvoice: async (input) => {
      received = input;
      return fakeInvoice();
    },
  };

  const result = await saveQuickInvoice(newQuickInvoiceSaveState(), baseInput({ paid: false }), deps);

  assert.equal(received?.paid, false);
  assert.equal(received?.paymentMethod, undefined);
  assert.equal(result.id, 'invoice-1');
});
