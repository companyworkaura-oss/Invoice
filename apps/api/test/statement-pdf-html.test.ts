import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CustomerStatement } from '../src/modules/ledger/statement.service.js';
import { renderStatementHtml } from '../src/modules/ledger/pdf/render-statement-html.js';

// Fast, no-Chromium unit tests for the HTML a statement PDF is rendered
// from — mirrors invoice-pdf-html.test.ts. The full pipeline (actually
// producing a PDF) is covered separately in statement.test.ts.

const statement: CustomerStatement = {
  customerId: 'cust-1',
  customerName: 'Ada Lovelace',
  from: '2026-01-01',
  to: '2026-01-31',
  openingBalance: '0.00',
  invoiceTotal: '144.00',
  payments: '50.00',
  closingBalance: '94.00',
  entries: [
    {
      id: 'entry-1',
      date: '2026-01-10',
      type: 'INVOICE',
      reference: 'INV-000042',
      description: 'Invoice INV-000042',
      debit: '144.00',
      credit: '0.00',
      runningBalance: '144.00',
    },
    {
      id: 'entry-2',
      date: '2026-01-20',
      type: 'PAYMENT',
      reference: 'Cash',
      description: 'Payment (cash)',
      debit: '0.00',
      credit: '50.00',
      runningBalance: '94.00',
    },
  ],
};

test('renders the statement data', () => {
  const html = renderStatementHtml({ name: 'Golden Needle Co' }, statement, null);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Golden Needle Co/);
  assert.match(html, /Ada Lovelace/);
  assert.match(html, /INV-000042/);
  assert.match(html, /144\.00/);
  assert.match(html, /94\.00/);
  assert.match(html, /Opening Balance/);
  assert.match(html, /Closing Balance/);
});

test('embeds a provided logo data URI and omits the <img> entirely when there is none', () => {
  const withLogo = renderStatementHtml({ name: 'Golden Needle Co' }, statement, 'data:image/png;base64,AAAA');
  assert.match(withLogo, /<img class="logo" src="data:image\/png;base64,AAAA"/);

  const withoutLogo = renderStatementHtml({ name: 'Golden Needle Co' }, statement, null);
  assert.ok(!withoutLogo.includes('<img class="logo"'));
});

test('escapes HTML in customer name, company name, and ledger description/reference text', () => {
  const malicious: CustomerStatement = {
    ...statement,
    customerName: '<script>alert("customer")</script>',
    entries: [
      {
        ...statement.entries[0],
        reference: '<img src=x onerror=alert(1)>',
        description: '"><script>alert("desc")</script>',
      },
    ],
  };
  const html = renderStatementHtml({ name: '<b>Evil Co</b>' }, malicious, null);

  assert.ok(!html.includes('<script>alert("customer")</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<script>alert("desc")</script>'));
  assert.ok(!html.includes('<b>Evil Co</b>'));

  assert.match(html, /&lt;script&gt;alert\(&quot;customer&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;Evil Co&lt;\/b&gt;/);
});

test('a dash reference/description renders as an em dash placeholder, not empty markup injection', () => {
  const noReference: CustomerStatement = {
    ...statement,
    entries: [{ ...statement.entries[0], reference: null, description: null }],
  };
  const html = renderStatementHtml({ name: 'Golden Needle Co' }, noReference, null);
  assert.match(html, /<td>—<\/td>/);
});

test('is sized for A4 (210mm) and marks rows as break-inside: avoid', () => {
  const html = renderStatementHtml({ name: 'Golden Needle Co' }, statement, null);
  assert.match(html, /width:\s*210mm/);
  assert.match(html, /break-inside:\s*avoid/);
});
