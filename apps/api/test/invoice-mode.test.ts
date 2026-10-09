import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Bug fix: editing a Quick Invoice reopened it in CreateInvoiceForm
// (Category/Stitches/Avg Stitch controls), because the edit screen had
// no reliable way to tell a Quick Invoice apart from a Standard one.
// invoiceMode ('standard' | 'quick') is the fix — always derived
// server-side from the items actually saved (see invoiceModeFromItems
// in invoice.service.ts), never accepted from the client, so the
// frontend can route to the right editor without guessing from item
// shape itself.

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
    fullName: 'Invoice Mode Test Owner',
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

async function createCategory(agent: ReturnType<typeof request.agent>) {
  const res = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('a Quick Invoice (manual items only) is created with invoiceMode "quick"', async () => {
  const agent = await registeredOwner('Quick Mode Co');
  const customerId = await createCustomer(agent, 'Quick Mode Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'HEAD SKIP', quantity: '504', unitPrice: '375.41' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.invoiceMode, 'quick');
});

test('a Standard Invoice (category items) is created with invoiceMode "standard"', async () => {
  const agent = await registeredOwner('Standard Mode Co');
  const customerId = await createCustomer(agent, 'Standard Mode Customer');
  const categoryId = await createCategory(agent);

  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.invoiceMode, 'standard');
});

test('invoiceMode cannot be set by the client — it is always derived from the saved items, even if the request tries to claim otherwise', async () => {
  const agent = await registeredOwner('Mode Not Trusted Co');
  const customerId = await createCustomer(agent, 'Mode Not Trusted Customer');

  const res = await agent.post('/api/invoices').send({
    customerId,
    invoiceMode: 'standard', // a category invoice would be the lie here — items below are manual
    items: [{ description: 'Forged Mode Item', quantity: '1', unitPrice: '10.00' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.invoiceMode, 'quick', 'the client-supplied invoiceMode must be ignored entirely');
});

test('reopening (GET) a saved Quick Invoice still reports invoiceMode "quick"', async () => {
  const agent = await registeredOwner('Quick Reopen Co');
  const customerId = await createCustomer(agent, 'Quick Reopen Customer');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Quick Item', quantity: '2', unitPrice: '50.00' }],
  });
  assert.equal(created.status, 201);

  const details = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.invoiceMode, 'quick');
});

test('editing a Quick Invoice (still sending manual items) keeps invoiceMode "quick" after save', async () => {
  const agent = await registeredOwner('Quick Edit Co');
  const customerId = await createCustomer(agent, 'Quick Edit Customer');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'HEAD SKIP', quantity: '504', unitPrice: '375.41' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.invoiceMode, 'quick');

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ description: 'HEAD SKIP', quantity: '600', unitPrice: '400.00' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.invoiceMode, 'quick');

  // Reopening again (a second GET, simulating navigating away and back) must still show 'quick'.
  const reopened = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(reopened.body.invoiceMode, 'quick');
});

test('editing a Standard Invoice (still sending category items) keeps invoiceMode "standard" after save', async () => {
  const agent = await registeredOwner('Standard Edit Co');
  const customerId = await createCustomer(agent, 'Standard Edit Customer');
  const categoryId = await createCategory(agent);

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.invoiceMode, 'standard');

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ categoryId, stitches: 15000, quantity: '8' }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.invoiceMode, 'standard');
});

test('editing a Quick Invoice preserves description, quantity, unitPrice, and the recalculated lineAmount — never converted into a category/formula item', async () => {
  const agent = await registeredOwner('Quick Edit Preserve Co');
  const customerId = await createCustomer(agent, 'Quick Edit Preserve Customer');

  const created = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'DUPATTA', quantity: '504', unitPrice: '131.03' }],
  });
  assert.equal(created.status, 201);

  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ description: 'DUPATTA', quantity: '504', unitPrice: '131.03' }],
  });
  assert.equal(edited.status, 200);
  const item = edited.body.items[0];
  assert.equal(item.description, 'DUPATTA');
  assert.equal(item.quantity, '504.00');
  assert.equal(item.calculatedUnitAmount, '131.03');
  assert.equal(item.calculatedTotal, '66039.12'); // 504 * 131.03, server-recomputed
  assert.equal(item.categoryId, null, 'an edited Quick Invoice item must never gain a categoryId');
});

test('migration 016\'s backfill logic correctly re-derives invoiceMode from existing items for a row that predates the column', async () => {
  const agent = await registeredOwner('Backfill Co');
  const customerId = await createCustomer(agent, 'Backfill Customer');
  const categoryId = await createCategory(agent);

  const quick = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Backfill Quick', quantity: '1', unitPrice: '10.00' }],
  });
  const standard = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(quick.status, 201);
  assert.equal(standard.status, 201);

  // Simulate "created before invoice_mode existed" by wrongly flipping
  // both rows to the column's default, then re-running the exact
  // backfill UPDATE migration 016 uses and confirming it corrects both
  // from their actual saved items, independent of what createInvoice
  // itself had already set.
  await pool.query(`UPDATE invoices SET invoice_mode = 'standard' WHERE id IN ($1, $2)`, [quick.body.id, standard.body.id]);

  await pool.query(
    `UPDATE invoices i
        SET invoice_mode = 'quick'
      WHERE EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id AND it.category_id IS NOT NULL)
        AND i.id IN ($1, $2)`,
    [quick.body.id, standard.body.id],
  );

  const quickAfter = await agent.get(`/api/invoices/${quick.body.id}`);
  assert.equal(quickAfter.body.invoiceMode, 'quick');

  const standardAfter = await agent.get(`/api/invoices/${standard.body.id}`);
  assert.equal(standardAfter.body.invoiceMode, 'standard');
});

test('tenant isolation: invoiceMode is scoped per company like every other invoice field', async () => {
  const alice = await registeredOwner('Alice Mode Co');
  const bob = await registeredOwner('Bob Mode Co');
  const aliceCustomer = await createCustomer(alice, 'Alice Mode Customer');

  const invoice = await alice.post('/api/invoices').send({
    customerId: aliceCustomer,
    items: [{ description: 'Alice Quick Item', quantity: '1', unitPrice: '10.00' }],
  });
  assert.equal(invoice.status, 201);

  const bobView = await bob.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(bobView.status, 404);
});
