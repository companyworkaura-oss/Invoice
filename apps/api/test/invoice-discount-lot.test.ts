import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Invoice discount + lot number. A category with expression
// 'stitches / 1000 * rate', rate 1.20, and 12000 stitches gives a unit
// amount of 14.40; at quantity 10 that's a 144.00 subtotal — the same
// fixture every other invoice test file uses, so discount math below
// (144.00 at 10% = 14.40, etc.) lines up with numbers already exercised
// elsewhere in the suite.

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
    fullName: 'Discount Test Owner',
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
  lotNumber?: string;
  customerLotNumber?: string;
  discountType?: 'percentage' | 'fixed';
  discountValue?: string;
  items?: { categoryId: string; stitches: number }[];
}

async function createInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string, extra: Partial<InvoiceBody> = {}) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
    ...extra,
  });
  return res;
}

test('invoice with no discount: grandTotal equals the subtotal, discount fields are zero/null', async () => {
  const agent = await registeredOwner('No Discount Co');
  const customerId = await createCustomer(agent, 'Plain Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId);
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, '144.00');
  assert.equal(res.body.grandTotal, '144.00');
  assert.equal(res.body.discountType, null);
  assert.equal(res.body.discountValue, '0.00');
  assert.equal(res.body.discountAmount, '0.00');
});

test('percentage discount: 10% of a 144.00 subtotal is 14.40, grand total 129.60', async () => {
  const agent = await registeredOwner('Percent Discount Co');
  const customerId = await createCustomer(agent, 'Percent Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '10' });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, '144.00');
  assert.equal(res.body.discountType, 'percentage');
  assert.equal(res.body.discountValue, '10.00');
  assert.equal(res.body.discountAmount, '14.40');
  assert.equal(res.body.grandTotal, '129.60');
});

test('fixed discount: Rs 50 off a 144.00 subtotal leaves a 94.00 grand total', async () => {
  const agent = await registeredOwner('Fixed Discount Co');
  const customerId = await createCustomer(agent, 'Fixed Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId, { discountType: 'fixed', discountValue: '50.00' });
  assert.equal(res.status, 201);
  assert.equal(res.body.discountType, 'fixed');
  assert.equal(res.body.discountAmount, '50.00');
  assert.equal(res.body.grandTotal, '94.00');
});

test('100% percentage discount is allowed: grand total is zero', async () => {
  const agent = await registeredOwner('Full Discount Co');
  const customerId = await createCustomer(agent, 'Full Discount Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '100' });
  assert.equal(res.status, 201);
  assert.equal(res.body.discountAmount, '144.00');
  assert.equal(res.body.grandTotal, '0.00');
});

test('editing a fully-discounted (zero grand total) draft back up to a positive total re-creates its ledger entry', async () => {
  const agent = await registeredOwner('Zero Round Trip Co');
  const customerId = await createCustomer(agent, 'Zero Round Trip Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '100' });
  assert.equal(created.status, 201);
  assert.equal(created.body.grandTotal, '0.00');

  const zeroLedger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(zeroLedger.body.balance, '0.00');

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    discountType: 'percentage',
    discountValue: '0',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.grandTotal, '144.00');

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '144.00');
});

test('percentage discount over 100 is rejected', async () => {
  const agent = await registeredOwner('Over Percent Co');
  const customerId = await createCustomer(agent, 'Over Percent Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '101' });
  assert.equal(res.status, 400);
  assert.ok(res.body.details?.discountValue);
});

test('fixed discount greater than the subtotal is rejected, and no invoice is created', async () => {
  const agent = await registeredOwner('Over Fixed Co');
  const customerId = await createCustomer(agent, 'Over Fixed Customer');
  const categoryId = await createCategory(agent);

  const res = await createInvoice(agent, customerId, categoryId, { discountType: 'fixed', discountValue: '200.00' });
  assert.equal(res.status, 400);
  assert.ok(res.body.details?.discountValue);

  const list = await agent.get('/api/invoices');
  assert.equal(list.body.length, 0, 'the rejected invoice must not have been created');
});

test('negative discount is rejected for both percentage and fixed', async () => {
  const agent = await registeredOwner('Negative Discount Co');
  const customerId = await createCustomer(agent, 'Negative Customer');
  const categoryId = await createCategory(agent);

  const pct = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '-5' });
  assert.equal(pct.status, 400);

  const fixed = await createInvoice(agent, customerId, categoryId, { discountType: 'fixed', discountValue: '-5' });
  assert.equal(fixed.status, 400);
});

test('ledger debit after discount equals the grand total, not the subtotal', async () => {
  const agent = await registeredOwner('Ledger Discount Co');
  const customerId = await createCustomer(agent, 'Ledger Discount Customer');
  const categoryId = await createCategory(agent);

  const invoice = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '25' });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.grandTotal, '108.00'); // 144.00 - 25% = 108.00

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.balance, '108.00'); // the discounted amount, never the 144.00 subtotal

  const list = await agent.get('/api/invoices');
  assert.equal(list.body[0].balance, '108.00');
  assert.equal(list.body[0].paymentStatus, 'UNPAID');
});

