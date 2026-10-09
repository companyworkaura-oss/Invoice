import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatNumber } from '../src/number-format.js';

// Display/editing formatter for a numeric(12,2) column's own padded
// string (e.g. "787871.00") — never changes the underlying value, only
// trims insignificant trailing zeros. See QuickInvoiceForm.tsx's edit
// prefill, where this fixes the "787871.00" / "789.00" display bug.

test('trims a whole-number value down to a plain integer', () => {
  assert.equal(formatNumber('504.00'), '504');
  assert.equal(formatNumber('787871.00'), '787871');
  assert.equal(formatNumber('789.00'), '789');
});

test('trims a single meaningful trailing zero, keeping the real decimal', () => {
  assert.equal(formatNumber('504.50'), '504.5');
});

test('leaves a value with two meaningful decimal digits untouched', () => {
  assert.equal(formatNumber('1.25'), '1.25');
  assert.equal(formatNumber('375.41'), '375.41');
});

test('never rounds — the numeric value is unchanged, only the trailing-zero formatting', () => {
  assert.equal(Number(formatNumber('504.00')), 504);
  assert.equal(Number(formatNumber('504.50')), 504.5);
  assert.equal(Number(formatNumber('1.25')), 1.25);
});

test('passes through an empty string and a non-numeric value unchanged, never throwing', () => {
  assert.equal(formatNumber(''), '');
  assert.equal(formatNumber('not-a-number'), 'not-a-number');
});
