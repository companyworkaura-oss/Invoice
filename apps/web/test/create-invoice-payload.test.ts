import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCreateInvoicePayload, type CreateInvoiceFormState } from '../src/features/invoices/create-invoice-payload.js';

// UI/UX-02: reorganizing CreateInvoiceForm moved *where* Job details/
// Print options are shown (now collapsible, after Work Items instead
// of before), never what gets sent to the server. buildCreateInvoicePayload
// is the exact logic handleSubmit used to build inline — these tests
// pin its output so a future change to the visual layout can never
// silently change the submit payload.

function baseForm(overrides: Partial<CreateInvoiceFormState> = {}): CreateInvoiceFormState {
  return {
    invoiceDate: '2026-01-15',
    lotNumber: '',
    customerLotNumber: '',
    billNumber: '',
    gatePassNumber: '',
    generalQuantity: '',
    showUnitAmount: true,
    showItemQuantity: true,
    showItemAmount: true,
    showBillNumber: true,
    discountType: '',
    discountValue: '',
    items: [{ categoryId: 'cat-1', description: '', quantity: '1', stitches: '12000', rate: '' }],
    ...overrides,
  };
}

test('UI/UX-02: blank optional fields are omitted (undefined), never sent as empty strings', () => {
  const payload = buildCreateInvoicePayload(baseForm());
  assert.equal(payload.lotNumber, undefined);
  assert.equal(payload.customerLotNumber, undefined);
  assert.equal(payload.billNumber, undefined);
  assert.equal(payload.gatePassNumber, undefined);
  assert.equal(payload.generalQuantity, undefined);
  assert.equal(payload.discountType, undefined);
  assert.equal(payload.discountValue, undefined);
});

test('UI/UX-02: Job details fields, when filled in, are sent exactly as typed', () => {
  const payload = buildCreateInvoicePayload(
    baseForm({
      lotNumber: 'LOT-79',
      customerLotNumber: 'CUST-458',
      billNumber: '4587',
      gatePassNumber: 'GP-4587',
      generalQuantity: '504',
    }),
  );
  assert.equal(payload.lotNumber, 'LOT-79');
  assert.equal(payload.customerLotNumber, 'CUST-458');
  assert.equal(payload.billNumber, '4587');
  assert.equal(payload.gatePassNumber, 'GP-4587');
  assert.equal(payload.generalQuantity, '504');
});

test('UI/UX-02: Print options toggles are sent as plain booleans, exactly as set', () => {
  const payload = buildCreateInvoicePayload(
    baseForm({ showUnitAmount: false, showItemQuantity: false, showItemAmount: true, showBillNumber: false }),
  );
  assert.equal(payload.showUnitAmount, false);
  assert.equal(payload.showItemQuantity, false);
  assert.equal(payload.showItemAmount, true);
  assert.equal(payload.showBillNumber, false);
});

test('UI/UX-02: a discount type with a blank value defaults to "0", same as before', () => {
  const payload = buildCreateInvoicePayload(baseForm({ discountType: 'percentage', discountValue: '' }));
  assert.equal(payload.discountType, 'percentage');
  assert.equal(payload.discountValue, '0');
});

test('UI/UX-02: items map categoryId/description/quantity/stitches/rate exactly, stitches coerced to a number', () => {
  const payload = buildCreateInvoicePayload(
    baseForm({
      items: [
        { categoryId: 'cat-1', description: 'BAZU', quantity: '12', stitches: '50000', rate: '1.50' },
        { categoryId: 'cat-2', description: '', quantity: '', stitches: '30000', rate: '' },
      ],
    }),
  );
  assert.deepEqual(payload.items, [
    { categoryId: 'cat-1', description: 'BAZU', quantity: '12', stitches: 50000, rate: '1.50' },
    { categoryId: 'cat-2', description: undefined, quantity: undefined, stitches: 30000, rate: undefined },
  ]);
});

test('UI/UX-02: invoiceDate is always sent as-is, never omitted', () => {
  const payload = buildCreateInvoicePayload(baseForm({ invoiceDate: '2026-03-01' }));
  assert.equal(payload.invoiceDate, '2026-03-01');
});
