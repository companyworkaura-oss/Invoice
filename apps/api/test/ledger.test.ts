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
    fullName: 'Ledger Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCategory(agent: ReturnType<typeof request.agent>, name: string, rate: string, expression: string) {
  const res = await agent
    .post('/api/categories')
    .send({ name, defaultRate: rate, formulaConfig: { expression } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('a customer with an opening balance seeds an OPENING_BALANCE ledger entry', async () => {
  const agent = await registeredOwner('Ledger Opening Co');
  const customer = await agent.post('/api/customers').send({ name: 'Has Balance', openingBalance: '500.00' });
  assert.equal(customer.status, 201);

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.entries.length, 1);
  assert.equal(ledger.body.entries[0].type, 'OPENING_BALANCE');
  assert.equal(ledger.body.entries[0].debit, '500.00');
  assert.equal(ledger.body.entries[0].credit, '0.00');
  assert.equal(ledger.body.balance, '500.00');
});

test('a customer with no opening balance has an empty ledger and zero balance', async () => {
  const agent = await registeredOwner('Ledger No Balance Co');
  const customer = await agent.post('/api/customers').send({ name: 'No Balance' });
  assert.equal(customer.status, 201);

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.body.entries.length, 0);
  assert.equal(ledger.body.balance, '0.00');
});

test('creating an invoice posts an INVOICE (debit) ledger entry and updates the balance', async () => {
  const agent = await registeredOwner('Ledger Invoice Co');
  const customer = await agent.post('/api/customers').send({ name: 'Invoice Customer' });
  const categoryId = await createCategory(agent, 'HS/HP', '1.20', 'stitches / 1000 * rate');

  const invoice = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '10',
    items: [{ categoryId, stitches: 12000 }],
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.totalAmount, '144.00');

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.body.entries.length, 1);
  assert.equal(ledger.body.entries[0].type, 'INVOICE');
  assert.equal(ledger.body.entries[0].debit, '144.00');
  assert.equal(ledger.body.entries[0].referenceId, invoice.body.id);
  assert.equal(ledger.body.balance, '144.00');
});

test('recording a payment posts a PAYMENT (credit) entry and reduces the balance', async () => {
  const agent = await registeredOwner('Ledger Payment Co');
  const customer = await agent.post('/api/customers').send({ name: 'Payment Customer', openingBalance: '100.00' });

  const payment = await agent
    .post('/api/payments')
    .send({ customerId: customer.body.id, amount: '40.00', paymentMethod: 'cash' });
  assert.equal(payment.status, 201);

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.body.entries.length, 2); // OPENING_BALANCE, PAYMENT
  const paymentEntry = ledger.body.entries[1];
  assert.equal(paymentEntry.type, 'PAYMENT');
  assert.equal(paymentEntry.credit, '40.00');
  assert.equal(paymentEntry.debit, '0.00');
  assert.equal(paymentEntry.referenceId, payment.body.id);
  assert.equal(ledger.body.balance, '60.00'); // 100 - 40
});

test('an adjustment posts exactly one of debit or credit and rejects both/neither', async () => {
  const agent = await registeredOwner('Ledger Adjustment Co');
  const customer = await agent.post('/api/customers').send({ name: 'Adjustment Customer' });
  const customerId = customer.body.id;

  const debitAdj = await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ debit: '25.00', notes: 'Correction' });
  assert.equal(debitAdj.status, 201);
  assert.equal(debitAdj.body.type, 'ADJUSTMENT');
  assert.equal(debitAdj.body.debit, '25.00');

  const both = await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ debit: '5.00', credit: '5.00' });
  assert.equal(both.status, 400);

  const neither = await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({});
  assert.equal(neither.status, 400);

  const creditAdj = await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ credit: '10.00' });
  assert.equal(creditAdj.status, 201);

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '15.00'); // 25 debit - 10 credit
});

