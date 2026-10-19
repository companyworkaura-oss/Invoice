import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Per-invoice rate override for a category-based (Standard Invoice)
// item — the category's default_rate is only ever a starting point,
// never re-applied later. createInvoiceItem's `input.rate ?? category.
// defaultRate` plus the snapshot columns on invoice_items already
// implement this; invoices.test.ts already covers "rate override is
// honored" and "snapshots survive later category changes" at create
// time. This file fills the remaining gaps from the feature's test
// checklist: the override surviving an EDIT (not just create), a
// category switch resetting to the NEW category's default when no
// rate is supplied, and confirming Quick Invoice's manual items are
// completely untouched by any of this.

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
    fullName: 'Rate Override Test Owner',
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

async function createCategory(
  agent: ReturnType<typeof request.agent>,
  name: string,
  defaultRate: string,
  expression = 'stitches / 1000 * rate',
) {
  const res = await agent.post('/api/categories').send({ name, defaultRate, formulaConfig: { expression } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('creating with no rate auto-uses the category default, and the saved item carries that exact rate', async () => {
  const agent = await registeredOwner('Rate Default Co');
  const customerId = await createCustomer(agent, 'Rate Default Customer');
  const categoryId = await createCategory(agent, 'HEAD SKIP', '1.50');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].rate, '1.50');
  // unit = 12 * 1.50 = 18.00 ; total = 18.00 * 10 = 180.00
  assert.equal(created.body.items[0].calculatedUnitAmount, '18.00');
  assert.equal(created.body.items[0].calculatedTotal, '180.00');
});

test('overriding the rate on create recalculates the amount correctly from the new rate', async () => {
  const agent = await registeredOwner('Rate Create Override Co');
  const customerId = await createCustomer(agent, 'Rate Create Override Customer');
  const categoryId = await createCategory(agent, 'HEAD SKIP', '1.50');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10', rate: '1.70' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].rate, '1.70');
  // unit = 12 * 1.70 = 20.40 ; total = 20.40 * 10 = 204.00
  assert.equal(created.body.items[0].calculatedUnitAmount, '20.40');
  assert.equal(created.body.items[0].calculatedTotal, '204.00');
});

test('editing a draft invoice to change the rate persists the new rate — reopening shows it, not the category default', async () => {
  const agent = await registeredOwner('Rate Edit Co');
  const customerId = await createCustomer(agent, 'Rate Edit Customer');
  const categoryId = await createCategory(agent, 'HEAD SKIP', '1.50');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }], // uses default 1.50
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].rate, '1.50');

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId, stitches: 12000, quantity: '10', rate: '1.70' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.items[0].rate, '1.70');
  assert.equal(edited.body.items[0].calculatedUnitAmount, '20.40');
  assert.equal(edited.body.items[0].calculatedTotal, '204.00');

  // Reopen (a fresh GET, same as navigating away and back) — the override survives.
  const reopened = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.items[0].rate, '1.70');
  assert.equal(reopened.body.items[0].calculatedTotal, '204.00');
});

test('changing the category Default Rate after an invoice is edited never touches that invoice\'s saved rate', async () => {
  const agent = await registeredOwner('Rate Edit Snapshot Co');
  const customerId = await createCustomer(agent, 'Rate Edit Snapshot Customer');
  const categoryId = await createCategory(agent, 'HEAD SKIP', '1.50');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10', rate: '1.70' }],
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId, stitches: 12000, quantity: '10', rate: '1.70' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.items[0].rate, '1.70');

  // The category's default rate changes from 1.50 to 1.80 (and later even
  // further) — the already-saved invoice item must never pick this up.
  await agent.patch(`/api/categories/${categoryId}`).send({ defaultRate: '1.80' });
  const afterFirstChange = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(afterFirstChange.body.items[0].rate, '1.70');

  await agent.patch(`/api/categories/${categoryId}`).send({ defaultRate: '2.50' });
  const afterSecondChange = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(afterSecondChange.body.items[0].rate, '1.70');
  assert.equal(afterSecondChange.body.items[0].calculatedTotal, '204.00');
});

test('switching an item to a different category with no rate supplied resets to the NEW category\'s default, not the old rate', async () => {
  const agent = await registeredOwner('Rate Category Switch Co');
  const customerId = await createCustomer(agent, 'Rate Category Switch Customer');
  const headSkip = await createCategory(agent, 'HEAD SKIP', '1.50');
  const daman = await createCategory(agent, 'Daman', '2.20');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId: headSkip, stitches: 12000, quantity: '10', rate: '1.70' }], // overridden
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.items[0].rate, '1.70');

  // Edit: switch the line to a different category, sending no rate at all —
  // the server must use the new category's own default (2.20), never the
  // previous category's overridden rate (1.70).
  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId: daman, stitches: 12000, quantity: '10' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.items[0].categoryName, 'Daman');
  assert.equal(edited.body.items[0].rate, '2.20');
  // unit = 12 * 2.20 = 26.40 ; total = 26.40 * 10 = 264.00
  assert.equal(edited.body.items[0].calculatedUnitAmount, '26.40');
  assert.equal(edited.body.items[0].calculatedTotal, '264.00');
});

test('Quick Invoice manual items are completely untouched: no categoryId/rate at all, and category rate changes never affect them', async () => {
  const agent = await registeredOwner('Rate Quick Invoice Co');
  const customerId = await createCustomer(agent, 'Rate Quick Invoice Customer');
  // A category exists in the company, but the manual item below never references it.
  await createCategory(agent, 'HEAD SKIP', '1.50');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'HEAD SKIP (manual)', quantity: '10', unitPrice: '1.70' }],
  });
  assert.equal(created.status, 201);
  const item = created.body.items[0];
  assert.equal(item.categoryId, null, 'a manual item has no category at all');
  assert.equal(item.calculatedUnitAmount, '1.70');
  assert.equal(item.calculatedTotal, '17.00');

  // Editing the manual item's own unit price still works exactly as a plain multiplication.
  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ description: 'HEAD SKIP (manual)', quantity: '10', unitPrice: '1.90' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.items[0].calculatedUnitAmount, '1.90');
  assert.equal(edited.body.items[0].calculatedTotal, '19.00');
});
