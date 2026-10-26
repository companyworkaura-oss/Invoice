import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewDiscount } from '../src/features/invoices/preview.js';

// F05: previewDiscount runs inside a render-time useMemo in
// CreateInvoiceForm/QuickInvoiceForm, fed directly from the raw
// keystrokes in the Discount field. Any input that makes it throw
// crashes that render and loses the rest of the in-progress invoice
// form — so every one of these must come back as a plain result
// object, never an exception.

test('F05: empty discount value is not an error (field not typed into yet)', () => {
  const result = previewDiscount('100.00', 'fixed', '');
  assert.equal(result.error, null);
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
});

test('F05: "-" does not throw and surfaces a field validation error', () => {
  const result = previewDiscount('100.00', 'fixed', '-');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.ok(result.error, 'must have a validation error, not a crash');
});

test('F05: "." does not throw and surfaces a field validation error', () => {
  const result = previewDiscount('100.00', 'percentage', '.');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.ok(result.error, 'must have a validation error, not a crash');
});

test('F05: "abc" does not throw and surfaces a field validation error', () => {
  const result = previewDiscount('100.00', 'fixed', 'abc');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.ok(result.error, 'must have a validation error, not a crash');
});

test('F05: "10" is a valid percentage discount, unaffected by the fix', () => {
  const result = previewDiscount('100.00', 'percentage', '10');
  assert.equal(result.error, null);
  assert.equal(result.discountAmount, '10.00');
  assert.equal(result.grandTotal, '90.00');
});

test('F05: "10.5" is a valid fixed discount, unaffected by the fix', () => {
  const result = previewDiscount('100.00', 'fixed', '10.5');
  assert.equal(result.error, null);
  assert.equal(result.discountAmount, '10.50');
  assert.equal(result.grandTotal, '89.50');
});

test('F05: invalid input never throws across every discount type, including no type selected', () => {
  const invalidInputs = ['-', '.', 'abc', '--', '1.2.3', 'NaN', 'Infinity'];
  const types: ('percentage' | 'fixed' | '')[] = ['percentage', 'fixed', ''];
  for (const discountType of types) {
    for (const raw of invalidInputs) {
      assert.doesNotThrow(() => previewDiscount('250.00', discountType, raw), `type=${discountType} raw=${raw}`);
    }
  }
});

test('F05: a negative valid number still reports the pre-existing "cannot be negative" error, not a crash', () => {
  const result = previewDiscount('100.00', 'fixed', '-5');
  assert.equal(result.error, 'Discount cannot be negative');
});

test('F05: valid-decimal bounds checks are preserved (percentage over 100, fixed over subtotal)', () => {
  const overPercentage = previewDiscount('100.00', 'percentage', '150');
  assert.match(overPercentage.error ?? '', /between 0 and 100/);

  const overFixed = previewDiscount('100.00', 'fixed', '150');
  assert.match(overFixed.error ?? '', /exceed the subtotal/);
});

// F04: discountAmount and grandTotal must satisfy
// subtotal === discountAmount + grandTotal at 2-decimal precision —
// mirrors the server's calculateDiscount fix exactly (see
// invoice.service.ts), so this live preview never shows a different
// split than what the server will actually save.
function assertConsistent(subtotal: string, result: { discountAmount: string; grandTotal: string }) {
  const sum = (Number(result.discountAmount) + Number(result.grandTotal)).toFixed(2);
  assert.equal(sum, subtotal, `discountAmount (${result.discountAmount}) + grandTotal (${result.grandTotal}) must equal subtotal (${subtotal})`);
}

test('F04: subtotal 1.01 @ 50% previews as 0.51 + 0.50, never 0.51 + 0.51', () => {
  const result = previewDiscount('1.01', 'percentage', '50');
  assertConsistent('1.01', result);
  assert.equal(result.discountAmount, '0.51');
  assert.equal(result.grandTotal, '0.50');
});

test('F04: a sweep of half-cent percentage combinations are all internally consistent', () => {
  const cases: [string, string][] = [
    ['1.01', '50'],
    ['0.01', '50'],
    ['0.03', '50'],
    ['10.01', '33.33'],
    ['99.99', '1'],
  ];
  for (const [subtotal, discountValue] of cases) {
    assertConsistent(subtotal, previewDiscount(subtotal, 'percentage', discountValue));
  }
});

test('F04: a fixed discount with cents is internally consistent', () => {
  const result = previewDiscount('10.00', 'fixed', '3.33');
  assertConsistent('10.00', result);
  assert.equal(result.discountAmount, '3.33');
  assert.equal(result.grandTotal, '6.67');
});

test('F04: normal whole-cent discounts are unaffected (same numbers as before the fix)', () => {
  const tenPercent = previewDiscount('144.00', 'percentage', '10');
  assertConsistent('144.00', tenPercent);
  assert.equal(tenPercent.discountAmount, '14.40');
  assert.equal(tenPercent.grandTotal, '129.60');
});
