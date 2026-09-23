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
    fullName: 'Payments Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string, openingBalance?: string) {
  const res = await agent.post('/api/customers').send({ name, openingBalance });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('records a payment with all fields, creates a matching ledger credit, and updates the balance', async () => {
  const agent = await registeredOwner('Payments Full Co');
  const customerId = await createCustomer(agent, 'Full Fields Customer', '500.00');

  const payment = await agent.post('/api/payments').send({
    customerId,
    amount: '150.00',
    date: '2026-02-01',
    paymentMethod: 'bank',
    reference: 'TXN-9981',
    notes: 'Partial settlement for January work',
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.body.customerId, customerId);
  assert.equal(payment.body.customerName, 'Full Fields Customer');
  assert.equal(payment.body.amount, '150.00');
  assert.equal(payment.body.date, '2026-02-01');
  assert.equal(payment.body.paymentMethod, 'bank');
  assert.equal(payment.body.reference, 'TXN-9981');
  assert.equal(payment.body.notes, 'Partial settlement for January work');
  assert.equal(typeof payment.body.id, 'string');

  // The matching ledger credit entry, referencing this payment.
  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.entries.length, 2); // OPENING_BALANCE, PAYMENT
  const entry = ledger.body.entries[1];
  assert.equal(entry.type, 'PAYMENT');
  assert.equal(entry.credit, '150.00');
  assert.equal(entry.debit, '0.00');
  assert.equal(entry.referenceId, payment.body.id);
  assert.equal(ledger.body.balance, '350.00'); // 500 - 150 — derived customer balance updated
});

test('each of the four payment methods is accepted', async () => {
  const agent = await registeredOwner('Payments Methods Co');
  const customerId = await createCustomer(agent, 'Methods Customer', '1000.00');

  for (const paymentMethod of ['cash', 'bank', 'cheque', 'other']) {
    const res = await agent.post('/api/payments').send({ customerId, amount: '10.00', paymentMethod });
    assert.equal(res.status, 201, `${paymentMethod} should be accepted`);
    assert.equal(res.body.paymentMethod, paymentMethod);
  }
});

test('rejects an invalid payment method', async () => {
  const agent = await registeredOwner('Payments Bad Method Co');
  const customerId = await createCustomer(agent, 'Bad Method Customer');

  const res = await agent.post('/api/payments').send({ customerId, amount: '10.00', paymentMethod: 'crypto' });
  assert.equal(res.status, 400);
});

test('rejects a non-positive amount', async () => {
  const agent = await registeredOwner('Payments Bad Amount Co');
  const customerId = await createCustomer(agent, 'Bad Amount Customer');

  const zero = await agent.post('/api/payments').send({ customerId, amount: '0.00', paymentMethod: 'cash' });
  assert.equal(zero.status, 400);

  const negative = await agent.post('/api/payments').send({ customerId, amount: '-5.00', paymentMethod: 'cash' });
  assert.equal(negative.status, 400);
});

test('supports partial payments: several payments against one invoice never over-apply', async () => {
  const agent = await registeredOwner('Payments Partial Co');
  const customerId = await createCustomer(agent, 'Partial Customer');
  const category = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.00', formulaConfig: { expression: 'stitches / 1000 * rate' } });

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId: category.body.id, stitches: 100000 }], // 100.00
  });
  assert.equal(invoice.body.totalAmount, '100.00');

  const first = await agent.post('/api/payments').send({ customerId, amount: '30.00', paymentMethod: 'cash' });
  assert.equal(first.status, 201);
  let reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.currentBalance, '70.00');
  assert.equal(reread.body.amountPaid, '30.00');

  const second = await agent.post('/api/payments').send({ customerId, amount: '45.50', paymentMethod: 'cheque', reference: 'CHQ-001' });
  assert.equal(second.status, 201);
  reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.currentBalance, '24.50');
  assert.equal(reread.body.amountPaid, '75.50');

  const third = await agent.post('/api/payments').send({ customerId, amount: '24.50', paymentMethod: 'other' });
  assert.equal(third.status, 201);
  reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.currentBalance, '0.00');
  assert.equal(reread.body.amountPaid, '100.00');

  const list = await agent.get('/api/payments').query({ customerId });
  assert.equal(list.body.length, 3);
});

test('lists payments company-wide and filtered by customer, newest first', async () => {
  const agent = await registeredOwner('Payments List Co');
  const alice = await createCustomer(agent, 'Alice Payer');
  const bob = await createCustomer(agent, 'Bob Payer');

  await agent.post('/api/payments').send({ customerId: alice, amount: '10.00', paymentMethod: 'cash' });
  await agent.post('/api/payments').send({ customerId: bob, amount: '20.00', paymentMethod: 'bank' });
  await agent.post('/api/payments').send({ customerId: alice, amount: '5.00', paymentMethod: 'cheque' });

  const all = await agent.get('/api/payments');
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 3);
  assert.equal(all.body[0].amount, '5.00'); // newest first

  const aliceOnly = await agent.get('/api/payments').query({ customerId: alice });
  assert.equal(aliceOnly.body.length, 2);
  assert.ok(aliceOnly.body.every((p: { customerId: string }) => p.customerId === alice));
});

test('gets a single payment by id', async () => {
  const agent = await registeredOwner('Payments Detail Co');
  const customerId = await createCustomer(agent, 'Detail Customer');

  const created = await agent.post('/api/payments').send({ customerId, amount: '12.34', paymentMethod: 'cash' });
  const fetched = await agent.get(`/api/payments/${created.body.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.amount, '12.34');
});

test('tenant isolation: cannot pay, list, or view across companies', async () => {
  const alice = await registeredOwner('Alice Payments Co');
  const bob = await registeredOwner('Bob Payments Co');
  const aliceCustomer = await createCustomer(alice, 'Alice Only Customer');

  const bobPayAttempt = await bob
    .post('/api/payments')
    .send({ customerId: aliceCustomer, amount: '10.00', paymentMethod: 'cash' });
  assert.equal(bobPayAttempt.status, 404);

  const alicePayment = await alice
    .post('/api/payments')
    .send({ customerId: aliceCustomer, amount: '10.00', paymentMethod: 'cash' });
  assert.equal(alicePayment.status, 201);

  const bobViewAttempt = await bob.get(`/api/payments/${alicePayment.body.id}`);
  assert.equal(bobViewAttempt.status, 404);

  const bobList = await bob.get('/api/payments');
  assert.equal(bobList.body.length, 0); // Alice's payment never leaks into Bob's company-wide list
});

test('payment routes require authentication', async () => {
  const res = await request(app).get('/api/payments');
  assert.equal(res.status, 401);
});
