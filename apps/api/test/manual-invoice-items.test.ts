import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Manual (no-category) invoice items — Quick Invoice's simplified item
// row (Phase 28): description/quantity/unitPrice only, no embroidery
// category and no formula engine involved. See invoice.service.ts's
// createManualInvoiceItem. Normal Invoice's category/formula path
// (createInvoiceItem) is completely unchanged — these tests also cover
// that both item kinds still work side by side on the same invoice.

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
    fullName: 'Manual Item Test Owner',
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
  const res = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.00', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('creates a manual item: lineAmount = quantity * unitPrice, computed server-side', async () => {
  const agent = await registeredOwner('Manual Item Co');
  const customerId = await createCustomer(agent, 'Manual Item Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ description: 'HEAD SKIP', quantity: '504', unitPrice: '375.41' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.items.length, 1);
  const item = res.body.items[0];
  assert.equal(item.description, 'HEAD SKIP');
  assert.equal(item.quantity, '504.00');
  assert.equal(item.calculatedUnitAmount, '375.41');
  assert.equal(item.calculatedTotal, '189206.64'); // 504 * 375.41
  assert.equal(item.categoryId, null);
  assert.equal(item.stitches, null);
  assert.equal(res.body.totalAmount, '189206.64');
  assert.equal(res.body.grandTotal, '189206.64');
});

test('a client-supplied total/lineAmount is never trusted — server always recalculates from quantity * unitPrice', async () => {
  const agent = await registeredOwner('Manual Item Trust Co');
  const customerId = await createCustomer(agent, 'Trust Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [
      {
        description: 'DUPATTA',
        quantity: '504',
        unitPrice: '131.03',
        // None of these are real fields the server accepts — if it
        // trusted any client-supplied total, these would corrupt it.
        calculatedTotal: '1.00',
        lineAmount: '1.00',
        amount: '1.00',
      },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.items[0].calculatedTotal, '66039.12'); // 504 * 131.03, never "1.00"
});

test('missing unitPrice on a manual item (no categoryId) is a clean 400', async () => {
  const agent = await registeredOwner('Manual Item Missing Price Co');
  const customerId = await createCustomer(agent, 'Missing Price Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ description: 'FRONT', quantity: '10' }],
  });
  assert.equal(res.status, 400);
});

test('missing description on a manual item is a clean 400', async () => {
  const agent = await registeredOwner('Manual Item Missing Desc Co');
  const customerId = await createCustomer(agent, 'Missing Desc Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ quantity: '10', unitPrice: '5.00' }],
  });
  assert.equal(res.status, 400);
});

test('a mixed invoice — one category item, one manual item — totals both correctly', async () => {
  const agent = await registeredOwner('Mixed Items Co');
  const customerId = await createCustomer(agent, 'Mixed Items Customer');
  const categoryId = await createCategory(agent); // rate 1.00, stitches/1000*rate

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [
      { categoryId, stitches: 10000, quantity: '2' }, // 10.00 unit, 20.00 total
      { description: 'Manual Add-On', quantity: '3', unitPrice: '5.00' }, // 15.00 total
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].categoryId, categoryId);
  assert.equal(res.body.items[0].calculatedTotal, '20.00');
  assert.equal(res.body.items[1].categoryId, null);
  assert.equal(res.body.items[1].calculatedTotal, '15.00');
  assert.equal(res.body.totalAmount, '35.00');
});

test('a manual-item invoice appears in the invoice list, customer ledger, and customer statement like any other invoice', async () => {
  const agent = await registeredOwner('Manual Item Visibility Co');
  const customerId = await createCustomer(agent, 'Visibility Customer', '0.00');

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    lotNumber: 'LOT-MANUAL-1',
    items: [{ description: 'Quick Item', quantity: '2', unitPrice: '50.00' }],
  });
  assert.equal(invoice.status, 201);

  const list = await agent.get('/api/invoices');
  assert.ok(list.body.some((i: { id: string }) => i.id === invoice.body.id));

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '100.00');
  assert.ok(ledger.body.entries.some((e: { referenceId: string }) => e.referenceId === invoice.body.id));

  const statement = await agent.get(`/api/customers/${customerId}/ledger/statement`);
  assert.equal(statement.status, 200);
  assert.ok(statement.body.entries.some((r: { type: string }) => r.type === 'INVOICE'));
});

test('a manual-item invoice can be paid, and shows up in Payments like any other invoice', async () => {
  const agent = await registeredOwner('Manual Item Paid Co');
  const customerId = await createCustomer(agent, 'Paid Customer');

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ description: 'Quick Paid Item', quantity: '1', unitPrice: '42.00' }],
  });
  assert.equal(invoice.status, 201);

  const payment = await agent.post('/api/payments').send({ customerId, amount: '42.00', paymentMethod: 'cash' });
  assert.equal(payment.status, 201);

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 1);
});

test('audit history records a manual-item invoice the same as any other', async () => {
  const agent = await registeredOwner('Manual Item Audit Co');
  const customerId = await createCustomer(agent, 'Audit Customer');

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ description: 'Audited Item', quantity: '1', unitPrice: '10.00' }],
  });
  assert.equal(invoice.status, 201);

  const logs = await agent.get('/api/audit-logs');
  assert.equal(logs.status, 200);
  assert.ok(logs.body.some((l: { action: string; entityId: string }) => l.action === 'INVOICE_CREATED' && l.entityId === invoice.body.id));
});

test('normal category items still require stitches — the schema nullable stitches column never loosens category-item validation', async () => {
  const agent = await registeredOwner('Category Still Requires Stitches Co');
  const customerId = await createCustomer(agent, 'Stitches Required Customer');
  const categoryId = await createCategory(agent);

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ categoryId, quantity: '1' }], // no stitches
  });
  assert.equal(res.status, 400);
});

test('a discount applies to a manual-item invoice using the same invoice-level discount rules', async () => {
  const agent = await registeredOwner('Manual Item Discount Co');
  const customerId = await createCustomer(agent, 'Discount Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    discountType: 'percentage',
    discountValue: '10',
    items: [{ description: 'Discounted Item', quantity: '1', unitPrice: '100.00' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, '100.00');
  assert.equal(res.body.discountAmount, '10.00');
  assert.equal(res.body.grandTotal, '90.00');
});
