import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQuickInvoiceSharedFields, type QuickInvoiceFormState } from '../src/features/invoices/quick-invoice-payload.js';

// UI/UX-02: same reasoning as create-invoice-payload.test.ts — moving
// Job details into a collapsible section after Work Items must never
// change what QuickInvoiceForm actually sends.

function baseForm(overrides: Partial<QuickInvoiceFormState> = {}): QuickInvoiceFormState {
  return {
    lotNumber: '',
    customerLotNumber: '',
    billNumber: '',
    gatePassNumber: '',
    generalQuantity: '',
    notes: '',
    discountType: '',
    discountValue: '',
    items: [{ description: 'Custom embroidery', quantity: '1', unitPrice: '25.00' }],
    ...overrides,
  };
}

test('UI/UX-02: blank optional fields are omitted (undefined)', () => {
  const payload = buildQuickInvoiceSharedFields(baseForm());
  assert.equal(payload.lotNumber, undefined);
  assert.equal(payload.customerLotNumber, undefined);
  assert.equal(payload.billNumber, undefined);
  assert.equal(payload.gatePassNumber, undefined);
  assert.equal(payload.generalQuantity, undefined);
  assert.equal(payload.notes, undefined);
  assert.equal(payload.discountType, undefined);
  assert.equal(payload.discountValue, undefined);
});

test('UI/UX-02: Job details fields, when filled in, are sent exactly as typed', () => {
  const payload = buildQuickInvoiceSharedFields(
    baseForm({ lotNumber: 'LOT-79', billNumber: '4587', gatePassNumber: 'GP-4587', generalQuantity: '504', notes: 'Rush order' }),
  );
  assert.equal(payload.lotNumber, 'LOT-79');
  assert.equal(payload.billNumber, '4587');
  assert.equal(payload.gatePassNumber, 'GP-4587');
  assert.equal(payload.generalQuantity, '504');
  assert.equal(payload.notes, 'Rush order');
});

test('UI/UX-02: items never carry categoryId — manual items are what keeps invoiceMode "quick" server-side', () => {
  const payload = buildQuickInvoiceSharedFields(
    baseForm({ items: [{ description: '  Rush Fee  ', quantity: '1', unitPrice: '10.00' }] }),
  );
  assert.deepEqual(payload.items, [{ description: 'Rush Fee', quantity: '1', unitPrice: '10.00' }]);
  assert.ok(!('categoryId' in (payload.items?.[0] ?? {})));
});

test('UI/UX-02: a discount type with a blank value defaults to "0"', () => {
  const payload = buildQuickInvoiceSharedFields(baseForm({ discountType: 'fixed', discountValue: '' }));
  assert.equal(payload.discountType, 'fixed');
  assert.equal(payload.discountValue, '0');
});
