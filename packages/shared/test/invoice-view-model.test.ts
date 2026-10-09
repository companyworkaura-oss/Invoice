import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvoiceViewModel } from '../src/invoice-view-model.js';
import type { CompanyProfile, Customer, InvoiceWithItems } from '../src/entities.js';

const company: CompanyProfile = {
  id: 'company-1',
  name: 'Golden Needle Co',
  defaultCurrency: 'USD',
  factoryName: 'Golden Needle Factory',
  ownerName: 'Jane Doe',
  logoUrl: null,
  phone: '+1 555 0100',
  whatsapp: null,
  email: 'billing@goldenneedle.example',
  address: '1 Mill Road',
  taxNumber: 'TAX-123',
  invoicePrefix: 'INV',
  defaultInvoiceTemplate: 'classic-navy',
  invoiceTerms: 'Payment due within 30 days.',
};

const customer: Customer = {
  id: 'customer-1',
  companyId: 'company-1',
  name: 'Ada Lovelace',
  businessName: 'Lovelace Uniforms',
  phone: '+1 555 0199',
  whatsapp: null,
  address: '2 Analytical Ave',
  openingBalance: '0.00',
  notes: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function baseInvoice(overrides: Partial<InvoiceWithItems> = {}): InvoiceWithItems {
  return {
    id: 'invoice-1',
    companyId: 'company-1',
    customerId: 'customer-1',
    customerName: 'Ada Lovelace',
    invoiceNumber: 'INV-000042',
    invoiceDate: '2026-01-15',
    notes: null,
    status: 'draft',
    createdAt: '2026-01-15T00:00:00.000Z',
    lotNumber: null,
    customerLotNumber: null,
    billNumber: null,
    gatePassNumber: null,
    generalQuantity: null,
    showUnitAmount: true,
    showItemQuantity: true,
    discountType: null,
    discountValue: '0.00',
    discountAmount: '0.00',
    archivedAt: null,
    items: [
      {
        id: 'item-1',
        invoiceId: 'invoice-1',
        categoryId: 'category-1',
        categoryName: 'HS/HP',
        description: null,
        stitches: 12000,
        quantity: '10.00',
        rate: '1.20',
        formulaType: 'expression',
        formulaConfig: { expression: 'stitches / 1000 * rate' },
        calculationInputs: { stitches: 12000, rate: '1.20', quantity: '10.00' },
        calculatedUnitAmount: '14.40',
        calculatedTotal: '144.00',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    ],
    totalAmount: '144.00',
    grandTotal: '144.00',
    previousBalance: '0.00',
    totalReceivable: '144.00',
    amountPaid: '0.00',
    currentBalance: '144.00',
    ...overrides,
  };
}

test('buildInvoiceViewModel maps a saved customer lot number through to the view model', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ customerLotNumber: 'CUST-458' }), company, customer);
  assert.equal(viewModel.customerLotNumber, 'CUST-458');
});

test('buildInvoiceViewModel maps a null customer lot number as null, not an empty string', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ customerLotNumber: null }), company, customer);
  assert.equal(viewModel.customerLotNumber, null);
});

test('buildInvoiceViewModel never leaks the internal lot number — the view model has no field for it at all', () => {
  const viewModel = buildInvoiceViewModel(
    baseInvoice({ lotNumber: 'INTERNAL-999', customerLotNumber: null }),
    company,
    customer,
  );
  assert.ok(!('lotNumber' in viewModel), 'InvoiceViewModel must not carry the internal lot number under any key');
  assert.equal(viewModel.customerLotNumber, null, 'must not fall back to the internal lot number when customer lot number is empty');
  assert.ok(!JSON.stringify(viewModel).includes('INTERNAL-999'), 'the internal lot number value must never appear anywhere in the view model');
});

test('buildInvoiceViewModel maps a saved bill number through to the view model', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ billNumber: '4587' }), company, customer);
  assert.equal(viewModel.billNumber, '4587');
});

test('buildInvoiceViewModel maps a null bill number as null', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ billNumber: null }), company, customer);
  assert.equal(viewModel.billNumber, null);
});

test('buildInvoiceViewModel maps a saved gate pass number through to the view model', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ gatePassNumber: 'GP-4587' }), company, customer);
  assert.equal(viewModel.gatePassNumber, 'GP-4587');
});

test('buildInvoiceViewModel maps a null gate pass number as null', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ gatePassNumber: null }), company, customer);
  assert.equal(viewModel.gatePassNumber, null);
});

