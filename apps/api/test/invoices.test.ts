import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

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
    fullName: 'Invoice Test Owner',
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

async function createCategory(
  agent: ReturnType<typeof request.agent>,
  input: { name: string; defaultRate?: string; expression: string; formulaConfig?: Record<string, unknown> },
) {
  const res = await agent.post('/api/categories').send({
    name: input.name,
    defaultRate: input.defaultRate ?? '1.00',
    formulaConfig: { expression: input.expression, ...input.formulaConfig },
  });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('creates an invoice, computes amounts server-side, and lists/views it', async () => {
  const agent = await registeredOwner('Invoice Basic Co');
  const customerId = await createCustomer(agent, 'Uniform Buyers Ltd');
  const categoryId = await createCategory(agent, {
    name: 'HS/HP',
    defaultRate: '1.20',
    expression: 'stitches / 1000 * rate',
  });

  const created = await agent.post('/api/invoices').send({
    customerId,
    quantity: '10',
    notes: 'First order',
    items: [{ categoryId, stitches: 12000 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'draft');
  assert.equal(created.body.quantity, '10.00');
  assert.match(created.body.invoiceNumber, /^INV-\d{6}$/);
  assert.equal(created.body.items.length, 1);

  const item = created.body.items[0];
  // unit = 12000/1000 * 1.20 = 14.40 ; total = unit * quantity(10) = 144.00
  assert.equal(item.calculatedUnitAmount, '14.40');
  assert.equal(item.calculatedTotal, '144.00');
  assert.equal(item.categoryName, 'HS/HP');
  assert.equal(item.rate, '1.20');
  assert.equal(created.body.totalAmount, '144.00');

  const listRes = await agent.get('/api/invoices');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.length, 1);
  assert.equal(listRes.body[0].totalAmount, '144.00');
  assert.equal(listRes.body[0].customerName, 'Uniform Buyers Ltd');

  const getRes = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.items[0].calculatedTotal, '144.00');
});

test('multiple items sum correctly, and a per-item rate override is honored', async () => {
  const agent = await registeredOwner('Invoice Multi Item Co');
  const customerId = await createCustomer(agent, 'Multi Item Customer');
  const hsHp = await createCategory(agent, { name: 'HS/HP', defaultRate: '1.00', expression: 'stitches / 1000 * rate' });
  const daman = await createCategory(agent, {
    name: 'Daman',
    defaultRate: '2.00',
    expression: 'stitches / 1000 * rate * 2.77',
  });

  const created = await agent.post('/api/invoices').send({
    customerId,
    quantity: '5',
    items: [
      { categoryId: hsHp, stitches: 10000, rate: '1.50' }, // override default 1.00
      { categoryId: daman, stitches: 10000 }, // uses category default 2.00
    ],
  });
  assert.equal(created.status, 201);

  const hsHpItem = created.body.items.find((i: { categoryName: string }) => i.categoryName === 'HS/HP');
  const damanItem = created.body.items.find((i: { categoryName: string }) => i.categoryName === 'Daman');
  assert.equal(hsHpItem.rate, '1.50');
  assert.equal(hsHpItem.calculatedUnitAmount, '15.00'); // 10*1.50
  assert.equal(hsHpItem.calculatedTotal, '75.00'); // *5
  assert.equal(damanItem.rate, '2.00');
  assert.equal(damanItem.calculatedUnitAmount, '55.40'); // 10*2.00*2.77
  assert.equal(damanItem.calculatedTotal, '277.00'); // *5

  // total = 75.00 + 277.00
  assert.equal(created.body.totalAmount, '352.00');
});

test('a category using multiplier/divisor formula_config variables (Bazu shape)', async () => {
  const agent = await registeredOwner('Invoice Bazu Co');
  const customerId = await createCustomer(agent, 'Bazu Customer');
  const categoryId = await createCategory(agent, {
    name: 'Bazu',
    defaultRate: '5.00',
    expression: 'stitches / 1000 * rate * multiplier / divisor',
    formulaConfig: { multiplier: 28, divisor: 14 },
  });

  const created = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches: 7000 }],
  });
  assert.equal(created.status, 201);
  // 7 * 5 * 28 / 14 = 70
  assert.equal(created.body.items[0].calculatedUnitAmount, '70.00');
  assert.deepEqual(created.body.items[0].calculationInputs.multiplier, 28);
  assert.deepEqual(created.body.items[0].calculationInputs.divisor, 14);
});

test('invoice numbers are sequential per company and safe under concurrent creation', async () => {
  const agent = await registeredOwner('Invoice Numbering Co');
  const customerId = await createCustomer(agent, 'Numbering Customer');
  const categoryId = await createCategory(agent, { name: 'HS/HP', expression: 'stitches / 1000 * rate' });

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      agent.post('/api/invoices').send({
        customerId,
        quantity: '1',
        items: [{ categoryId, stitches: 1000 }],
      }),
    ),
  );
  for (const res of results) assert.equal(res.status, 201);

  const numbers = results.map((r) => r.body.invoiceNumber);
  assert.equal(new Set(numbers).size, numbers.length, 'every invoice number must be unique');

  const list = await agent.get('/api/invoices');
  assert.equal(list.body.length, 8);
});

test('rejects an invoice with no items', async () => {
  const agent = await registeredOwner('Invoice No Items Co');
  const customerId = await createCustomer(agent, 'No Items Customer');
  const res = await agent.post('/api/invoices').send({ customerId, quantity: '1', items: [] });
  assert.equal(res.status, 400);
});

