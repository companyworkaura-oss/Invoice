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

test('buildInvoiceViewModel maps a saved lot number through to the view model', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ lotNumber: 'LOT-2026-145' }), company, customer);
  assert.equal(viewModel.lotNumber, 'LOT-2026-145');
});

test('buildInvoiceViewModel maps a null lot number as null, not an empty string', () => {
  const viewModel = buildInvoiceViewModel(baseInvoice({ lotNumber: null }), company, customer);
  assert.equal(viewModel.lotNumber, null);
});