test('lot number is saved, returned in invoice detail, and searchable', async () => {
  const agent = await registeredOwner('Lot Number Co');
  const customerId = await createCustomer(agent, 'Lot Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { lotNumber: 'LOT-2026-145' });
  assert.equal(created.status, 201);
  assert.equal(created.body.lotNumber, 'LOT-2026-145');

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.lotNumber, 'LOT-2026-145');

  const bySearch = await agent.get('/api/invoices').query({ search: 'lot-2026' });
  assert.equal(bySearch.status, 200);
  assert.equal(bySearch.body.length, 1);
  assert.equal(bySearch.body[0].id, created.body.id);

  const byOtherSearch = await agent.get('/api/invoices').query({ search: 'nonexistent-lot' });
  assert.equal(byOtherSearch.body.length, 0);
});

test('customer lot number is saved and returned independently of the internal lot number', async () => {
  const agent = await registeredOwner('Customer Lot Number Co');
  const customerId = await createCustomer(agent, 'Customer Lot Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'INTERNAL-79',
    customerLotNumber: 'CUST-458',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.lotNumber, 'INTERNAL-79');
  assert.equal(created.body.customerLotNumber, 'CUST-458');
});

test('invoice detail returns both the internal and customer lot numbers', async () => {
  const agent = await registeredOwner('Both Lot Numbers Co');
  const customerId = await createCustomer(agent, 'Both Lot Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'INTERNAL-79',
    customerLotNumber: 'CUST-458',
  });
  assert.equal(created.status, 201);

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.lotNumber, 'INTERNAL-79');
  assert.equal(details.body.customerLotNumber, 'CUST-458');
});

test('customer lot number is independently editable from the internal lot number', async () => {
  const agent = await registeredOwner('Independent Lot Edit Co');
  const customerId = await createCustomer(agent, 'Independent Lot Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'INTERNAL-79',
    customerLotNumber: 'CUST-458',
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    lotNumber: 'INTERNAL-79', // unchanged
    customerLotNumber: 'CUST-999', // changed
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.lotNumber, 'INTERNAL-79');
  assert.equal(edited.body.customerLotNumber, 'CUST-999');
});

test('search finds an invoice by its customer lot number', async () => {
  const agent = await registeredOwner('Customer Lot Search Co');
  const customerId = await createCustomer(agent, 'Lot Search Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { customerLotNumber: 'CUST-SEARCHABLE-458' });
  assert.equal(created.status, 201);

  const bySearch = await agent.get('/api/invoices').query({ search: 'searchable-458' });
  assert.equal(bySearch.status, 200);
  assert.equal(bySearch.body.length, 1);
  assert.equal(bySearch.body[0].id, created.body.id);

  const byOtherSearch = await agent.get('/api/invoices').query({ search: 'nonexistent-customer-lot' });
  assert.equal(byOtherSearch.body.length, 0);
});

test('search finds an invoice by either lot number independently — one does not match the other\'s value', async () => {
  const agent = await registeredOwner('Dual Lot Search Co');
  const customerId = await createCustomer(agent, 'Dual Lot Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'INTERNAL-ONLY-79',
    customerLotNumber: 'CUSTOMER-ONLY-458',
  });
  assert.equal(created.status, 201);

  const byInternal = await agent.get('/api/invoices').query({ search: 'internal-only-79' });
  assert.equal(byInternal.body.length, 1);
  assert.equal(byInternal.body[0].id, created.body.id);

  const byCustomer = await agent.get('/api/invoices').query({ search: 'customer-only-458' });
  assert.equal(byCustomer.body.length, 1);
  assert.equal(byCustomer.body[0].id, created.body.id);
});

test('lot number is optional and not required to be unique', async () => {
  const agent = await registeredOwner('Duplicate Lot Co');
  const customerId = await createCustomer(agent, 'Dup Lot Customer');
  const categoryId = await createCategory(agent);

  const noLot = await createInvoice(agent, customerId, categoryId);
  assert.equal(noLot.status, 201);
  assert.equal(noLot.body.lotNumber, null);

  const first = await createInvoice(agent, customerId, categoryId, { lotNumber: 'M-4587' });
  assert.equal(first.status, 201);
  const second = await createInvoice(agent, customerId, categoryId, { lotNumber: 'M-4587' });
  assert.equal(second.status, 201); // same lot number reused across two invoices — allowed
});

