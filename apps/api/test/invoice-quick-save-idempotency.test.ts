import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F11 — Quick Invoice's "Save as Paid" used to be two separate
// requests (POST /invoices, then POST /payments) with no transaction
// tying them together: a zero-total (100%-discounted) invoice's
// payment always failed (the backend rejects a zero-amount payment),
// and a failure/retry between the two requests could create a
// duplicate invoice. POST /invoices now accepts optional
// paid/paymentMethod/idempotencyKey fields: when `paid` is set, the
// invoice and its initial payment are created in one transaction
// (createInvoiceCore in invoice.service.ts); when `idempotencyKey` is
// also given, a retry with the same key returns the original invoice
// instead of creating a second one (createInvoiceIdempotent).

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
    fullName: 'Quick Save Test Owner',
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

function quickItem(description: string, quantity: string, unitPrice: string) {
  return { description, quantity, unitPrice };
}

// ---- 1. Zero-total (100% discount) Paid Quick Invoice ----

test('F11: a Quick Invoice with a 100% discount saves once as Paid, with no zero-value payment and no false failure', async () => {
  const agent = await registeredOwner('F11 Zero Total Co');
  const customerId = await createCustomer(agent, 'Zero Total Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [quickItem('Custom embroidery', '1', '100.00')],
    discountType: 'percentage',
    discountValue: '100',
    paid: true,
    paymentMethod: 'cash',
    idempotencyKey: 'zero-total-key-1',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.grandTotal, '0.00');
  assert.equal(res.body.amountPaid, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 0, 'a zero-value payment must never be attempted');

  const invoices = await agent.get('/api/invoices').query({ customerId });
  assert.equal(invoices.body.length, 1, 'exactly one invoice must exist');
});

// ---- 2. Non-zero Paid Quick Invoice: invoice and payment both succeed ----

test('F11: a non-zero Quick Invoice saved as Paid creates exactly one invoice and one payment, atomically', async () => {
  const agent = await registeredOwner('F11 Non Zero Co');
  const customerId = await createCustomer(agent, 'Non Zero Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [quickItem('Custom embroidery', '1', '250.00')],
    paid: true,
    paymentMethod: 'bank',
    idempotencyKey: 'non-zero-key-1',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.grandTotal, '250.00');
  assert.equal(res.body.amountPaid, '250.00');
  assert.equal(res.body.currentBalance, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 1);
  assert.equal(payments.body[0].amount, '250.00');
  assert.equal(payments.body[0].paymentMethod, 'bank');

  const invoices = await agent.get('/api/invoices').query({ customerId });
  assert.equal(invoices.body.length, 1);
});

// ---- 3. Retry with the same idempotency key never duplicates ----

test('F11: retrying the exact same paid save (same idempotencyKey) does not create a duplicate invoice or payment', async () => {
  const agent = await registeredOwner('F11 Retry Co');
  const customerId = await createCustomer(agent, 'Retry Customer');
  const body = {
    customerId,
    items: [quickItem('Custom embroidery', '1', '80.00')],
    paid: true,
    paymentMethod: 'cash',
    idempotencyKey: 'retry-key-1',
  };

  const first = await agent.post('/api/invoices').send(body);
  assert.equal(first.status, 201);

  const second = await agent.post('/api/invoices').send(body);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id, 'the retry must return the exact same invoice');

  const invoices = await agent.get('/api/invoices').query({ customerId });
  assert.equal(invoices.body.length, 1, 'no duplicate invoice');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 1, 'no duplicate payment');
});

test('F11: a different idempotencyKey for the same customer is treated as a genuinely new save', async () => {
  const agent = await registeredOwner('F11 Different Key Co');
  const customerId = await createCustomer(agent, 'Different Key Customer');
  const baseBody = { customerId, items: [quickItem('Custom embroidery', '1', '40.00')], paid: true, paymentMethod: 'cash' as const };

  const first = await agent.post('/api/invoices').send({ ...baseBody, idempotencyKey: 'key-a' });
  const second = await agent.post('/api/invoices').send({ ...baseBody, idempotencyKey: 'key-b' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.id, second.body.id);

  const invoices = await agent.get('/api/invoices').query({ customerId });
  assert.equal(invoices.body.length, 2);
});

// ---- 4. An unpaid Quick Invoice is unaffected ----

test('F11: an unpaid Quick Invoice never creates a payment', async () => {
  const agent = await registeredOwner('F11 Unpaid Co');
  const customerId = await createCustomer(agent, 'Unpaid Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [quickItem('Custom embroidery', '1', '60.00')],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.amountPaid, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 0);
});

// ---- 5. F04 discount rounding still applies under the atomic path ----

test('F11: F04 discount rounding is unaffected by the atomic create-and-pay path', async () => {
  const agent = await registeredOwner('F11 Rounding Co');
  const customerId = await createCustomer(agent, 'Rounding Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [quickItem('Custom embroidery', '1', '1.01')],
    discountType: 'percentage',
    discountValue: '50',
    paid: true,
    paymentMethod: 'cash',
    idempotencyKey: 'rounding-key-1',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.discountAmount, '0.51');
  assert.equal(res.body.grandTotal, '0.50');
  assert.equal(res.body.amountPaid, '0.50');
});

// ---- Standard Invoice is unaffected (never sends paid/idempotencyKey) ----

test('F11: Standard Invoice creation (no paid field) behaves exactly as before', async () => {
  const agent = await registeredOwner('F11 Standard Unaffected Co');
  const customerId = await createCustomer(agent, 'Standard Unaffected Customer');
  const category = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.00', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(category.status, 201);

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId: category.body.id, stitches: 50000, quantity: '1' }],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.grandTotal, '50.00');
  assert.equal(res.body.amountPaid, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 0);
});

test('F11: paid without a paymentMethod is rejected with a validation error, not a crash', async () => {
  const agent = await registeredOwner('F11 Missing Method Co');
  const customerId = await createCustomer(agent, 'Missing Method Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [quickItem('Custom embroidery', '1', '30.00')],
    paid: true,
  });

  assert.equal(res.status, 400);
});