test('rejects a category with no formula configured', async () => {
  const agent = await registeredOwner('Invoice No Formula Co');
  const customerId = await createCustomer(agent, 'No Formula Customer');
  const categoryRes = await agent.post('/api/categories').send({ name: 'Unconfigured' }); // no expression
  assert.equal(categoryRes.status, 201);

  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId: categoryRes.body.id, stitches: 1000 }],
  });
  assert.equal(res.status, 400);
});

test('rejects a disabled category', async () => {
  const agent = await registeredOwner('Invoice Disabled Category Co');
  const customerId = await createCustomer(agent, 'Disabled Category Customer');
  const categoryId = await createCategory(agent, { name: 'Soon Disabled', expression: 'stitches / 1000 * rate' });
  await agent.post(`/api/categories/${categoryId}/disable`);

  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }],
  });
  assert.equal(res.status, 400);
});

test('rejects division by zero from a badly configured formula', async () => {
  const agent = await registeredOwner('Invoice Div Zero Co');
  const customerId = await createCustomer(agent, 'Div Zero Customer');
  const categoryId = await createCategory(agent, {
    name: 'Broken',
    expression: 'stitches / 1000 * rate / divisor',
    formulaConfig: { divisor: 0 },
  });

  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }],
  });
  assert.equal(res.status, 400);
});

test('does not accept client-supplied calculated amounts', async () => {
  const agent = await registeredOwner('Invoice No Client Amounts Co');
  const customerId = await createCustomer(agent, 'No Client Amounts Customer');
  const categoryId = await createCategory(agent, { name: 'HS/HP', defaultRate: '1.00', expression: 'stitches / 1000 * rate' });

  const created = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [
      // Even if a client tried to smuggle these in, the route only ever
      // reads categoryId/description/stitches/rate from an item.
      { categoryId, stitches: 1000, calculatedUnitAmount: '999999.99', calculatedTotal: '999999.99' },
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].calculatedUnitAmount, '1.00');
  assert.equal(created.body.items[0].calculatedTotal, '1.00');
});

test('snapshots survive later changes to the category rate and formula', async () => {
  const agent = await registeredOwner('Invoice Snapshot Co');
  const customerId = await createCustomer(agent, 'Snapshot Customer');
  const categoryId = await createCategory(agent, {
    name: 'Patti',
    defaultRate: '3.00',
    expression: 'stitches / 1000 * rate * 21',
  });

  const created = await agent.post('/api/invoices').send({
    customerId,
    quantity: '2',
    items: [{ categoryId, stitches: 5000 }],
  });
  assert.equal(created.status, 201);
  // 5 * 3 * 21 = 315 ; total = 315 * 2 = 630
  assert.equal(created.body.items[0].calculatedUnitAmount, '315.00');
  assert.equal(created.body.items[0].calculatedTotal, '630.00');

  // Now change the category's rate, formula, and name.
  await agent.patch(`/api/categories/${categoryId}`).send({
    name: 'Patti (renamed)',
    defaultRate: '999.00',
    formulaConfig: { expression: 'stitches / 1000 * rate * 999' },
  });

  const reread = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(reread.status, 200);
  const item = reread.body.items[0];
  assert.equal(item.categoryName, 'Patti'); // snapshot, not the new name
  assert.equal(item.rate, '3.00'); // snapshot, not the new default_rate
  assert.equal(item.calculatedUnitAmount, '315.00'); // unchanged
  assert.equal(item.calculatedTotal, '630.00'); // unchanged
  assert.equal(item.formulaConfig.expression, 'stitches / 1000 * rate * 21'); // snapshot formula
});

test('tenant isolation: an invoice from one company is invisible to another', async () => {
  const alice = await registeredOwner('Alice Invoice Co');
  const bob = await registeredOwner('Bob Invoice Co');

  const aliceCustomer = await createCustomer(alice, 'Alice Customer');
  const aliceCategory = await createCategory(alice, { name: 'HS/HP', expression: 'stitches / 1000 * rate' });
  const aliceInvoice = await alice.post('/api/invoices').send({
    customerId: aliceCustomer,
    quantity: '1',
    items: [{ categoryId: aliceCategory, stitches: 1000 }],
  });
  assert.equal(aliceInvoice.status, 201);

  const bobList = await bob.get('/api/invoices');
  assert.equal(bobList.body.length, 0);

  const bobDirectFetch = await bob.get(`/api/invoices/${aliceInvoice.body.id}`);
  assert.equal(bobDirectFetch.status, 404);

  // Bob cannot bill Alice's customer or use Alice's category from his own session either.
  const crossCustomer = await bob.post('/api/invoices').send({
    customerId: aliceCustomer,
    quantity: '1',
    items: [{ categoryId: aliceCategory, stitches: 1000 }],
  });
  assert.equal(crossCustomer.status, 404);
});

test('filters the list by status and customer', async () => {
  const agent = await registeredOwner('Invoice Filter Co');
  const customerA = await createCustomer(agent, 'Customer A');
  const customerB = await createCustomer(agent, 'Customer B');
  const categoryId = await createCategory(agent, { name: 'HS/HP', expression: 'stitches / 1000 * rate' });

  await agent.post('/api/invoices').send({
    customerId: customerA,
    quantity: '1',
    status: 'issued',
    items: [{ categoryId, stitches: 1000 }],
  });
  await agent.post('/api/invoices').send({
    customerId: customerB,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }],
  });

  const byStatus = await agent.get('/api/invoices').query({ status: 'issued' });
  assert.equal(byStatus.body.length, 1);
  assert.equal(byStatus.body[0].status, 'issued');

  const byCustomer = await agent.get('/api/invoices').query({ customerId: customerB });
  assert.equal(byCustomer.body.length, 1);
  assert.equal(byCustomer.body[0].customerId, customerB);
});

test('invoice routes require authentication', async () => {
  const res = await request(app).get('/api/invoices');
  assert.equal(res.status, 401);
});
