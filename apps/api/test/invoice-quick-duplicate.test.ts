import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F08 — Quick Invoice duplicate must support manual items
// (re-verification, not a new fix): this report's F08 is the exact
// same root cause already fixed as "F07" in Phase 52 —
// duplicateInvoice's old guard treated every item with a null
// categoryId as a sign of a deleted category, which meant a Quick
// Invoice (every item of which has categoryId === null by design —
// see InvoiceItem.categoryId's doc comment) could never be
// duplicated at all. invoiceMode, derived server-side from the items
// actually saved (see invoiceModeFromItems in invoice.service.ts), is
// the reliable discriminator duplicateInvoice already uses: the
// "deleted category" guard only ever runs for a standard invoice
// (invoiceMode !== 'quick'), so a Quick Invoice's null categoryId
// never trips it, while a standard invoice's genuinely deleted
// category still does.
//
// These tests exercise every case this report's own test list (1-7)
// calls for, independently of (and in addition to) the pre-existing
// "F07"-labeled coverage in invoice-history.test.ts.

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
    fullName: 'Quick Duplicate Test Owner',
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

// ---- 1. Quick Invoice with one manual item: categoryId = null, duplicate succeeds ----

test('F08: a Quick Invoice with a single manual item (categoryId null) duplicates successfully', async () => {
  const agent = await registeredOwner('F08 Single Item Co');
  const customerId = await createCustomer(agent, 'Single Item Customer');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Custom embroidery', quantity: '2', unitPrice: '15.00' }],
  });
  assert.equal(original.status, 201);
  assert.equal(original.body.invoiceMode, 'quick');
  assert.equal(original.body.items[0].categoryId, null);

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.invoiceMode, 'quick');
  assert.equal(dup.body.items[0].categoryId, null);
});

// ---- 2. Multiple manual items: all descriptions/quantities/unit prices copy correctly ----

test('F08: a Quick Invoice with multiple manual items copies every description/quantity/unitPrice exactly', async () => {
  const agent = await registeredOwner('F08 Multi Item Co');
  const customerId = await createCustomer(agent, 'Multi Item Customer');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { description: 'Custom Embroidery Job', quantity: '3', unitPrice: '25.00' },
      { description: 'Rush Fee', quantity: '1', unitPrice: '10.00' },
      { description: 'Thread Upgrade', quantity: '2', unitPrice: '4.50' },
    ],
  });
  assert.equal(original.status, 201);

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.items.length, 3);

  const byDescription = (description: string) =>
    dup.body.items.find((i: { description: string }) => i.description === description);

  const job = byDescription('Custom Embroidery Job');
  assert.equal(job.quantity, '3.00');
  assert.equal(job.calculatedUnitAmount, '25.00');
  assert.equal(job.calculatedTotal, '75.00');

  const rush = byDescription('Rush Fee');
  assert.equal(rush.quantity, '1.00');
  assert.equal(rush.calculatedUnitAmount, '10.00');
  assert.equal(rush.calculatedTotal, '10.00');

  const thread = byDescription('Thread Upgrade');
  assert.equal(thread.quantity, '2.00');
  assert.equal(thread.calculatedUnitAmount, '4.50');
  assert.equal(thread.calculatedTotal, '9.00');

  assert.equal(dup.body.totalAmount, '94.00'); // 75 + 10 + 9
});

// ---- 3. Duplicated Quick Invoice receives a new invoice number/id ----

test('F08: a duplicated Quick Invoice gets a new id and a new invoice number, never the original\'s', async () => {
  const agent = await registeredOwner('F08 New Number Co');
  const customerId = await createCustomer(agent, 'New Number Customer');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Custom embroidery', quantity: '1', unitPrice: '50.00' }],
  });
  assert.equal(original.status, 201);

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.notEqual(dup.body.id, original.body.id);
  assert.notEqual(dup.body.invoiceNumber, original.body.invoiceNumber);
  assert.equal(dup.body.status, 'draft');
});

// ---- 4. Payment history is not duplicated ----

test('F08: duplicating a paid Quick Invoice does not copy its payment — the duplicate starts fully unpaid', async () => {
  const agent = await registeredOwner('F08 No Payment Copy Co');
  const customerId = await createCustomer(agent, 'No Payment Copy Customer');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Custom embroidery', quantity: '1', unitPrice: '60.00' }],
  });
  assert.equal(original.status, 201);
  await agent.post('/api/payments').send({ customerId, amount: '60.00', paymentMethod: 'cash' });

  const originalReread = await agent.get(`/api/invoices/${original.body.id}`);
  assert.equal(originalReread.body.amountPaid, '60.00');

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.amountPaid, '0.00');

  const payments = await agent.get('/api/payments').query({ customerId });
  assert.equal(payments.body.length, 1, 'no second payment was created for the duplicate');
});

// ---- 5. Standard Invoice duplication still works ----

test('F08: Standard Invoice duplication is unaffected — still copies category items and amounts', async () => {
  const agent = await registeredOwner('F08 Standard Unaffected Co');
  const customerId = await createCustomer(agent, 'Standard Unaffected Customer');
  const categoryId = await createCategory(agent);

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '2' }],
  });
  assert.equal(original.status, 201);
  assert.equal(original.body.invoiceMode, 'standard');

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.invoiceMode, 'standard');
  assert.equal(dup.body.items[0].categoryId, categoryId);
  assert.equal(dup.body.totalAmount, original.body.totalAmount);
});

// ---- 6. Standard Invoice with a genuinely deleted category keeps its existing behavior ----

test('F08: a Standard Invoice item referencing a genuinely deleted category still rejects duplication', async () => {
  const agent = await registeredOwner('F08 Deleted Category Co');
  const customerId = await createCustomer(agent, 'Deleted Category Customer');
  const categoryId = await createCategory(agent);

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }],
  });
  assert.equal(original.status, 201);

  // Categories can only be soft-disabled through the API (never hard
  // deleted); simulate the ON DELETE SET NULL case directly to exercise
  // this rejection path, same as the pre-existing F07 coverage.
  await pool.query('DELETE FROM embroidery_categories WHERE id = $1', [categoryId]);

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 400);
  assert.match(dup.body.details.items, /deleted category/);
});

// ---- 7. No "category deleted" error for valid Quick manual items ----

test('F08: a Quick Invoice\'s manual items (categoryId null by design) never trigger the "deleted category" error', async () => {
  const agent = await registeredOwner('F08 No False Positive Co');
  const customerId = await createCustomer(agent, 'No False Positive Customer');

  const original = await agent.post('/api/invoices').send({
    customerId,
    items: [
      { description: 'Item A', quantity: '1', unitPrice: '10.00' },
      { description: 'Item B', quantity: '1', unitPrice: '20.00' },
    ],
  });
  assert.equal(original.status, 201);

  const dup = await agent.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201, 'a valid Quick Invoice must never be rejected as if its category were deleted');
  assert.equal(dup.body.items.length, 2);
});
