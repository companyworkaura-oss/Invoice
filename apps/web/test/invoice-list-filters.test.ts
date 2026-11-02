import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_ARCHIVED_FILTER,
  parseInvoiceListFilters,
  withInvoiceListFilterPatch,
} from '../src/features/invoices/invoice-list-filters.js';

// UI/UX-03 Part 3: InvoiceList's filters live entirely in the URL's
// query string — these two pure functions are the whole translation
// layer, so "URL filter restoration" (Scenario A's exact mechanism)
// is testable without rendering the list or a browser at all.

test('UI/UX-03: an empty query string parses to every filter at its default', () => {
  const filters = parseInvoiceListFilters(new URLSearchParams(''));
  assert.deepEqual(filters, {
    search: '',
    customerId: '',
    from: '',
    to: '',
    paymentStatus: '',
    archived: DEFAULT_ARCHIVED_FILTER,
  });
});

test('UI/UX-03: a populated query string (Scenario A: search=Bilal&status=UNPAID) parses back exactly', () => {
  const filters = parseInvoiceListFilters(new URLSearchParams('search=Bilal&status=UNPAID'));
  assert.equal(filters.search, 'Bilal');
  assert.equal(filters.paymentStatus, 'UNPAID');
  assert.equal(filters.archived, DEFAULT_ARCHIVED_FILTER, 'an unset view= still defaults to active');
});

test('UI/UX-03: view=archived and view=all round-trip, not just the default', () => {
  assert.equal(parseInvoiceListFilters(new URLSearchParams('view=archived')).archived, 'archived');
  assert.equal(parseInvoiceListFilters(new URLSearchParams('view=all')).archived, 'all');
});

test('UI/UX-03: applying a patch sets a non-empty value', () => {
  const next = withInvoiceListFilterPatch(new URLSearchParams(''), { search: 'Bilal' });
  assert.equal(next.get('search'), 'Bilal');
});

test('UI/UX-03: applying an empty-string patch removes that key instead of writing it blank', () => {
  const next = withInvoiceListFilterPatch(new URLSearchParams('search=Bilal'), { search: '' });
  assert.equal(next.has('search'), false);
  assert.equal(next.toString(), '');
});

test('UI/UX-03: a patch to one key never disturbs any other already-set filter', () => {
  const start = new URLSearchParams('search=Bilal&status=UNPAID&view=archived');
  const next = withInvoiceListFilterPatch(start, { status: 'PAID' });
  assert.equal(next.get('search'), 'Bilal');
  assert.equal(next.get('view'), 'archived');
  assert.equal(next.get('status'), 'PAID');
});

test('UI/UX-03: withInvoiceListFilterPatch never mutates the URLSearchParams it was given', () => {
  const start = new URLSearchParams('search=Bilal');
  const next = withInvoiceListFilterPatch(start, { search: 'Ahmed' });
  assert.equal(start.get('search'), 'Bilal', 'the original instance is untouched');
  assert.equal(next.get('search'), 'Ahmed');
});

test('UI/UX-03: the full Scenario A filter set (search + status + archived view) composes correctly', () => {
  let params = new URLSearchParams('');
  params = withInvoiceListFilterPatch(params, { search: 'Bilal' });
  params = withInvoiceListFilterPatch(params, { status: 'UNPAID' });
  const filters = parseInvoiceListFilters(params);
  assert.equal(filters.search, 'Bilal');
  assert.equal(filters.paymentStatus, 'UNPAID');
  assert.equal(filters.archived, 'active');
});
