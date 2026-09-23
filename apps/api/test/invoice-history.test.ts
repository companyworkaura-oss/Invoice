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
    fullName: 'Invoice History Test Owner',
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
  const res = await agent.post('/api/categories').send({
    name,
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
  extra: { invoiceDate?: string; notes?: string; status?: string } = {},
) {
  const stitches = Math.round(Number(amount) * 1000);
  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches }],
    ...extra,
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

test('computes paid/balance/paymentStatus per invoice via FIFO: UNPAID, PARTIAL, and PAID', async () => {
  const agent = await registeredOwner('History Fifo Co');
  const customerId = await createCustomer(agent, 'Fifo Customer');
  const categoryId = await createCategory(agent);

  const older = await createInvoice(agent, customerId, categoryId, '100.00');
  const newer = await createInvoice(agent, customerId, categoryId, '50.00');
  await recordPayment(agent, customerId, '120.00'); // pays off older(100) fully + 20 into newer(50)

  const res = await agent.get('/api/invoices');
  assert.equal(res.status, 200);
  const byId = new Map(res.body.map((inv: { id: string }) => [inv.id, inv]));

  const olderRow = byId.get(older.id);
  assert.equal(olderRow.paid, '100.00');
  assert.equal(olderRow.balance, '0.00');
  assert.equal(olderRow.paymentStatus, 'PAID');

  const newerRow = byId.get(newer.id);
  assert.equal(newerRow.paid, '20.00');
  assert.equal(newerRow.balance, '30.00');
  assert.equal(newerRow.paymentStatus, 'PARTIAL');
});

test('an invoice with no payment at all is UNPAID', async () => {
  const agent = await registeredOwner('History Unpaid Co');
  const customerId = await createCustomer(agent, 'Unpaid Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId, '75.00');

  const res = await agent.get('/api/invoices');
  const row = res.body.find((inv: { id: string }) => inv.id === invoice.id);
  assert.equal(row.paid, '0.00');
  assert.equal(row.balance, '75.00');
  assert.equal(row.paymentStatus, 'UNPAID');
});

test('a cancelled invoice always reports CANCELLED regardless of payment', async () => {
  const agent = await registeredOwner('History Cancelled Co');
  const customerId = await createCustomer(agent, 'Cancelled Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId, '60.00');

  // No route can set status='cancelled' (by design — see memory.md); set
  // it directly at the DB level purely to exercise this display case.
  await pool.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [invoice.id]);

  const res = await agent.get('/api/invoices');
  const row = res.body.find((inv: { id: string }) => inv.id === invoice.id);
  assert.equal(row.paymentStatus, 'CANCELLED');

  const byPaymentStatus = await agent.get('/api/invoices').query({ paymentStatus: 'CANCELLED' });
  assert.equal(byPaymentStatus.body.length, 1);
  assert.equal(byPaymentStatus.body[0].id, invoice.id);
});

test('search matches invoice number or customer name; date filter narrows by invoiceDate', async () => {
  const agent = await registeredOwner('History Search Co');
  const alice = await createCustomer(agent, 'Alice Buyer');
  const bob = await createCustomer(agent, 'Bob Buyer');
  const categoryId = await createCategory(agent);

  const aliceInvoice = await createInvoice(agent, alice, categoryId, '10.00', { invoiceDate: '2021-06-01' });
  await createInvoice(agent, bob, categoryId, '20.00', { invoiceDate: '2022-06-01' });

  const bySearchNumber = await agent.get('/api/invoices').query({ search: aliceInvoice.invoiceNumber });
  assert.equal(bySearchNumber.body.length, 1);
  assert.equal(bySearchNumber.body[0].id, aliceInvoice.id);

  const bySearchName = await agent.get('/api/invoices').query({ search: 'alice' });
  assert.equal(bySearchName.body.length, 1);
  assert.equal(bySearchName.body[0].customerName, 'Alice Buyer');

  const byDate = await agent.get('/api/invoices').query({ from: '2021-01-01', to: '2021-12-31' });
  assert.equal(byDate.body.length, 1);
  assert.equal(byDate.body[0].id, aliceInvoice.id);
});

test('duplicate copies items into a new draft without touching payments or the ledger', async () => {
  const agent = await registeredOwner('History Duplicate Co');
  const customerId = await createCustomer(agent, 'Duplicate Customer');
  const categoryId = await createCategory(agent);
  const original = await createInvoice(agent, customerId, categoryId, '90.00', { status: 'issued' });
  await recordPayment(agent, customerId, '90.00');

  const ledgerBefore = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledgerBefore.body.balance, '0.00');
  assert.equal(ledgerBefore.body.entries.length, 2); // INVOICE + PAYMENT

  const dup = await agent.post(`/api/invoices/${original.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.status, 'draft');
  assert.equal(dup.body.customerId, customerId);
  assert.equal(dup.body.totalAmount, '90.00');
  assert.equal(dup.body.items.length, original.items.length);
  assert.notEqual(dup.body.id, original.id);
  assert.notEqual(dup.body.invoiceNumber, original.invoiceNumber);

  // The new invoice posts exactly one new INVOICE ledger entry of its
  // own; the original's payment is untouched, so the customer now owes
  // exactly the duplicate's amount, nothing more, nothing borrowed from
  // the original's history.
  const ledgerAfter = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledgerAfter.body.balance, '90.00');
  assert.equal(ledgerAfter.body.entries.length, 3);

  const history = await agent.get('/api/invoices');
  const originalRow = history.body.find((inv: { id: string }) => inv.id === original.id);
  const dupRow = history.body.find((inv: { id: string }) => inv.id === dup.body.id);
  assert.equal(originalRow.paymentStatus, 'PAID');
  assert.equal(dupRow.paymentStatus, 'UNPAID');
});

test('duplicate rejects when an item references a category that no longer exists', async () => {
  const agent = await registeredOwner('History Duplicate Deleted Co');
  const customerId = await createCustomer(agent, 'Deleted Category Customer');
  const categoryId = await createCategory(agent);
  const original = await createInvoice(agent, customerId, categoryId, '40.00');

  // Categories can only be soft-disabled through the API (never hard
  // deleted); simulate the ON DELETE SET NULL case directly at the DB
  // level to exercise this rejection path.
  await pool.query('DELETE FROM embroidery_categories WHERE id = $1', [categoryId]);

  const dup = await agent.post(`/api/invoices/${original.id}/duplicate`);
  assert.equal(dup.status, 400);
  assert.match(dup.body.details.items, /deleted category/);
});

test('duplicate rejects when a category still exists but has since been disabled', async () => {
  const agent = await registeredOwner('History Duplicate Disabled Co');
  const customerId = await createCustomer(agent, 'Disabled Category Customer');
  const categoryId = await createCategory(agent);
  const original = await createInvoice(agent, customerId, categoryId, '40.00');

  const disableRes = await agent.post(`/api/categories/${categoryId}/disable`);
  assert.equal(disableRes.status, 200);

  const dup = await agent.post(`/api/invoices/${original.id}/duplicate`);
  assert.equal(dup.status, 400);
});

test('duplicate is tenant isolated', async () => {
  const agentA = await registeredOwner('History Duplicate Tenant A');
  const customerId = await createCustomer(agentA, 'Tenant A Customer');
  const categoryId = await createCategory(agentA);
  const invoice = await createInvoice(agentA, customerId, categoryId, '25.00');

  const agentB = await registeredOwner('History Duplicate Tenant B');
  const res = await agentB.post(`/api/invoices/${invoice.id}/duplicate`);
  assert.equal(res.status, 404);
});
