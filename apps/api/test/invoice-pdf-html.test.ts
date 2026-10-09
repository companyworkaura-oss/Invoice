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
  customerLotNumber: 'CUST-458',
  billNumber: '4587',
  gatePassNumber: 'GP-4587',
  generalQuantity: '504',
  sets: '6',
  showItemQuantity: true,
  showUnitAmount: true,
  items: [
    {
      id: 'item-1',
      description: 'HS/HP embroidery',
      quantity: '10.00',
      stitches: 12000,
      unitAmount: '14.40',
      amount: '144.00',
    },
  ],
  subtotal: '144.00',
  discountType: null,
  discountValue: '0.00',
  discountLabel: 'Discount',
  discountAmount: '0.00',
  grandTotal: '144.00',
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
  assert.match(html, /Lot #: CUST-458/);
  assert.match(html, /Bill #: 4587/);
  assert.match(html, /Gate Pass #: GP-4587/);
  assert.match(html, /Quantity: 504 Suits/);
  assert.match(html, /Sets: 6/);
  // The spec'd summary fields, by label.
  assert.match(html, /Subtotal/);
  assert.match(html, /Grand Total/);
  assert.match(html, /Previous Balance/);
  assert.match(html, /Amount Paid/);
  assert.match(html, /Current Balance/);
});

test('hides the Lot # row entirely when customerLotNumber is null, across every theme', () => {
  const noLot = { ...viewModel, customerLotNumber: null };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noLot, null);
    assert.ok(!html.includes('Lot #'), `${id} theme must not show a Lot # row when customerLotNumber is null`);
  }
});

test('shows the Lot # row for every theme when a customer lot number is set', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.match(html, /Lot #: CUST-458/, `${id} theme must show the customer lot number`);
  }
});

test('never shows the internal lot number on print/PDF, even disguised as the customer lot number value', () => {
  // The view model type has no field for the internal lot number at
  // all (see InvoiceViewModel in invoice-view-model.ts), so this proves
  // the HTML layer never has the chance to render it — there's nothing
  // named "lotNumber" to accidentally read.
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.ok(!html.includes('INTERNAL-'), `${id} theme must never render anything that looks like an internal lot number`);
  }
});

test('hides the Bill # row entirely when billNumber is null, across every theme', () => {
  const noBill = { ...viewModel, billNumber: null };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noBill, null);
    assert.ok(!html.includes('Bill #'), `${id} theme must not show a Bill # row when billNumber is null`);
  }
});

test('hides the Gate Pass # row entirely when gatePassNumber is null, across every theme', () => {
  const noGatePass = { ...viewModel, gatePassNumber: null };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noGatePass, null);
    assert.ok(!html.includes('Gate Pass #'), `${id} theme must not show a Gate Pass # row when gatePassNumber is null`);
  }
});

test('shows the Gate Pass # row for every theme when a gate pass number is set', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.match(html, /Gate Pass #: GP-4587/, `${id} theme must show the gate pass number`);
  }
});

test('hides the Quantity/Sets metadata rows entirely when generalQuantity is null, across every theme', () => {
  const noQty = { ...viewModel, generalQuantity: null, sets: null };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noQty, null);
    assert.ok(!html.includes('Suits'), `${id} theme must not show a Quantity metadata row when generalQuantity is null`);
    assert.ok(!html.includes('Sets:'), `${id} theme must not show a Sets row when generalQuantity is null`);
  }
});

test('shows the Quantity/Sets metadata rows for every theme when a general quantity is set', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.match(html, /Quantity: 504 Suits/, `${id} theme must show the general quantity`);
    assert.match(html, /Sets: 6/, `${id} theme must show the derived sets`);
  }
});

test('Show Unit Amount OFF hides the Unit Amount column entirely (header and every row), across every theme', () => {
  const noUnitAmount = { ...viewModel, showUnitAmount: false };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noUnitAmount, null);
    assert.ok(!html.includes('Unit Amount'), `${id} theme must not show a Unit Amount column when showUnitAmount is false`);
    // The unit amount VALUE must also be gone, not just relabeled — 14.40 never appears when hidden (144.00 still legitimately does, as Amount).
    assert.ok(!html.includes('>14.40<'), `${id} theme must not render the unit amount value when hidden`);
  }
});

test('Show Item Quantity OFF hides the Quantity column entirely (header and every row), across every theme', () => {
  const noItemQuantity = { ...viewModel, showItemQuantity: false };
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), noItemQuantity, null);
    assert.ok(!html.includes('<th class="num">Quantity</th>'), `${id} theme must not show a Quantity column when showItemQuantity is false`);
    assert.ok(!html.includes('>10.00<'), `${id} theme must not render the item quantity value when hidden`);
  }
});

