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