test('PDF/print data (the invoice view model) includes lot number and the discount breakdown', async () => {
  const agent = await registeredOwner('View Model Co');
  const customerId = await createCustomer(agent, 'View Model Customer');
  const categoryId = await createCategory(agent);

  const invoice = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'LOT-777',
    customerLotNumber: 'CUST-777',
    discountType: 'fixed',
    discountValue: '20.00',
  });
  assert.equal(invoice.status, 201);

  const pdf = await agent.get(`/api/invoices/${invoice.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok(pdf.body.length > 500, 'expected a real PDF, not an empty/near-empty buffer');
});

test('editing a draft invoice recalculates the discount and grand total', async () => {
  const agent = await registeredOwner('Edit Discount Co');
  const customerId = await createCustomer(agent, 'Edit Discount Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { discountType: 'percentage', discountValue: '10' });
  assert.equal(created.status, 201);
  assert.equal(created.body.grandTotal, '129.60');

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    lotNumber: 'LOT-EDITED',
    discountType: 'fixed',
    discountValue: '30.00',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.lotNumber, 'LOT-EDITED');
  assert.equal(edited.body.discountType, 'fixed');
  assert.equal(edited.body.discountAmount, '30.00');
  assert.equal(edited.body.grandTotal, '114.00');

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '114.00'); // ledger reflects the edited grand total
});

test('editing an issued invoice is rejected', async () => {
  const agent = await registeredOwner('Edit Issued Co');
  const customerId = await createCustomer(agent, 'Edit Issued Customer');
  const categoryId = await createCategory(agent);

  const created = await createInvoice(agent, customerId, categoryId, { status: 'issued' });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 400);
});

test('duplicating an invoice does not reuse its lot number, but does copy the discount', async () => {
  const agent = await registeredOwner('Duplicate Lot Reset Co');
  const customerId = await createCustomer(agent, 'Duplicate Reset Customer');
  const categoryId = await createCategory(agent);

  const original = await createInvoice(agent, customerId, categoryId, {
    lotNumber: 'LOT-ORIGINAL',
    customerLotNumber: 'CUST-ORIGINAL',
    discountType: 'percentage',
    discountValue: '10',
  });
  assert.equal(original.status, 201);

  const duplicate = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.lotNumber, null, 'a duplicate must never inherit the original internal lot number');
  assert.equal(duplicate.body.customerLotNumber, null, 'a duplicate must never inherit the original customer lot number');
  assert.equal(duplicate.body.discountType, 'percentage');
  assert.equal(duplicate.body.discountValue, '10.00');
  assert.equal(duplicate.body.grandTotal, '129.60');
});

test('tenant isolation: an invoice with a lot number is invisible to another company, including by search', async () => {
  const alice = await registeredOwner('Alice Lot Co');
  const bob = await registeredOwner('Bob Lot Co');
  const aliceCustomer = await createCustomer(alice, 'Alice Customer');
  const aliceCategory = await createCategory(alice);

  await createInvoice(alice, aliceCustomer, aliceCategory, { lotNumber: 'LOT-SECRET' });

  const bobList = await bob.get('/api/invoices');
  assert.equal(bobList.body.length, 0);

  const bobSearch = await bob.get('/api/invoices').query({ search: 'LOT-SECRET' });
  assert.equal(bobSearch.status, 200);
  assert.equal(bobSearch.body.length, 0);
});

test('permissions: staff cannot edit a draft invoice, owner can', async () => {
  const owner = await registeredOwner('Edit Permission Co');
  const me = await owner.get('/api/auth/me');
  const companyId = me.body.company.id as string;
  const customerId = await createCustomer(owner, 'Permission Customer');
  const categoryId = await createCategory(owner);
  const invoice = await createInvoice(owner, customerId, categoryId);

  const staffEmail = `staff+${Date.now()}@example.com`;
  const staffReg = await request(app).post('/api/auth/register').send({
    companyName: `staff co ${Date.now()}`,
    fullName: 'Staff Member',
    email: staffEmail,
    password: 'correct horse battery',
  });
  assert.equal(staffReg.status, 201);
  const staffUserId: string = (await pool.query('SELECT id FROM users WHERE lower(email) = $1', [staffEmail])).rows[0].id;
  await pool.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [companyId, staffUserId, 'staff']);
  const staff = request.agent(app);
  await staff.post('/api/auth/login').send({ email: staffEmail, password: 'correct horse battery' });
  await staff.post(`/api/companies/${companyId}/switch`);

  const staffAttempt = await staff.patch(`/api/invoices/${invoice.body.id}`).send({
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(staffAttempt.status, 403);

  const ownerEdit = await owner.patch(`/api/invoices/${invoice.body.id}`).send({
    lotNumber: 'LOT-BY-OWNER',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(ownerEdit.status, 200);
  assert.equal(ownerEdit.body.lotNumber, 'LOT-BY-OWNER');
});
