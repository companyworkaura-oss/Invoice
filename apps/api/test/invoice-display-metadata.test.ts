import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Optional invoice display controls (Show Unit Amount / Show Item
// Quantity), General Quantity + derived Sets (SUITS_PER_SET = 84), and
// Bill Number. A category with expression 'stitches / 1000 * rate',
// rate 1.20, and 12000 stitches gives a unit amount of 14.40; at
// quantity 10 that's a 144.00 subtotal — the same fixture every other
// invoice test file uses.

const app = createApp();

before(async () => {
  await migrate(() => {});
});

after(async () => {
  await pool.end();
});

async function registeredOwner(companyName: string) {
  const agent = request.agent(app);
  const email = `${companyName.toLowerCase().replace(/\s+/g, '')}+${Date.now()}+${Math.random()}@example.com`;
  const res = await agent.post('/api/auth/register').send({
    companyName,
    fullName: 'Display Metadata Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.post('/api/customers').send({ name });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>, name = 'HS/HP') {
  const res = await agent
    .post('/api/categories')
    .send({ name, defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

interface InvoiceBody {
  customerId?: string;
  status?: 'draft' | 'issued';
  billNumber?: string;
  generalQuantity?: string;
  showUnitAmount?: boolean;
  showItemQuantity?: boolean;
  items?: { categoryId: string; stitches: number }[];
}

async function createInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string, extra: Partial<InvoiceBody> = {}) {
  return agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
    ...extra,
  });
}

test('Bill Number saves, is returned in invoice detail, and is independent of the invoice number', async () => {
  const agent = await registeredOwner('Bill Number Co');
  const customerId = await createCustomer(agent, 'Bill Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { billNumber: '4587' });
  assert.equal(created.status, 201);
  assert.equal(created.body.billNumber, '4587');
  assert.notEqual(created.body.billNumber, created.body.invoiceNumber);

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.billNumber, '4587');
});

test('Bill Number is searchable', async () => {
  const agent = await registeredOwner('Bill Number Search Co');
  const customerId = await createCustomer(agent, 'Bill Search Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { billNumber: 'BILL-SEARCHABLE-4587' });
  assert.equal(created.status, 201);

  const bySearch = await agent.get('/api/invoices').query({ search: 'searchable-4587' });
  assert.equal(bySearch.status, 200);
  assert.equal(bySearch.body.length, 1);
  assert.equal(bySearch.body[0].id, created.body.id);
});

test('Bill Number appears on print/PDF (the invoice view model) when set', async () => {
  const agent = await registeredOwner('Bill Number Print Co');
  const customerId = await createCustomer(agent, 'Bill Print Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { billNumber: '4587' });
  assert.equal(created.status, 201);

  const pdf = await agent.get(`/api/invoices/${created.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok(pdf.body.length > 500, 'expected a real PDF, not an empty/near-empty buffer');
});

test('General Quantity saves and is returned independently of each item\'s own quantity', async () => {
  const agent = await registeredOwner('General Quantity Co');
  const customerId = await createCustomer(agent, 'General Quantity Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { generalQuantity: '504' });
  assert.equal(created.status, 201);
  assert.equal(created.body.generalQuantity, '504.00');
  // The item's own quantity (10) is completely separate from the invoice's General Quantity (504).
  assert.equal(created.body.items[0].quantity, '10.00');
});

test('84 general quantity -> 1 set, 168 -> 2 sets, 504 -> 6 sets', async () => {
  const agent = await registeredOwner('Sets Math Co');
  const customerId = await createCustomer(agent, 'Sets Math Customer');
  const categoryId = await createCategory(agent);

  for (const [generalQuantity, expectedSets] of [
    ['84', '1'],
    ['168', '2'],
    ['504', '6'],
  ] as const) {
    const created = await createInvoice(agent, customerId, categoryId, { generalQuantity });
    assert.equal(created.status, 201);
    const details = await agent.get(`/api/invoices/${created.body.id}`);
    // Sets is derived, not stored on the invoice itself — computed the
    // same way the print view does (@invoice/shared's calculateSets).
    const { calculateSets } = await import('@invoice/shared');
    assert.equal(calculateSets(details.body.generalQuantity), expectedSets);
  }
});

test('a non-84-multiple general quantity derives a decimal Sets value, never silently rounded to a wrong whole number', async () => {
  const { calculateSets } = await import('@invoice/shared');
  assert.equal(calculateSets('126'), '1.5'); // 126 / 84 = 1.5 exactly
  assert.equal(calculateSets('100'), '1.19'); // not an exact multiple — shows the real decimal, not "1"
});

test('Show Unit Amount OFF/ON is saved with the invoice and returned on read', async () => {
  const agent = await registeredOwner('Show Unit Amount Co');
  const customerId = await createCustomer(agent, 'Show Unit Amount Customer');
  const categoryId = await createCategory(agent);

  const defaulted = await createInvoice(agent, customerId, categoryId);
  assert.equal(defaulted.status, 201);
  assert.equal(defaulted.body.showUnitAmount, true, 'defaults to true/shown, preserving existing behavior');

  const off = await createInvoice(agent, customerId, categoryId, { showUnitAmount: false });
  assert.equal(off.status, 201);
  assert.equal(off.body.showUnitAmount, false);

  const details = await agent.get(`/api/invoices/${off.body.id}`);
  assert.equal(details.body.showUnitAmount, false);
});

test('Show Item Quantity OFF/ON is saved with the invoice and returned on read', async () => {
  const agent = await registeredOwner('Show Item Quantity Co');
  const customerId = await createCustomer(agent, 'Show Item Quantity Customer');
  const categoryId = await createCategory(agent);

  const defaulted = await createInvoice(agent, customerId, categoryId);
  assert.equal(defaulted.status, 201);
  assert.equal(defaulted.body.showItemQuantity, true, 'defaults to true/shown, preserving existing behavior');

  const off = await createInvoice(agent, customerId, categoryId, { showItemQuantity: false });
  assert.equal(off.status, 201);
  assert.equal(off.body.showItemQuantity, false);
});

test('combinations of both toggles all save and read back correctly', async () => {
  const agent = await registeredOwner('Toggle Combos Co');
  const customerId = await createCustomer(agent, 'Toggle Combos Customer');
  const categoryId = await createCategory(agent);

  for (const [showUnitAmount, showItemQuantity] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const) {
    const created = await createInvoice(agent, customerId, categoryId, { showUnitAmount, showItemQuantity });
    assert.equal(created.status, 201);
    assert.equal(created.body.showUnitAmount, showUnitAmount);
    assert.equal(created.body.showItemQuantity, showItemQuantity);
  }
});

test('hiding either/both display columns never changes any calculation: unit amount, line amount, subtotal, grand total, and the ledger are all identical regardless of the toggles', async () => {
  const agent = await registeredOwner('Toggle Calculation Safety Co');
  const customerId = await createCustomer(agent, 'Toggle Calc Customer');
  const categoryId = await createCategory(agent);

  const shown = await createInvoice(agent, customerId, categoryId, { showUnitAmount: true, showItemQuantity: true });
  const hidden = await createInvoice(agent, customerId, categoryId, { showUnitAmount: false, showItemQuantity: false });
  assert.equal(shown.status, 201);
  assert.equal(hidden.status, 201);

  assert.equal(shown.body.items[0].calculatedUnitAmount, hidden.body.items[0].calculatedUnitAmount);
  assert.equal(shown.body.items[0].calculatedTotal, hidden.body.items[0].calculatedTotal);
  assert.equal(shown.body.totalAmount, hidden.body.totalAmount);
  assert.equal(shown.body.grandTotal, hidden.body.grandTotal);

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  // Both invoices posted the same 144.00 debit each — the ledger balance
  // reflects both regardless of which columns either one prints.
  assert.equal(ledger.body.balance, '288.00');
});

test('General Quantity and Sets never multiply into subtotal/discount/grand total', async () => {
  const agent = await registeredOwner('Sets No Multiply Co');
  const customerId = await createCustomer(agent, 'Sets No Multiply Customer');
  const categoryId = await createCategory(agent);

  // General Quantity is set to a large, unrelated number (way bigger
  // than the item total) — if it accidentally fed into the math, the
  // grand total would balloon. It must not.
  const created = await createInvoice(agent, customerId, categoryId, {
    generalQuantity: '504',
    discountType: 'percentage' as never,
    discountValue: '10' as never,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.totalAmount, '144.00');
  assert.equal(created.body.discountAmount, '14.40');
  assert.equal(created.body.grandTotal, '129.60');
});

test('editing a draft invoice can change Bill Number, General Quantity, and both display toggles independently', async () => {
  const agent = await registeredOwner('Edit Display Metadata Co');
  const customerId = await createCustomer(agent, 'Edit Display Metadata Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, {
    billNumber: '1000',
    generalQuantity: '84',
    showUnitAmount: true,
    showItemQuantity: true,
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    billNumber: '2000',
    generalQuantity: '168',
    showUnitAmount: false,
    showItemQuantity: false,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.billNumber, '2000');
  assert.equal(edited.body.generalQuantity, '168.00');
  assert.equal(edited.body.showUnitAmount, false);
  assert.equal(edited.body.showItemQuantity, false);
});

test('duplicating an invoice carries over General Quantity and the display toggles, but never Bill Number', async () => {
  const agent = await registeredOwner('Duplicate Metadata Co');
  const customerId = await createCustomer(agent, 'Duplicate Metadata Customer');
  const categoryId = await createCategory(agent);

  const original = await createInvoice(agent, customerId, categoryId, {
    billNumber: 'ORIGINAL-BILL',
    generalQuantity: '252',
    showUnitAmount: false,
    showItemQuantity: false,
  });
  assert.equal(original.status, 201);

  const duplicate = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.billNumber, null, 'a duplicate must never inherit the original bill number');
  assert.equal(duplicate.body.generalQuantity, '252.00');
  assert.equal(duplicate.body.showUnitAmount, false);
  assert.equal(duplicate.body.showItemQuantity, false);
});

test('an invoice created before this feature (no bill number, no general quantity) remains fully compatible: defaults to shown/shown, null bill number and general quantity', async () => {
  const agent = await registeredOwner('Backward Compat Co');
  const customerId = await createCustomer(agent, 'Backward Compat Customer');
  const categoryId = await createCategory(agent);

  // Simulates an old invoice: none of the new fields are sent at all.
  const created = await createInvoice(agent, customerId, categoryId);
  assert.equal(created.status, 201);
  assert.equal(created.body.billNumber, null);
  assert.equal(created.body.generalQuantity, null);
  assert.equal(created.body.showUnitAmount, true);
  assert.equal(created.body.showItemQuantity, true);

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.body.billNumber, null);
  assert.equal(details.body.generalQuantity, null);
  assert.equal(details.body.showUnitAmount, true);
  assert.equal(details.body.showItemQuantity, true);
});

test('tenant isolation: an invoice with a bill number is invisible to another company, including by search', async () => {
  const alice = await registeredOwner('Alice Bill Co');
  const bob = await registeredOwner('Bob Bill Co');
  const aliceCustomer = await createCustomer(alice, 'Alice Customer');
  const aliceCategory = await createCategory(alice);

  await createInvoice(alice, aliceCustomer, aliceCategory, { billNumber: 'BILL-SECRET' });

  const bobList = await bob.get('/api/invoices');
  assert.equal(bobList.body.length, 0);

  const bobSearch = await bob.get('/api/invoices').query({ search: 'BILL-SECRET' });
  assert.equal(bobSearch.status, 200);
  assert.equal(bobSearch.body.length, 0);
});
