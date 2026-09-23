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
    fullName: 'WhatsApp Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, input: { name: string; whatsapp?: string }) {
  const res = await agent.post('/api/customers').send(input);
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post('/api/categories').send({
    name: 'HS/HP',
    defaultRate: '1.20',
    formulaConfig: { expression: 'stitches / 1000 * rate' },
  });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createInvoice(
  agent: ReturnType<typeof request.agent>,
  customerId: string,
  categoryId: string,
) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '10',
    items: [{ categoryId, stitches: 12000 }],
  });
  assert.equal(res.status, 201);
  return res.body;
}

test('builds a WhatsApp click-to-chat share payload with all required fields', async () => {
  const agent = await registeredOwner('WhatsApp Full Co');
  const customerId = await createCustomer(agent, { name: 'Jane Doe', whatsapp: '+1 (415) 555-2671' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const share = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(share.status, 200);
  assert.equal(share.body.mode, 'click-to-chat');
  assert.equal(share.body.toPhone, '+1 (415) 555-2671');
  assert.ok(share.body.url.startsWith('https://wa.me/14155552671?text='));

  const message = decodeURIComponent(share.body.url.split('?text=')[1]);
  assert.match(message, /Jane Doe/);
  assert.match(message, new RegExp(invoice.invoiceNumber));
  assert.match(message, /Invoice Amount: 144\.00/);
  assert.match(message, /Previous Balance: 0\.00/);
  assert.match(message, /Paid Amount: 0\.00/);
  assert.match(message, /Current Balance: 144\.00/);
  assert.equal(share.body.message, message);
});

test('reflects previous balance and amount paid for a second invoice after a payment', async () => {
  const agent = await registeredOwner('WhatsApp Balances Co');
  const customerId = await createCustomer(agent, { name: 'Repeat Buyer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);

  const first = await createInvoice(agent, customerId, categoryId);
  assert.equal(first.totalAmount, '144.00');

  const payment = await agent.post('/api/payments').send({
    customerId,
    amount: '44.00',
    paymentMethod: 'cash',
  });
  assert.equal(payment.status, 201);

  const second = await createInvoice(agent, customerId, categoryId);
  // previous balance = 144.00 (first invoice) - 44.00 (payment) = 100.00
  assert.equal(second.previousBalance, '100.00');

  const share = await agent.get(`/api/invoices/${second.id}/whatsapp-share`);
  assert.equal(share.status, 200);
  const message = decodeURIComponent(share.body.url.split('?text=')[1]);
  assert.match(message, /Previous Balance: 100\.00/);
  assert.match(message, /Current Balance: 244\.00/);
});

test('rejects sharing when the customer has no saved WhatsApp number', async () => {
  const agent = await registeredOwner('WhatsApp Missing Co');
  const customerId = await createCustomer(agent, { name: 'No Number' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const share = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(share.status, 400);
  assert.equal(share.body.details.whatsapp, 'Customer has no WhatsApp number saved');
});

test('WhatsApp sharing is tenant isolated', async () => {
  const agentA = await registeredOwner('WhatsApp Tenant A');
  const customerId = await createCustomer(agentA, { name: 'Tenant A Customer', whatsapp: '1234567890' });
  const categoryId = await createCategory(agentA);
  const invoice = await createInvoice(agentA, customerId, categoryId);

  const agentB = await registeredOwner('WhatsApp Tenant B');
  const foreignShare = await agentB.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(foreignShare.status, 404);
});

test('WhatsApp share route requires authentication', async () => {
  const res = await request(app).get('/api/invoices/00000000-0000-0000-0000-000000000000/whatsapp-share');
  assert.equal(res.status, 401);
});
