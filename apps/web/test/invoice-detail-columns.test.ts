import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceItemColumnsForMode } from '../src/features/invoices/invoice-detail-columns.js';

// UI/UX-07 Part 9: InvoiceDetails' item-table columns are decided
// purely from the invoice's own server-computed invoiceMode — never
// inferred from whether an item happens to carry a categoryId.

test('a Quick invoice hides Category and Stitches, and shows the simpler column set', () => {
  const columns = invoiceItemColumnsForMode('quick');
  assert.deepEqual(columns, ['description', 'quantity', 'unitAmount', 'total']);
  assert.ok(!columns.includes('category'));
  assert.ok(!columns.includes('stitches'));
  assert.ok(!columns.includes('rate'));
});

test('a Standard invoice keeps every embroidery-specific column', () => {
  const columns = invoiceItemColumnsForMode('standard');
  assert.deepEqual(columns, ['category', 'description', 'quantity', 'stitches', 'rate', 'unitAmount', 'total']);
  assert.ok(columns.includes('category'));
  assert.ok(columns.includes('stitches'));
  assert.ok(columns.includes('rate'));
});
