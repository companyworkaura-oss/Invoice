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
    fullName: 'Dashboard Test Owner',
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

async function createCategory(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post('/api/categories').send({
    name: 'HS/HP',
    defaultRate: '1.00',
    formulaConfig: { expression: 'stitches / 1000 * rate' },
  });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createInvoice(
  agent: ReturnType<typeof request.agent>,
  customerId: string,
  categoryId: string,
  amount: string,
  invoiceDate?: string,
) {
  // stitches / 1000 * rate(1.00) * quantity(1) = amount, so stitches = amount * 1000
  const stitches = Math.round(Number(amount) * 1000);
  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    invoiceDate,
    items: [{ categoryId, stitches }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, amount);
  return res.body;
}

async function recordPayment(agent: ReturnType<typeof request.agent>, customerId: string, amount: string) {
  const res = await agent.post('/api/payments').send({ customerId, amount, paymentMethod: 'cash' });
  assert.equal(res.status, 201);
  return res.body;
}

test('computes today cards, recent lists, and outstanding customers from backend data', async () => {
  const agent = await registeredOwner('Dashboard Today Co');
  const customerId = await createCustomer(agent, 'Dash Customer');
  const categoryId = await createCategory(agent);

  await createInvoice(agent, customerId, categoryId, '100.00');
  const payment = await recordPayment(agent, customerId, '40.00');

  const res = await agent.get('/api/dashboard?range=today');
  assert.equal(res.status, 200);
  assert.equal(res.body.period.range, 'today');
  assert.equal(res.body.period.from, res.body.period.to);

  assert.equal(res.body.cards.invoiceAmount, '100.00');
  assert.equal(res.body.cards.paymentsReceived, '40.00');
  assert.equal(res.body.cards.totalReceivable, '60.00');
  assert.equal(res.body.cards.unpaidOrPartialInvoiceCount, 1);

  assert.equal(res.body.recentInvoices.length, 1);
  assert.equal(res.body.recentInvoices[0].customerName, 'Dash Customer');
  assert.equal(res.body.recentInvoices[0].totalAmount, '100.00');

  assert.equal(res.body.recentPayments.length, 1);
  assert.equal(res.body.recentPayments[0].id, payment.id);
  assert.equal(res.body.recentPayments[0].amount, '40.00');

  assert.equal(res.body.customersWithOutstandingBalance.length, 1);
  assert.equal(res.body.customersWithOutstandingBalance[0].name, 'Dash Customer');
  assert.equal(res.body.customersWithOutstandingBalance[0].balance, '60.00');
});

test('"today" excludes invoices/payments dated outside today, "custom" range includes them', async () => {
  const agent = await registeredOwner('Dashboard Past Co');
  const customerId = await createCustomer(agent, 'Past Customer');
  const categoryId = await createCategory(agent);

  await createInvoice(agent, customerId, categoryId, '75.00', '2020-01-15');

  const today = await agent.get('/api/dashboard?range=today');
  assert.equal(today.status, 200);
  assert.equal(today.body.cards.invoiceAmount, '0.00');
  assert.equal(today.body.recentInvoices.length, 0);

  const custom = await agent.get('/api/dashboard?range=custom&from=2020-01-01&to=2020-01-31');
  assert.equal(custom.status, 200);
  assert.equal(custom.body.cards.invoiceAmount, '75.00');
  assert.equal(custom.body.recentInvoices.length, 1);
  assert.equal(custom.body.recentInvoices[0].invoiceDate, '2020-01-15');

  // Current-state cards are the same regardless of the period filter.
  assert.equal(custom.body.cards.totalReceivable, today.body.cards.totalReceivable);
});

test('"month" range covers the whole current calendar month', async () => {
  const agent = await registeredOwner('Dashboard Month Co');
  const customerId = await createCustomer(agent, 'Month Customer');
  const categoryId = await createCategory(agent);
  await createInvoice(agent, customerId, categoryId, '30.00');

  const res = await agent.get('/api/dashboard?range=month');
  assert.equal(res.status, 200);
  assert.equal(res.body.cards.invoiceAmount, '30.00');
  assert.ok(res.body.period.from <= res.body.period.to);
  assert.equal(res.body.period.from.slice(0, 7), res.body.period.to.slice(0, 7));
});

test('unpaid/partial invoice count applies FIFO: paying off the older invoice leaves only the newer one flagged', async () => {
  const agent = await registeredOwner('Dashboard Fifo Co');
  const customerId = await createCustomer(agent, 'Fifo Customer');
  const categoryId = await createCategory(agent);

  await createInvoice(agent, customerId, categoryId, '100.00'); // older
  await createInvoice(agent, customerId, categoryId, '50.00'); // newer
  await recordPayment(agent, customerId, '100.00'); // exactly pays off the older one

  const res = await agent.get('/api/dashboard?range=month');
  assert.equal(res.status, 200);
  assert.equal(res.body.cards.totalReceivable, '50.00');
  assert.equal(res.body.cards.unpaidOrPartialInvoiceCount, 1);

  // A further partial payment into the newer invoice still leaves it (only it) flagged.
  await recordPayment(agent, customerId, '20.00');
  const res2 = await agent.get('/api/dashboard?range=month');
  assert.equal(res2.body.cards.totalReceivable, '30.00');
  assert.equal(res2.body.cards.unpaidOrPartialInvoiceCount, 1);
});

test('a fully paid customer has no outstanding balance and no unpaid invoices', async () => {
  const agent = await registeredOwner('Dashboard Paid Co');
  const customerId = await createCustomer(agent, 'Paid Customer');
  const categoryId = await createCategory(agent);
  await createInvoice(agent, customerId, categoryId, '80.00');
  await recordPayment(agent, customerId, '80.00');

  const res = await agent.get('/api/dashboard?range=month');
  assert.equal(res.body.cards.totalReceivable, '0.00');
  assert.equal(res.body.cards.unpaidOrPartialInvoiceCount, 0);
  assert.equal(res.body.customersWithOutstandingBalance.length, 0);
});

test('rejects an invalid range value', async () => {
  const agent = await registeredOwner('Dashboard Invalid Range Co');
  const res = await agent.get('/api/dashboard?range=yesterday');
  assert.equal(res.status, 400);
});

test('custom range requires both from and to, and from must not be after to', async () => {
  const agent = await registeredOwner('Dashboard Custom Validation Co');

  const missingTo = await agent.get('/api/dashboard?range=custom&from=2024-01-01');
  assert.equal(missingTo.status, 400);

  const missingBoth = await agent.get('/api/dashboard?range=custom');
  assert.equal(missingBoth.status, 400);

  const badOrder = await agent.get('/api/dashboard?range=custom&from=2024-02-01&to=2024-01-01');
  assert.equal(badOrder.status, 400);

  const ok = await agent.get('/api/dashboard?range=custom&from=2024-01-01&to=2024-02-01');
  assert.equal(ok.status, 200);
});

test('dashboard data is tenant isolated', async () => {
  const agentA = await registeredOwner('Dashboard Tenant A');
  const customerId = await createCustomer(agentA, 'Tenant A Customer');
  const categoryId = await createCategory(agentA);
  await createInvoice(agentA, customerId, categoryId, '500.00');

  const agentB = await registeredOwner('Dashboard Tenant B');
  const res = await agentB.get('/api/dashboard?range=custom&from=2000-01-01&to=2099-12-31');
  assert.equal(res.status, 200);
  assert.equal(res.body.cards.invoiceAmount, '0.00');
  assert.equal(res.body.cards.totalReceivable, '0.00');
  assert.equal(res.body.recentInvoices.length, 0);
  assert.equal(res.body.customersWithOutstandingBalance.length, 0);
});

test('dashboard requires authentication', async () => {
  const res = await request(app).get('/api/dashboard');
  assert.equal(res.status, 401);
});
