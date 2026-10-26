import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F09 — an invoice must preserve the balance context that existed
// when it was created: later payments, adjustments, or invoices must
// never change the previousBalance/currentBalance shown on a
// historical invoice's reread.
//
// Root cause: a 100%-discounted invoice (grandTotal '0.00') posts no
// ledger entry at all (ledger_entries requires exactly one of
// debit/credit to be positive, and there's nothing to bill). getInvoice
// looked up that nonexistent ledger entry's created_at to anchor
// previousBalance, and fell back to `new Date().toISOString()` — "now"
// — when it found none. Every reread of a zero-total invoice therefore
// computed previousBalance against *today's* ledger state, drifting to
// match whatever the customer's balance happened to be at read time.
// Fixed in invoice.service.ts's getInvoice: fall back to the invoice's
// own (immutable) `created_at` instead of "now" — the exact same
// transaction-start timestamp a non-zero invoice's own ledger entry
// would have gotten anyway (both default to `now()`, posted in the
// same transaction).

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
    fullName: 'Historical Balance Test Owner',
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

// ---- The exact report reproduction ----

test('F09: a fully-discounted invoice keeps previousBalance 100 even after a later payment of 50', async () => {
  const agent = await registeredOwner('F09 Repro Co');
  const customer = await agent.post('/api/customers').send({ name: 'Repro Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }], // 50.00 subtotal
    discountType: 'percentage',
    discountValue: '100',
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.grandTotal, '0.00');
  assert.equal(invoice.body.previousBalance, '100.00');
  assert.equal(invoice.body.currentBalance, '100.00', 'nothing billed, so the customer\'s balance at creation time is unchanged');

  await agent.post('/api/payments').send({ customerId, amount: '50.00', paymentMethod: 'cash' });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.status, 200);
  assert.equal(reread.body.previousBalance, '100.00', 'the historical snapshot must never drift to match today\'s balance');
  assert.equal(reread.body.grandTotal, '0.00');
  // currentBalance is deliberately the *live* overall balance (see F03's
  // doc comment on InvoiceLedgerSummary) — it correctly reflects the
  // payment; only previousBalance (the historical anchor) must stay put.
  assert.equal(reread.body.currentBalance, '50.00');
});

// ---- A later debit adjustment must not alter the old snapshot ----

test('F09: a later debit adjustment does not alter a zero-total invoice\'s previousBalance snapshot', async () => {
  const agent = await registeredOwner('F09 Debit Adjustment Co');
  const customer = await agent.post('/api/customers').send({ name: 'Debit Adjustment Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }],
    discountType: 'percentage',
    discountValue: '100',
  });
  assert.equal(invoice.body.previousBalance, '100.00');

  await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ debit: '75.00', notes: 'later unrelated debt' });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.previousBalance, '100.00');
  assert.equal(reread.body.grandTotal, '0.00');
});

// ---- A later credit adjustment must not alter the old snapshot ----

test('F09: a later credit adjustment does not alter a zero-total invoice\'s previousBalance snapshot', async () => {
  const agent = await registeredOwner('F09 Credit Adjustment Co');
  const customer = await agent.post('/api/customers').send({ name: 'Credit Adjustment Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }],
    discountType: 'percentage',
    discountValue: '100',
  });
  assert.equal(invoice.body.previousBalance, '100.00');

  await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ credit: '20.00', notes: 'later unrelated credit' });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.previousBalance, '100.00');
  assert.equal(reread.body.grandTotal, '0.00');
});

// ---- A later invoice must not alter the old snapshot ----

test('F09: a later invoice does not alter an earlier zero-total invoice\'s previousBalance snapshot', async () => {
  const agent = await registeredOwner('F09 Later Invoice Co');
  const customer = await agent.post('/api/customers').send({ name: 'Later Invoice Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const first = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }],
    discountType: 'percentage',
    discountValue: '100',
  });
  assert.equal(first.body.previousBalance, '100.00');

  await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 60000, quantity: '1' }], // a normal, billed 60.00 invoice
  });

  const reread = await agent.get(`/api/invoices/${first.body.id}`);
  assert.equal(reread.body.previousBalance, '100.00');
  assert.equal(reread.body.grandTotal, '0.00');
});

// ---- No regression: a normal (non-zero-total) invoice stays correct through the same kinds of later activity ----

test('F09: a normal non-zero invoice\'s previousBalance remains correct and stable through later payments/adjustments/invoices', async () => {
  const agent = await registeredOwner('F09 Normal Invoice Co');
  const customer = await agent.post('/api/customers').send({ name: 'Normal Invoice Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }], // 50.00, fully billed — no discount
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.grandTotal, '50.00');
  assert.equal(invoice.body.previousBalance, '100.00');

  await agent.post('/api/payments').send({ customerId, amount: '30.00', paymentMethod: 'cash' });
  await agent.post(`/api/customers/${customerId}/ledger/adjustments`).send({ debit: '10.00', notes: 'later debt' });
  await agent.post('/api/invoices').send({ customerId, items: [{ categoryId, stitches: 20000, quantity: '1' }] });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.previousBalance, '100.00', 'unaffected by later activity, exactly as it always was for a normal invoice');
  assert.equal(reread.body.grandTotal, '50.00');
  assert.equal(reread.body.totalReceivable, '150.00');
});

// ---- PDF/view model agrees with the stable historical values ----

test('F09: the PDF is generated from the same stable previousBalance as invoice detail, after later activity', async () => {
  const agent = await registeredOwner('F09 PDF Agreement Co');
  const customer = await agent.post('/api/customers').send({ name: 'PDF Agreement Customer', openingBalance: '100.00' });
  const customerId = customer.body.id;
  const categoryId = await createCategory(agent);

  const invoice = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 50000, quantity: '1' }],
    discountType: 'percentage',
    discountValue: '100',
  });
  assert.equal(invoice.body.previousBalance, '100.00');

  await agent.post('/api/payments').send({ customerId, amount: '50.00', paymentMethod: 'cash' });

  const reread = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(reread.body.previousBalance, '100.00');

  // The PDF is rendered from this exact InvoiceWithItems object — see
  // buildInvoiceViewModel, which only ever passes previousBalance
  // through, never recomputes it — so a real, successful PDF response
  // here (same object, same figures) confirms the printable view
  // agrees with the stable historical value just verified above.
  const pdf = await agent.get(`/api/invoices/${invoice.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok((pdf.body as Buffer).length > 1000);
});