test('a full customer statement: opening balance, invoice, and a partial payment', async () => {
  const agent = await registeredOwner('Ledger Statement Co');
  const customer = await agent.post('/api/customers').send({ name: 'Statement Customer', openingBalance: '50.00' });
  const categoryId = await createCategory(agent, 'Patti', '3.00', 'stitches / 1000 * rate * 21');

  const invoice = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '2',
    items: [{ categoryId, stitches: 5000 }],
  });
  assert.equal(invoice.status, 201);
  // unit = 5*3*21 = 315 ; total = 315*2 = 630
  assert.equal(invoice.body.totalAmount, '630.00');
  assert.equal(invoice.body.previousBalance, '50.00');
  assert.equal(invoice.body.totalReceivable, '680.00'); // 50 + 630
  assert.equal(invoice.body.currentBalance, '680.00'); // nothing paid yet
  assert.equal(invoice.body.amountPaid, '0.00');

  await agent.post('/api/payments').send({ customerId: customer.body.id, amount: '200.00', paymentMethod: 'bank' });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.status, 200);
  assert.equal(reread.body.previousBalance, '50.00'); // fixed — unaffected by later payment
  assert.equal(reread.body.totalReceivable, '680.00'); // fixed
  assert.equal(reread.body.currentBalance, '480.00'); // 680 - 200 paid since
  assert.equal(reread.body.amountPaid, '200.00');

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.body.entries.length, 3); // OPENING_BALANCE, INVOICE, PAYMENT
  assert.equal(ledger.body.balance, '480.00');
});

test('previousBalance on a second invoice reflects the first invoice, unaffected by a later payment', async () => {
  const agent = await registeredOwner('Ledger Second Invoice Co');
  const customer = await agent.post('/api/customers').send({ name: 'Second Invoice Customer' });
  const categoryId = await createCategory(agent, 'HS/HP', '1.00', 'stitches / 1000 * rate');

  const first = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }], // 1.00
  });
  assert.equal(first.body.totalAmount, '1.00');
  assert.equal(first.body.previousBalance, '0.00');

  const second = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '1',
    items: [{ categoryId, stitches: 2000 }], // 2.00
  });
  assert.equal(second.body.totalAmount, '2.00');
  assert.equal(second.body.previousBalance, '1.00'); // balance right after the first invoice
  assert.equal(second.body.totalReceivable, '3.00');
});

test('ledger operations are tenant isolated', async () => {
  const alice = await registeredOwner('Alice Ledger Co');
  const bob = await registeredOwner('Bob Ledger Co');

  const aliceCustomer = await alice.post('/api/customers').send({ name: 'Alice Customer', openingBalance: '100.00' });

  const bobViewAttempt = await bob.get(`/api/customers/${aliceCustomer.body.id}/ledger`);
  assert.equal(bobViewAttempt.status, 404);

  const bobPaymentAttempt = await bob
    .post('/api/payments')
    .send({ customerId: aliceCustomer.body.id, amount: '10.00', paymentMethod: 'cash' });
  assert.equal(bobPaymentAttempt.status, 404);

  const stillIntact = await alice.get(`/api/customers/${aliceCustomer.body.id}/ledger`);
  assert.equal(stillIntact.body.balance, '100.00');
});

test('PATCH /api/customers/:id no longer accepts openingBalance — it is fixed after creation', async () => {
  const agent = await registeredOwner('Ledger Immutable Opening Co');
  const customer = await agent.post('/api/customers').send({ name: 'Fixed Opening', openingBalance: '75.00' });

  const patch = await agent.patch(`/api/customers/${customer.body.id}`).send({ openingBalance: '999.00', name: 'Renamed' });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.openingBalance, '75.00'); // ignored, not applied
  assert.equal(patch.body.name, 'Renamed');

  const ledger = await agent.get(`/api/customers/${customer.body.id}/ledger`);
  assert.equal(ledger.body.balance, '75.00');
});

test('ledger routes require authentication', async () => {
  const res = await request(app).get('/api/customers/00000000-0000-0000-0000-000000000000/ledger');
  assert.equal(res.status, 401);
});
