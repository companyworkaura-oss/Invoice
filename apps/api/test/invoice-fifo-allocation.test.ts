import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F05 — one authoritative payment-allocation policy: a customer's
// payments/credits pay off their *oldest* outstanding debt first
// (FIFO), across EVERY positive-debit ledger entry type (opening
// balance, invoice, debit adjustment) — never just INVOICE-type rows.
// This policy already lives in one shared SQL fragment,
// `fifoPaidCtes` (apps/api/src/lib/ledger-fifo.ts), reused by
// listInvoices, getInvoicePaidAmount (invoice detail + the delete
// guard), and the dashboard's unpaid/partial count, so all four agree
// by construction. These tests exercise the exact scenarios this
// report's finding calls for (A-F), independent of (and in addition
// to) the pre-existing F04-labeled tests in invoice-archive.test.ts
// and ledger.test.ts that already cover closely related ground.

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
    fullName: 'FIFO Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
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

/** A single-item draft invoice with an exact 100.00 total (1.00 rate * 100000 stitches / 1000). */
async function createHundredDollarInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 100000, quantity: '1' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, '100.00');
  return res.body as { id: string; invoiceNumber: string };
}

async function recordPayment(agent: ReturnType<typeof request.agent>, customerId: string, amount: string) {
  const res = await agent.post('/api/payments').send({ customerId, amount, paymentMethod: 'cash' });
  assert.equal(res.status, 201);
  return res.body;
}

async function recordAdjustment(agent: ReturnType<typeof request.agent>, customerId: string, debit: string, notes: string) {
  const res = await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ debit, notes });
  assert.equal(res.status, 201);
  return res.body;
}

// ---- A: the exact reported scenario ----

test('F05-A: invoice 100, later debit adjustment 100, payment 100 -> invoice stays PAID everywhere, delete rejected', async () => {
  const agent = await registeredOwner('F05 Scenario A Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario A Customer' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);
  await recordAdjustment(agent, customerId, '100.00', 'later unrelated debt');
  await recordPayment(agent, customerId, '100.00');

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.amountPaid, '100.00');

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === invoice.id);
  assert.equal(listed.paid, '100.00');
  assert.equal(listed.paymentStatus, 'PAID');

  const dashboard = await agent.get('/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.cards.unpaidOrPartialInvoiceCount, 0);

  // detail/list must agree exactly, not just both happen to be "paid"
  assert.equal(detail.body.amountPaid, listed.paid);

  const del = await agent.delete(`/api/invoices/${invoice.id}`);
  assert.equal(del.status, 400);
  assert.match(del.body.details?.payments ?? '', /payment/i);
});

// ---- B: opening balance before the invoice ----

test('F05-B: an opening balance older than the invoice is paid off first — the invoice stays unpaid', async () => {
  const agent = await registeredOwner('F05 Scenario B Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario B Customer', openingBalance: '50.00' });
  const customerId = customer.body.id;

  await recordPayment(agent, customerId, '50.00'); // pays off the opening balance exactly
  const categoryId = await createCategory(agent);
  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.body.amountPaid, '0.00', 'the opening balance, being older, absorbs the payment — not the newer invoice');

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === invoice.id);
  assert.equal(listed.paid, '0.00');
  assert.equal(listed.paymentStatus, 'UNPAID');
});

// ---- C: a debit adjustment before the invoice ----

test('F05-C: a debit adjustment older than the invoice is paid off first — the invoice stays unpaid', async () => {
  const agent = await registeredOwner('F05 Scenario C Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario C Customer' });
  const customerId = customer.body.id;

  await recordAdjustment(agent, customerId, '50.00', 'earlier unrelated debt');
  const categoryId = await createCategory(agent);
  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);
  await recordPayment(agent, customerId, '50.00');

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.body.amountPaid, '0.00', 'the older adjustment absorbs the payment — not the newer invoice');

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === invoice.id);
  assert.equal(listed.paid, '0.00');
  assert.equal(listed.paymentStatus, 'UNPAID');

  const dashboard = await agent.get('/api/dashboard');
  assert.equal(dashboard.body.cards.unpaidOrPartialInvoiceCount, 1, 'the invoice is still unpaid, so it must count here');
});

// ---- D: a debit adjustment after the invoice ----

test('F05-D: a debit adjustment newer than the invoice sits behind it — the payment reaches the older invoice instead', async () => {
  const agent = await registeredOwner('F05 Scenario D Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario D Customer' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);
  await recordAdjustment(agent, customerId, '50.00', 'later unrelated debt');
  await recordPayment(agent, customerId, '50.00');

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.body.amountPaid, '50.00', 'the older invoice is paid first — the newer adjustment is still owed');

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === invoice.id);
  assert.equal(listed.paid, '50.00');
  assert.equal(listed.paymentStatus, 'PARTIAL');

  const dashboard = await agent.get('/api/dashboard');
  assert.equal(dashboard.body.cards.unpaidOrPartialInvoiceCount, 1, 'still only partially paid, so it must count here');
});

// ---- E: completely unpaid draft, delete remains allowed ----

test('F05-E: a completely unpaid draft invoice, even with an unrelated newer adjustment, is still deletable', async () => {
  const agent = await registeredOwner('F05 Scenario E Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario E Customer' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);
  await recordAdjustment(agent, customerId, '30.00', 'unrelated newer debt, never paid');

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.body.amountPaid, '0.00');

  const del = await agent.delete(`/api/invoices/${invoice.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);
});

// ---- F: partially paid invoice, correct status and delete rejected ----

test('F05-F: a partially paid draft invoice reports the correct paid amount/status everywhere and delete is rejected', async () => {
  const agent = await registeredOwner('F05 Scenario F Co');
  const customer = await agent.post('/api/customers').send({ name: 'Scenario F Customer' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await createHundredDollarInvoice(agent, customerId, categoryId);
  await recordPayment(agent, customerId, '40.00');

  const detail = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(detail.body.amountPaid, '40.00');

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === invoice.id);
  assert.equal(listed.paid, '40.00');
  assert.equal(listed.balance, '60.00');
  assert.equal(listed.paymentStatus, 'PARTIAL');

  const dashboard = await agent.get('/api/dashboard');
  assert.equal(dashboard.body.cards.unpaidOrPartialInvoiceCount, 1);

  const del = await agent.delete(`/api/invoices/${invoice.id}`);
  assert.equal(del.status, 400);
  assert.match(del.body.details?.payments ?? '', /payment/i);
});
