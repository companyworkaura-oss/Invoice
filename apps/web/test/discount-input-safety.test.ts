import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewDiscount } from '../src/features/invoices/preview.js';

// F10 — discount input must not crash during typing. Re-verification
// of this session's own earlier "F05" fix (Phase 45): `previewDiscount`
// is the one shared discount preview/calculation helper both
// CreateInvoiceForm (Standard Invoice) and QuickInvoiceForm (Quick
// Invoice) call — confirmed by inspection, neither form constructs a
// `Decimal` from the raw discount field itself anywhere else. Exact
// crash source (already fixed): `new Decimal(discountValueRaw)` was
// called directly on the raw keystroke value inside this render-time
// helper; decimal.js throws a DecimalError for "-"/"."/"abc" (all
// ordinary mid-typing states), which would have blown up the
// enclosing useMemo and crashed the component. The fix —
// `parseDiscountValue`, a safe parser that returns `Decimal | null`
// and never throws — already lives in preview.ts and is the one
// place both forms' discount field routes through.
//
// These tests exercise every state this report's own test list (1-9)
// calls for, independently of (and in addition to) the pre-existing
// F05/F04-labeled tests in this same file's sibling, preview.test.ts.

test('F10-1: typing "." does not crash and shows inline validation', () => {
  const result = previewDiscount('100.00', 'percentage', '.');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.ok(result.error, 'an incomplete/invalid value must surface a validation message, not throw');
});

test('F10-2: typing "-" does not crash', () => {
  const result = previewDiscount('100.00', 'fixed', '-');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.ok(result.error);
});

test('F10-3: typing "abc" does not crash and shows inline validation', () => {
  const result = previewDiscount('100.00', 'percentage', 'abc');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
  assert.equal(result.error, 'Enter a valid discount number');
});

test('F10-4: typing "12." (a valid, if incomplete-looking, decimal) does not crash', () => {
  const result = previewDiscount('100.00', 'percentage', '12.');
  assert.doesNotThrow(() => previewDiscount('100.00', 'percentage', '12.'));
  // decimal.js parses a trailing-dot string like "12." as 12 outright —
  // a legitimate value, not an error state, so this calculates normally.
  assert.equal(result.error, null);
  assert.equal(result.discountAmount, '12.00');
  assert.equal(result.grandTotal, '88.00');
});

test('F10-4b: typing "0." also does not crash and parses as zero', () => {
  const result = previewDiscount('100.00', 'fixed', '0.');
  assert.equal(result.error, null);
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
});

test('F10-5: typing "12.5" produces a valid calculation', () => {
  const percentage = previewDiscount('100.00', 'percentage', '12.5');
  assert.equal(percentage.error, null);
  assert.equal(percentage.discountAmount, '12.50');
  assert.equal(percentage.grandTotal, '87.50');

  const fixed = previewDiscount('100.00', 'fixed', '12.5');
  assert.equal(fixed.error, null);
  assert.equal(fixed.discountAmount, '12.50');
  assert.equal(fixed.grandTotal, '87.50');
});

test('F10-6: clearing the field back to empty does not crash and clears any error', () => {
  const result = previewDiscount('100.00', 'percentage', '');
  assert.equal(result.error, null, 'an untouched/cleared field is not an error state');
  assert.equal(result.discountAmount, '0.00');
  assert.equal(result.grandTotal, '100.00');
});

test('F10-7: percentage discount validation still works (negative, over 100)', () => {
  const negative = previewDiscount('100.00', 'percentage', '-10');
  assert.equal(negative.error, 'Discount cannot be negative');

  const overHundred = previewDiscount('100.00', 'percentage', '150');
  assert.match(overHundred.error ?? '', /between 0 and 100/);

  const valid = previewDiscount('100.00', 'percentage', '25');
  assert.equal(valid.error, null);
  assert.equal(valid.discountAmount, '25.00');
});

test('F10-8: fixed discount validation still works (negative, over subtotal)', () => {
  const negative = previewDiscount('100.00', 'fixed', '-10');
  assert.equal(negative.error, 'Discount cannot be negative');

  const overSubtotal = previewDiscount('100.00', 'fixed', '150');
  assert.match(overSubtotal.error ?? '', /exceed the subtotal/);

  const valid = previewDiscount('100.00', 'fixed', '25.00');
  assert.equal(valid.error, null);
  assert.equal(valid.discountAmount, '25.00');
});

test('F10-9: F04 authoritative rounding behavior is unchanged by this input-safety fix', () => {
  // The exact F04 half-cent case: discountAmount must be rounded once,
  // then grandTotal derived from that rounded value — never two
  // independently-rounded halves that can disagree with the subtotal.
  const result = previewDiscount('1.01', 'percentage', '50');
  assert.equal(result.discountAmount, '0.51');
  assert.equal(result.grandTotal, '0.50');
  assert.equal((Number(result.discountAmount) + Number(result.grandTotal)).toFixed(2), '1.01');
});

test('F10: a sweep of every intermediate/invalid typing state across both discount types never throws', () => {
  const typingStates = ['', '.', '-', 'abc', '0.', '12.', '12.5', '-5', '--', '1.2.3', 'NaN', 'Infinity', '   '];
  const types: ('percentage' | 'fixed')[] = ['percentage', 'fixed'];
  for (const discountType of types) {
    for (const raw of typingStates) {
      assert.doesNotThrow(() => previewDiscount('250.00', discountType, raw), `type=${discountType} raw=${JSON.stringify(raw)}`);
    }
  }
});
