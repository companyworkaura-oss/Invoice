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
    fullName: 'Statement Test Owner',
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
  invoiceDate: string,
) {
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

async function recordPayment(
  agent: ReturnType<typeof request.agent>,
  customerId: string,
  amount: string,
  date: string,
  extra: { reference?: string; paymentMethod?: string } = {},
) {
  const res = await agent.post('/api/payments').send({
    customerId,
    amount,
    date,
    paymentMethod: extra.paymentMethod ?? 'cash',
    reference: extra.reference,
  });
  assert.equal(res.status, 201);
  return res.body;
}

async function setupHistory(agent: ReturnType<typeof request.agent>) {
  const customerId = await createCustomer(agent, 'Statement Customer');
  const categoryId = await createCategory(agent);

  const invoice1 = await createInvoice(agent, customerId, categoryId, '100.00', '2021-01-10');
  const payment1 = await recordPayment(agent, customerId, '40.00', '2021-01-20', { paymentMethod: 'cash' });
  const invoice2 = await createInvoice(agent, customerId, categoryId, '50.00', '2021-02-05');
  const payment2 = await recordPayment(agent, customerId, '60.00', '2021-02-10', {
    paymentMethod: 'bank',
    reference: 'BANK-REF-9',
  });

  return { customerId, invoice1, invoice2, payment1, payment2 };
}

test('full statement (no filters): all entries, running balance, and summary derived from the whole ledger', async () => {
  const agent = await registeredOwner('Statement Full Co');
  const { customerId, invoice1, invoice2 } = await setupHistory(agent);

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`);
  assert.equal(res.status, 200);
  assert.equal(res.body.customerName, 'Statement Customer');
  assert.equal(res.body.from, null);
  assert.equal(res.body.to, null);
  assert.equal(res.body.openingBalance, '0.00');
  assert.equal(res.body.invoiceTotal, '150.00');
  assert.equal(res.body.payments, '100.00');
  assert.equal(res.body.closingBalance, '50.00');

  const entries = res.body.entries;
  assert.equal(entries.length, 4);
  assert.equal(entries[0].date, '2021-01-10');
  assert.equal(entries[0].type, 'INVOICE');
  assert.equal(entries[0].reference, invoice1.invoiceNumber);
  assert.equal(entries[0].debit, '100.00');
  assert.equal(entries[0].runningBalance, '100.00');

  assert.equal(entries[1].date, '2021-01-20');
  assert.equal(entries[1].type, 'PAYMENT');
  assert.equal(entries[1].reference, 'Cash');
  assert.equal(entries[1].credit, '40.00');
  assert.equal(entries[1].runningBalance, '60.00');

  assert.equal(entries[2].date, '2021-02-05');
  assert.equal(entries[2].reference, invoice2.invoiceNumber);
  assert.equal(entries[2].runningBalance, '110.00');

  assert.equal(entries[3].date, '2021-02-10');
  assert.equal(entries[3].type, 'PAYMENT');
  assert.equal(entries[3].reference, 'BANK-REF-9');
  assert.equal(entries[3].credit, '60.00');
  assert.equal(entries[3].runningBalance, '50.00');
});

test('date range: opening balance rolls up earlier entries, later entries are excluded entirely', async () => {
  const agent = await registeredOwner('Statement Range Co');
  const { customerId } = await setupHistory(agent);

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`).query({ from: '2021-02-01', to: '2021-02-28' });
  assert.equal(res.status, 200);
  assert.equal(res.body.openingBalance, '60.00'); // 100 - 40 carried in from January
  assert.equal(res.body.invoiceTotal, '50.00');
  assert.equal(res.body.payments, '60.00');
  assert.equal(res.body.closingBalance, '50.00');

  assert.equal(res.body.entries.length, 2);
  assert.equal(res.body.entries[0].date, '2021-02-05');
  assert.equal(res.body.entries[0].runningBalance, '110.00');
  assert.equal(res.body.entries[1].date, '2021-02-10');
  assert.equal(res.body.entries[1].runningBalance, '50.00');
});

test('an empty period returns a zero-row statement with opening === closing', async () => {
  const agent = await registeredOwner('Statement Empty Co');
  const { customerId } = await setupHistory(agent);

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`).query({ from: '2021-06-01', to: '2021-06-30' });
  assert.equal(res.status, 200);
  assert.equal(res.body.entries.length, 0);
  assert.equal(res.body.openingBalance, '50.00'); // the full Jan/Feb history: 100 - 40 + 50 - 60 = 50
  assert.equal(res.body.openingBalance, res.body.closingBalance);
  assert.equal(res.body.invoiceTotal, '0.00');
  assert.equal(res.body.payments, '0.00');
});

test('transaction type filter narrows the rows without changing the summary', async () => {
  const agent = await registeredOwner('Statement Type Filter Co');
  const { customerId } = await setupHistory(agent);

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`).query({ type: 'PAYMENT' });
  assert.equal(res.status, 200);
  assert.equal(res.body.entries.length, 2);
  assert.ok(res.body.entries.every((e: { type: string }) => e.type === 'PAYMENT'));
  // Summary still reflects the whole (unfiltered-by-type) history.
  assert.equal(res.body.invoiceTotal, '150.00');
  assert.equal(res.body.payments, '100.00');
  assert.equal(res.body.closingBalance, '50.00');
});

test('rejects an invalid transaction type', async () => {
  const agent = await registeredOwner('Statement Invalid Type Co');
  const customerId = await createCustomer(agent, 'Bad Filter Customer');

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`).query({ type: 'REFUND' });
  assert.equal(res.status, 400);
});

test('an opening-balance customer shows OPENING_BALANCE as its own statement row', async () => {
  const agent = await registeredOwner('Statement Opening Co');
  const customerId = await createCustomer(agent, 'Seeded Customer', '500.00');

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement`);
  assert.equal(res.status, 200);
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].type, 'OPENING_BALANCE');
  assert.equal(res.body.entries[0].reference, 'Opening Balance');
  assert.equal(res.body.entries[0].debit, '500.00');
  assert.equal(res.body.closingBalance, '500.00');
});

test('downloads a real PDF statement', async () => {
  const agent = await registeredOwner('Statement PDF Co');
  const { customerId } = await setupHistory(agent);

  const res = await agent.get(`/api/customers/${customerId}/ledger/statement/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="Statement-Statement-Customer\.pdf"/);

  const buffer = res.body as Buffer;
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(buffer.length > 500);
});

test('statement is tenant isolated', async () => {
  const agentA = await registeredOwner('Statement Tenant A');
  const { customerId } = await setupHistory(agentA);

  const agentB = await registeredOwner('Statement Tenant B');
  const res = await agentB.get(`/api/customers/${customerId}/ledger/statement`);
  assert.equal(res.status, 404);

  const pdfRes = await agentB.get(`/api/customers/${customerId}/ledger/statement/pdf`);
  assert.equal(pdfRes.status, 404);
});

test('statement routes require authentication', async () => {
  const res = await request(app).get('/api/customers/00000000-0000-0000-0000-000000000000/ledger/statement');
  assert.equal(res.status, 401);
});
