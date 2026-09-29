import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Per-item quantity (each embroidery category/line on an invoice has its
// own quantity — e.g. BAZU=12, FRONT=8, DUPATTA=15 — never one
// invoice-wide value applied to every item). See invoice.service.ts's
// createInvoiceItem for where this is used in the formula engine.

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
    fullName: 'Item Quantity Test Owner',
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

async function createCategory(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent
    .post('/api/categories')
    .send({ name, defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('each category/line has its own quantity: BAZU=12, FRONT=8, DUPATTA=15', async () => {
  const agent = await registeredOwner('Per Item Qty Co');
  const customerId = await createCustomer(agent, 'Per Item Customer');
  const bazu = await createCategory(agent, 'BAZU');
  const front = await createCategory(agent, 'FRONT');
  const dupatta = await createCategory(agent, 'DUPATTA');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '12' },
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' },
      { categoryId: dupatta, description: 'DUPATTA', stitches: 13000, quantity: '15' },
    ],
  });
  assert.equal(created.status, 201);

  const byName = (name: string) => created.body.items.find((i: { description: string }) => i.description === name);

  const bazuItem = byName('BAZU');
  assert.equal(bazuItem.quantity, '12.00');
  // unit = 10000/1000*1.20 = 12.00 ; total = 12.00 * 12 = 144.00
  assert.equal(bazuItem.calculatedUnitAmount, '12.00');
  assert.equal(bazuItem.calculatedTotal, '144.00');

  const frontItem = byName('FRONT');
  assert.equal(frontItem.quantity, '8.00');
  // unit = 150000/1000*1.20 = 180.00 ; total = 180.00 * 8 = 1440.00
  assert.equal(frontItem.calculatedUnitAmount, '180.00');
  assert.equal(frontItem.calculatedTotal, '1440.00');

  const dupattaItem = byName('DUPATTA');
  assert.equal(dupattaItem.quantity, '15.00');
  // unit = 13000/1000*1.20 = 15.60 ; total = 15.60 * 15 = 234.00
  assert.equal(dupattaItem.calculatedUnitAmount, '15.60');
  assert.equal(dupattaItem.calculatedTotal, '234.00');

  assert.equal(created.body.totalAmount, '1818.00'); // 144 + 1440 + 234
});

test('the formula engine receives each item\'s own quantity as its calculationInputs.quantity', async () => {
  const agent = await registeredOwner('Formula Qty Co');
  const customerId = await createCustomer(agent, 'Formula Qty Customer');
  const categoryId = await createCategory(agent, 'HS/HP');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 5000, quantity: '7' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].calculationInputs.quantity, '7');
});

test('item quantity defaults to 1 when omitted', async () => {
  const agent = await registeredOwner('Default Qty Co');
  const customerId = await createCustomer(agent, 'Default Qty Customer');
  const categoryId = await createCategory(agent, 'HS/HP');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 1000 }], // no quantity given
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].quantity, '1.00');
  // unit = 1000/1000*1.20 = 1.20 ; total = 1.20*1 = 1.20
  assert.equal(created.body.items[0].calculatedTotal, '1.20');
});

test('rejects a zero or negative item quantity', async () => {
  const agent = await registeredOwner('Bad Qty Co');
  const customerId = await createCustomer(agent, 'Bad Qty Customer');
  const categoryId = await createCategory(agent, 'HS/HP');

  const zero = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 1000, quantity: '0' }],
  });
  assert.equal(zero.status, 400);

  const negative = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 1000, quantity: '-5' }],
  });
  assert.equal(negative.status, 400);
});

test('invoice detail (GET) returns the correct per-item quantities', async () => {
  const agent = await registeredOwner('Detail Qty Co');
  const customerId = await createCustomer(agent, 'Detail Qty Customer');
  const bazu = await createCategory(agent, 'BAZU');
  const front = await createCategory(agent, 'FRONT');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '12' },
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' },
    ],
  });
  assert.equal(created.status, 201);

  const detail = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(detail.status, 200);
  const byName = (name: string) => detail.body.items.find((i: { description: string }) => i.description === name);
  assert.equal(byName('BAZU').quantity, '12.00');
  assert.equal(byName('FRONT').quantity, '8.00');
});

test('editing a draft: changing one item\'s quantity does not alter another item\'s amount', async () => {
  const agent = await registeredOwner('Edit One Item Qty Co');
  const customerId = await createCustomer(agent, 'Edit One Item Customer');
  const bazu = await createCategory(agent, 'BAZU');
  const front = await createCategory(agent, 'FRONT');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '12' },
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' },
    ],
  });
  assert.equal(created.status, 201);

  // Only BAZU's quantity changes, 12 -> 20; FRONT stays at 8.
  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '20' },
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' },
    ],
  });
  assert.equal(edited.status, 200);

  const byName = (name: string) => edited.body.items.find((i: { description: string }) => i.description === name);
  const bazuItem = byName('BAZU');
  assert.equal(bazuItem.quantity, '20.00');
  assert.equal(bazuItem.calculatedTotal, '240.00'); // 12.00 unit * 20

  const frontItem = byName('FRONT');
  assert.equal(frontItem.quantity, '8.00'); // unchanged
  assert.equal(frontItem.calculatedTotal, '1440.00'); // unchanged: 180.00 unit * 8
});

test('duplicating an invoice copies each line item\'s own quantity', async () => {
  const agent = await registeredOwner('Duplicate Qty Co');
  const customerId = await createCustomer(agent, 'Duplicate Qty Customer');
  const bazu = await createCategory(agent, 'BAZU');
  const front = await createCategory(agent, 'FRONT');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '12' },
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' },
    ],
  });
  assert.equal(original.status, 201);

  const duplicate = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(duplicate.status, 201);

  const byName = (name: string) => duplicate.body.items.find((i: { description: string }) => i.description === name);
  assert.equal(byName('BAZU').quantity, '12.00');
  assert.equal(byName('FRONT').quantity, '8.00');
  assert.equal(duplicate.body.totalAmount, original.body.totalAmount);
});

test('ledger debit reflects the sum of per-item totals, computed from each item\'s own quantity', async () => {
  const agent = await registeredOwner('Ledger Item Qty Co');
  const customerId = await createCustomer(agent, 'Ledger Item Qty Customer');
  const bazu = await createCategory(agent, 'BAZU');
  const front = await createCategory(agent, 'FRONT');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { categoryId: bazu, description: 'BAZU', stitches: 10000, quantity: '12' }, // 144.00
      { categoryId: front, description: 'FRONT', stitches: 150000, quantity: '8' }, // 1440.00
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.totalAmount, '1584.00');
  assert.equal(created.body.grandTotal, '1584.00');

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.balance, '1584.00');
  assert.equal(ledger.body.entries[0].debit, '1584.00');
});