test('buildInvoiceViewModel derives Sets from General Quantity using SUITS_PER_SET = 84', () => {
  assert.equal(buildInvoiceViewModel(baseInvoice({ generalQuantity: '84' }), company, customer).sets, '1');
  assert.equal(buildInvoiceViewModel(baseInvoice({ generalQuantity: '168' }), company, customer).sets, '2');
  assert.equal(buildInvoiceViewModel(baseInvoice({ generalQuantity: '504' }), company, customer).sets, '6');
});

test('buildInvoiceViewModel shows a decimal Sets value, not a wrongly-rounded whole number, for a non-84-multiple', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ generalQuantity: '126' }), company, customer);
  assert.equal(viewModel.sets, '1.5');
});

test('buildInvoiceViewModel leaves generalQuantity and sets null when no general quantity was saved', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ generalQuantity: null }), company, customer);
  assert.equal(viewModel.generalQuantity, null);
  assert.equal(viewModel.sets, null);
});

test('buildInvoiceViewModel passes the showUnitAmount/showItemQuantity display toggles through unchanged', () => {
  const bothOn = buildInvoiceViewModel(baseInvoice({ showUnitAmount: true, showItemQuantity: true }), company, customer);
  assert.equal(bothOn.showUnitAmount, true);
  assert.equal(bothOn.showItemQuantity, true);

  const bothOff = buildInvoiceViewModel(baseInvoice({ showUnitAmount: false, showItemQuantity: false }), company, customer);
  assert.equal(bothOff.showUnitAmount, false);
  assert.equal(bothOff.showItemQuantity, false);
});

test('hiding showUnitAmount/showItemQuantity never changes any item or total figure — display-only', () => {
  const shown = buildInvoiceViewModel(baseInvoice({ showUnitAmount: true, showItemQuantity: true }), company, customer);
  const hidden = buildInvoiceViewModel(baseInvoice({ showUnitAmount: false, showItemQuantity: false }), company, customer);
  assert.equal(shown.items[0].unitAmount, hidden.items[0].unitAmount);
  assert.equal(shown.items[0].quantity, hidden.items[0].quantity);
  assert.equal(shown.items[0].amount, hidden.items[0].amount);
  assert.equal(shown.subtotal, hidden.subtotal);
  assert.equal(shown.grandTotal, hidden.grandTotal);
});

test('buildInvoiceViewModel maps the saved calculatedUnitAmount as unitAmount, not a re-derived value', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice(), company, customer);
  assert.equal(viewModel.items[0].unitAmount, '14.40'); // the item's saved calculatedUnitAmount
  assert.equal(viewModel.items[0].amount, '144.00'); // unchanged: still the saved calculatedTotal
});

test('buildInvoiceViewModel falls back to total/quantity, safely, when calculatedUnitAmount is missing', () => {
  const invoice = baseInvoice({
    items: [
      {
        id: 'item-1',
        invoiceId: 'invoice-1',
        categoryId: 'category-1',
        categoryName: 'HS/HP',
        description: null,
        stitches: 12000,
        quantity: '10.00',
        rate: '1.20',
        formulaType: 'expression',
        formulaConfig: { expression: 'stitches / 1000 * rate' },
        calculationInputs: { stitches: 12000, rate: '1.20', quantity: '10.00' },
        calculatedUnitAmount: '' as never, // simulate a legacy/invalid row
        calculatedTotal: '144.00',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    ],
  });
  const viewModel = buildInvoiceViewModel(invoice, company, customer);
  assert.equal(viewModel.items[0].unitAmount, '14.40'); // 144.00 / 10 — same derived answer here
});

test('buildInvoiceViewModel never divides by zero — falls back to "0.00" for a zero/missing quantity with no saved unit amount', () => {
  const invoice = baseInvoice({
    items: [
      {
        id: 'item-1',
        invoiceId: 'invoice-1',
        categoryId: 'category-1',
        categoryName: 'HS/HP',
        description: null,
        stitches: 12000,
        quantity: '0',
        rate: '1.20',
        formulaType: 'expression',
        formulaConfig: { expression: 'stitches / 1000 * rate' },
        calculationInputs: { stitches: 12000, rate: '1.20', quantity: '0' },
        calculatedUnitAmount: '' as never,
        calculatedTotal: '0.00',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    ],
  });
  const viewModel = buildInvoiceViewModel(invoice, company, customer);
  assert.equal(viewModel.items[0].unitAmount, '0.00');
});
