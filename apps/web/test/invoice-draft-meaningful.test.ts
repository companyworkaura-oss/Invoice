import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStandardDraftMeaningful, type StandardInvoiceDraftData } from '../src/features/invoices/create-invoice-payload.js';
import { isQuickDraftMeaningful, type QuickInvoiceDraftData } from '../src/features/invoices/quick-invoice-payload.js';

// UI/UX-03 Part 6/7: an untouched form must never trigger "Unsaved
// invoice found" on a later visit, and must never even get written
// to storage as a draft — both decisions go through these two pure
// functions, so "untouched form does not warn" (Part 7's own
// requirement) is covered without needing to render anything.

function blankStandard(overrides: Partial<StandardInvoiceDraftData> = {}): StandardInvoiceDraftData {
  return {
    customerId: '',
    invoiceDate: '2026-01-01',
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
    items: [{ categoryId: '', description: '', quantity: '1', stitches: '', rate: '' }],
    ...overrides,
  };
}

test('UI/UX-03: a brand-new, untouched Standard form is not meaningful', () => {
  assert.equal(isStandardDraftMeaningful(blankStandard()), false);
});

test('UI/UX-03: selecting a customer alone makes a Standard draft meaningful', () => {
  assert.equal(isStandardDraftMeaningful(blankStandard({ customerId: 'cust-1' })), true);
});

test('UI/UX-03: picking a category on one item makes a Standard draft meaningful', () => {
  const data = blankStandard({ items: [{ categoryId: 'cat-1', description: '', quantity: '1', stitches: '', rate: '' }] });
  assert.equal(isStandardDraftMeaningful(data), true);
});

test('UI/UX-03: entering a discount alone makes a Standard draft meaningful', () => {
  assert.equal(isStandardDraftMeaningful(blankStandard({ discountType: 'percentage', discountValue: '10' })), true);
});

test('UI/UX-03: a Job Details field alone makes a Standard draft meaningful', () => {
  assert.equal(isStandardDraftMeaningful(blankStandard({ lotNumber: 'LOT-79' })), true);
});

test('UI/UX-03: changing an item quantity away from the default "1" makes a Standard draft meaningful', () => {
  const data = blankStandard({ items: [{ categoryId: '', description: '', quantity: '5', stitches: '', rate: '' }] });
  assert.equal(isStandardDraftMeaningful(data), true);
});

function blankQuick(overrides: Partial<QuickInvoiceDraftData> = {}): QuickInvoiceDraftData {
  return {
    customerId: '',
    lotNumber: '',
    customerLotNumber: '',
    billNumber: '',
    gatePassNumber: '',
    generalQuantity: '',
    notes: '',
    discountType: '',
    discountValue: '',
    items: [{ description: '', quantity: '1', unitPrice: '' }],
    paid: false,
    paymentMethod: 'cash',
    ...overrides,
  };
}

test('UI/UX-03: a brand-new, untouched Quick form is not meaningful', () => {
  assert.equal(isQuickDraftMeaningful(blankQuick()), false);
});

test('UI/UX-03: checking "Paid" alone makes a Quick draft meaningful', () => {
  assert.equal(isQuickDraftMeaningful(blankQuick({ paid: true })), true);
});

test('UI/UX-03: typing an item description alone makes a Quick draft meaningful', () => {
  const data = blankQuick({ items: [{ description: 'Custom embroidery', quantity: '1', unitPrice: '' }] });
  assert.equal(isQuickDraftMeaningful(data), true);
});

test('UI/UX-03: notes alone make a Quick draft meaningful', () => {
  assert.equal(isQuickDraftMeaningful(blankQuick({ notes: 'Rush order' })), true);
});
