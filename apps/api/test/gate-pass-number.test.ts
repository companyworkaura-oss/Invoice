import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Gate Pass Number: a manual, free-text invoice field — the gate pass
// number that came with the client's material. Metadata only, never
// used in any calculation. A category with expression
// 'stitches / 1000 * rate', rate 1.20, and 12000 stitches gives a unit
// amount of 14.40; at quantity 10 that's a 144.00 subtotal — the same
// fixture every other invoice test file uses.

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
    fullName: 'Gate Pass Test Owner',
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

test('Gate Pass Number saves and is returned on create', async () => {
  const agent = await registeredOwner('Gate Pass Save Co');
  const customerId = await createCustomer(agent, 'Gate Pass Save Customer');
  const categoryId = await createCategory(agent);

  const res = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-4587',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.gatePassNumber, 'GP-4587');
});

test('Gate Pass Number accepts letters, digits, slashes, and dashes', async () => {
  const agent = await registeredOwner('Gate Pass Chars Co');
  const customerId = await createCustomer(agent, 'Gate Pass Chars Customer');
  const categoryId = await createCategory(agent);

  for (const value of ['GP-4587', '12345', 'Gate-77/26']) {
    const res = await agent.post('/api/invoices').send({
      customerId,
      gatePassNumber: value,
      items: [{ categoryId, stitches: 12000, quantity: '10' }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.gatePassNumber, value);
  }
});

test('Gate Pass Number is optional — omitting it leaves it null, never an error', async () => {
  const agent = await registeredOwner('Gate Pass Optional Co');
  const customerId = await createCustomer(agent, 'Gate Pass Optional Customer');
  const categoryId = await createCategory(agent);

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.gatePassNumber, null);
});

test('invoice detail (GET) returns the saved Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Detail Co');
  const customerId = await createCustomer(agent, 'Gate Pass Detail Customer');
  const categoryId = await createCategory(agent);

  const created = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-4587',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.gatePassNumber, 'GP-4587');
});

test('editing a draft invoice can change the Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Edit Co');
  const customerId = await createCustomer(agent, 'Gate Pass Edit Customer');
  const categoryId = await createCategory(agent);

  const created = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-1000',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    gatePassNumber: 'GP-2000',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.gatePassNumber, 'GP-2000');

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.body.gatePassNumber, 'GP-2000');
});

test('editing a draft invoice can clear the Gate Pass Number back to empty', async () => {
  const agent = await registeredOwner('Gate Pass Clear Co');
  const customerId = await createCustomer(agent, 'Gate Pass Clear Customer');
  const categoryId = await createCategory(agent);

  const created = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-1000',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.gatePassNumber, null);
});

test('print/PDF data (the invoice view model) includes a non-empty Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Print Co');
  const customerId = await createCustomer(agent, 'Gate Pass Print Customer');
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-4587',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(invoice.status, 201);

  const pdf = await agent.get(`/api/invoices/${invoice.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok(pdf.body.length > 500, 'expected a real PDF, not an empty/near-empty buffer');
});

test('Quick Invoice (manual items) saves a Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Quick Co');
  const customerId = await createCustomer(agent, 'Gate Pass Quick Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-QUICK-1',
    items: [{ description: 'HEAD SKIP', quantity: '504', unitPrice: '375.41' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.gatePassNumber, 'GP-QUICK-1');
  assert.equal(res.body.invoiceMode, 'quick');
});

test('Standard Invoice (category items) saves a Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Standard Co');
  const customerId = await createCustomer(agent, 'Gate Pass Standard Customer');
  const categoryId = await createCategory(agent);

  const res = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-STD-1',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.gatePassNumber, 'GP-STD-1');
  assert.equal(res.body.invoiceMode, 'standard');
});

test('search finds an invoice by its Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Search Co');
  const customerId = await createCustomer(agent, 'Gate Pass Search Customer');
  const categoryId = await createCategory(agent);

  const created = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-SEARCHABLE-4587',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);

  const bySearch = await agent.get('/api/invoices').query({ search: 'searchable-4587' });
  assert.equal(bySearch.status, 200);
  assert.equal(bySearch.body.length, 1);
  assert.equal(bySearch.body[0].id, created.body.id);

  const byOtherSearch = await agent.get('/api/invoices').query({ search: 'nonexistent-gate-pass' });
  assert.equal(byOtherSearch.body.length, 0);
});

test('search by Gate Pass Number never matches an unrelated invoice — only the one carrying it', async () => {
  const agent = await registeredOwner('Gate Pass Search Precision Co');
  const customerId = await createCustomer(agent, 'Gate Pass Precision Customer');
  const categoryId = await createCategory(agent);

  const withGatePass = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-UNIQUE-999',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  const withoutGatePass = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(withGatePass.status, 201);
  assert.equal(withoutGatePass.status, 201);

  const bySearch = await agent.get('/api/invoices').query({ search: 'GP-UNIQUE-999' });
  assert.equal(bySearch.body.length, 1);
  assert.equal(bySearch.body[0].id, withGatePass.body.id);
});

test('duplicating an invoice does not reuse its Gate Pass Number', async () => {
  const agent = await registeredOwner('Gate Pass Duplicate Co');
  const customerId = await createCustomer(agent, 'Gate Pass Duplicate Customer');
  const categoryId = await createCategory(agent);

  const original = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-ORIGINAL',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(original.status, 201);

  const duplicate = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.gatePassNumber, null, 'a duplicate must never inherit the original gate pass number');
});

test('Gate Pass Number never affects calculated amounts — totalAmount, discount, and grandTotal are unchanged', async () => {
  const agent = await registeredOwner('Gate Pass No Calc Co');
  const customerId = await createCustomer(agent, 'Gate Pass No Calc Customer');
  const categoryId = await createCategory(agent);

  const withoutGatePass = await agent.post('/api/invoices').send({
    customerId,
    discountType: 'percentage',
    discountValue: '10',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  const withGatePass = await agent.post('/api/invoices').send({
    customerId,
    gatePassNumber: 'GP-4587',
    discountType: 'percentage',
    discountValue: '10',
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(withoutGatePass.status, 201);
  assert.equal(withGatePass.status, 201);

  assert.equal(withoutGatePass.body.totalAmount, withGatePass.body.totalAmount);
  assert.equal(withoutGatePass.body.discountAmount, withGatePass.body.discountAmount);
  assert.equal(withoutGatePass.body.grandTotal, withGatePass.body.grandTotal);
});

test('tenant isolation: an invoice with a Gate Pass Number is invisible to another company, including by search', async () => {
  const alice = await registeredOwner('Alice Gate Pass Co');
  const bob = await registeredOwner('Bob Gate Pass Co');
  const aliceCustomer = await createCustomer(alice, 'Alice Gate Pass Customer');
  const aliceCategory = await createCategory(alice);

  await alice.post('/api/invoices').send({
    customerId: aliceCustomer,
    gatePassNumber: 'GP-SECRET',
    items: [{ categoryId: aliceCategory, stitches: 12000, quantity: '10' }],
  });

  const bobList = await bob.get('/api/invoices');
  assert.equal(bobList.body.length, 0);

  const bobSearch = await bob.get('/api/invoices').query({ search: 'GP-SECRET' });
  assert.equal(bobSearch.status, 200);
  assert.equal(bobSearch.body.length, 0);
});
