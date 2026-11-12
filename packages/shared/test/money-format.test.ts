import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney } from '../src/money-format.js';

// UI/UX-05: formatMoney adds thousands grouping and an optional
// currency prefix on top of formatNumber's existing trim rule, without
// changing that rule — it never forces a trailing ".00" formatNumber
// would otherwise trim.

test('adds thousands separators to a whole number', () => {
  assert.equal(formatMoney('49500.00'), '49,500');
  assert.equal(formatMoney('1000'), '1,000');
});

test('keeps meaningful decimals while grouping the integer part', () => {
  // formatNumber's existing trim rule still applies underneath: a
  // single meaningful trailing digit after the decimal point is kept,
  // never padded back to two — see number-format.test.ts.
  assert.equal(formatMoney('12500.50'), '12,500.5');
  assert.equal(formatMoney('12500.55'), '12,500.55');
});

test('small values need no grouping', () => {
  assert.equal(formatMoney('504.00'), '504');
  assert.equal(formatMoney('42'), '42');
});

test('handles a negative balance', () => {
  assert.equal(formatMoney('-1234.00'), '-1,234');
});

test('prefixes the currency code when given', () => {
  assert.equal(formatMoney('49500.00', 'PKR'), 'PKR 49,500');
  assert.equal(formatMoney('12500.55', 'PKR'), 'PKR 12,500.55');
});

test('omits the currency prefix when none is given', () => {
  assert.equal(formatMoney('49500.00'), '49,500');
  assert.equal(formatMoney('49500.00', undefined), '49,500');
});

test('leaves a blank/invalid value untouched, same as formatNumber', () => {
  assert.equal(formatMoney(''), '');
});