test('both toggles ON: Description | Quantity | Stitches | Unit Amount | Amount', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: true, showUnitAmount: true }, null);
  assert.match(html, /<th>Description<\/th>\s*<th class="num">Quantity<\/th>\s*<th class="num">Stitches<\/th>\s*<th class="num">Unit Amount<\/th>\s*<th class="num">Amount<\/th>/);
});

test('Unit Amount OFF only: Description | Quantity | Stitches | Amount', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: true, showUnitAmount: false }, null);
  assert.match(html, /<th>Description<\/th>\s*<th class="num">Quantity<\/th>\s*<th class="num">Stitches<\/th>\s*<th class="num">Amount<\/th>/);
});

test('Item Quantity OFF only: Description | Stitches | Unit Amount | Amount', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: false, showUnitAmount: true }, null);
  assert.match(html, /<th>Description<\/th>\s*<th class="num">Stitches<\/th>\s*<th class="num">Unit Amount<\/th>\s*<th class="num">Amount<\/th>/);
});

test('both toggles OFF: Description | Stitches | Amount', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: false, showUnitAmount: false }, null);
  assert.match(html, /<th>Description<\/th>\s*<th class="num">Stitches<\/th>\s*<th class="num">Amount<\/th>/);
});

test('toggling either display flag never changes any item or total figure — display-only, calculations are identical', () => {
  const shown = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: true, showUnitAmount: true }, null);
  const hidden = renderInvoiceHtml(getPdfTheme('classic-navy'), { ...viewModel, showItemQuantity: false, showUnitAmount: false }, null);
  for (const html of [shown, hidden]) {
    assert.match(html, /144\.00/); // subtotal/amount unchanged regardless of what's visible
    assert.match(html, /Grand Total/);
  }
});

test('renders each item row with its own quantity, next to Description', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.match(html, /<th class="num">Quantity<\/th>/);
  // Quantity column comes before Stitches in the header row.
  const quantityIdx = html.indexOf('<th class="num">Quantity</th>');
  const stitchesIdx = html.indexOf('<th class="num">Stitches</th>');
  assert.ok(quantityIdx > 0 && quantityIdx < stitchesIdx, 'Quantity column must precede Stitches');
  assert.match(html, /<td class="num">10\.00<\/td>/); // this item's own quantity
});

test('renders a Unit Amount column between Stitches and Amount, with the per-piece price', () => {
  const html = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.match(html, /<th class="num">Unit Amount<\/th>/);
  const stitchesIdx = html.indexOf('<th class="num">Stitches</th>');
  const unitAmountIdx = html.indexOf('<th class="num">Unit Amount</th>');
  const amountIdx = html.indexOf('<th class="num">Amount</th>');
  assert.ok(
    stitchesIdx > 0 && stitchesIdx < unitAmountIdx && unitAmountIdx < amountIdx,
    'column order must be Description, Quantity, Stitches, Unit Amount, Amount',
  );
  assert.match(html, /<td class="num">14\.40<\/td>/); // this item's per-piece unit amount
});

test('shows a discount row only when a discount applies, and hides it entirely when zero', () => {
  const discounted = {
    ...viewModel,
    discountType: 'percentage' as const,
    discountValue: '10',
    discountLabel: 'Discount (10%)',
    discountAmount: '14.40',
    grandTotal: '129.60',
  };
  const withDiscount = renderInvoiceHtml(getPdfTheme('classic-navy'), discounted, null);
  assert.match(withDiscount, /Discount \(10%\)/);
  assert.match(withDiscount, /-14\.40/);
  assert.match(withDiscount, /129\.60/);

  const withoutDiscount = renderInvoiceHtml(getPdfTheme('classic-navy'), viewModel, null);
  assert.ok(!withoutDiscount.includes('Discount'), 'no discount row when discountType is null');
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

test('never renders the internal embroidery rate, even though it drove the amount', () => {
  for (const id of Object.keys(PDF_THEMES)) {
    const html = renderInvoiceHtml(getPdfTheme(id), viewModel, null);
    assert.ok(!/\bRate\b/.test(html), `${id} theme must not have a Rate column/label`);
    // The rate value itself ('1.20') must not leak in either, distinct
    // from the amount ('144.00') which legitimately does appear.
    assert.ok(!html.includes('>1.20<'), `${id} theme must not render the rate value`);
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
