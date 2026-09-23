import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvoiceViewModel } from '@invoice/shared';
import { getPdfTheme, PDF_THEMES } from '../src/modules/invoices/pdf/themes.js';
import { renderInvoiceHtml } from '../src/modules/invoices/pdf/render-html.js';

// Fast, no-Chromium unit tests for the HTML the PDF is rendered from —
// covers "no formula/calculation internals" and "uses saved snapshots"
// without paying for a browser launch. The full pipeline (actually
// producing a PDF) is covered separately in invoice-pdf.test.ts.

const viewModel: InvoiceViewModel = {
  company: {
    name: 'Golden Needle Co',
    factoryName: 'Golden Needle Factory',
    logoUrl: null,
    address: '1 Mill Road',
    phone: '+1 555 0100',
    whatsapp: null,
    email: 'billing@goldenneedle.example',
    taxNumber: 'TAX-123',
  },
  customer: {
    name: 'Ada Lovelace',
    businessName: 'Lovelace Uniforms',
    address: '2 Analytical Ave',
    phone: '+1 555 0199',
  },
  invoiceNumber: 'INV-000042',
  invoiceDate: '2026-01-15',
  quantity: '10.00',
  items: [
    { id: 'item-1', description: 'HS/HP embroidery', stitches: 12000, rate: '1.20', amount: '144.00' },
  ],
  currentBill: '144.00',
  previousBalance: '50.00',
  amountPaid: '30.00',
  currentBalance: '164.00',
  terms: 'Payment due within 30 days.',
};

test('every PDF theme renders without throwing', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.match(html, /<!doctype html>/i);
  }
});

test('renders the invoice data the customer should see', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.match(html, /Golden Needle Factory/);
  assert.match(html, /INV-000042/);
  assert.match(html, /Lovelace Uniforms/);
  assert.match(html, /HS\/HP embroidery/);
  assert.match(html, /144\.00/);
  assert.match(html, /Payment due within 30 days\./);
  // The five spec'd summary fields, by label.
  assert.match(html, /Current Bill/);
  assert.match(html, /Previous Balance/);
  assert.match(html, /Amount Paid/);
  assert.match(html, /Current Balance/);
});

test('never renders formula/factor/multiplier/divisor or calculation internals', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    // Word-boundary match: "factor" must not appear as its own word, but
    // "Factory" (a legitimate field — the company's factory name) is fine.
    for (const forbidden of ['formula', 'factor', 'multiplier', 'divisor', 'expression', 'calculationinputs']) {
      const re = new RegExp(`\\b${forbidden}\\b`, 'i');
      assert.ok(!re.test(html), `${id} theme must not mention "${forbidden}"`);
    }
  }
});

test('embeds a provided logo data URI and omits the <img> entirely when there is none', () => {
  const withLogo = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, 'data:image/png;base64,AAAA');
  assert.match(withLogo, /<img class="logo" src="data:image\/png;base64,AAAA"/);

  const withoutLogo = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.ok(!withoutLogo.includes('<img class="logo"'));
});

test('escapes HTML in customer-provided text fields', () => {
  const malicious = {
    ...viewModel,
    customer: { ...viewModel.customer, name: '<script>alert(1)</script>', businessName: null },
  };
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), malicious, null);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('is sized for A4 (210mm) and marks rows/summary as break-inside: avoid', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.match(html, /width:\s*210mm/);
  assert.match(html, /break-inside:\s*avoid/);
});

test('getPdfTheme falls back to a default for an unknown or missing template id', () => {
  assert.equal(getPdfTheme('not-a-real-template').id, getPdfTheme(undefined).id);
  assert.equal(getPdfTheme(null).id, getPdfTheme(undefined).id);
});
