import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Full pipeline for the customer statement PDF (real headless Chromium,
// through the actual HTTP response) — mirrors invoice-pdf.test.ts. The
// statement-pdf-html.test.ts file only covers the HTML string; nothing
// previously exercised this route's actual binary response, which is
// exactly where a Buffer/response-encoding bug would surface as a
// downloaded file that fails to open.

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
    fullName: 'Statement PDF Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomerWithHistory(agent: ReturnType<typeof request.agent>, customerName: string) {
  const customer = await agent.post('/api/customers').send({ name: customerName, openingBalance: '50.00' });
  const category = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  const invoice = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '10',
    items: [{ categoryId: category.body.id, stitches: 12000 }],
  });
  assert.equal(invoice.status, 201);
  return customer.body as { id: string; name: string };
}

test('downloads a real A4 statement PDF as a valid binary PDF', async () => {
  const agent = await registeredOwner('Statement PDF Download Co');
  const customer = await createCustomerWithHistory(agent, 'Ledger Customer');

  const res = await agent.get(`/api/customers/${customer.id}/ledger/statement/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /attachment; filename="Statement-Ledger-Customer\.pdf"/);

  const buffer = res.body as Buffer;
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-'); // real PDF magic bytes
  assert.ok(buffer.length > 0, 'the response body must not be empty');
  assert.ok(buffer.length > 1000, 'a rendered A4 statement should be more than a trivial handful of bytes');
  // Content-Length must match the actual bytes sent — a mismatch here is
  // exactly the kind of thing that produces a truncated, unopenable PDF.
  assert.equal(Number(res.headers['content-length']), buffer.length);
});

test('respects date-range and entry-type filters without breaking the PDF', async () => {
  const agent = await registeredOwner('Statement PDF Filter Co');
  const customer = await createCustomerWithHistory(agent, 'Filtered Customer');

  const res = await agent
    .get(`/api/customers/${customer.id}/ledger/statement/pdf`)
    .query({ type: 'INVOICE', from: '2020-01-01', to: '2030-01-01' });
  assert.equal(res.status, 200);
  assert.equal((res.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');
});

test('tenant isolation: cannot download another company’s customer statement PDF', async () => {
  const alice = await registeredOwner('Alice Statement Co');
  const bob = await registeredOwner('Bob Statement Co');
  const aliceCustomer = await createCustomerWithHistory(alice, 'Alice Customer');

  const res = await bob.get(`/api/customers/${aliceCustomer.id}/ledger/statement/pdf`);
  assert.equal(res.status, 404);
});

test('requires authentication', async () => {
  const res = await request(app).get(
    '/api/customers/00000000-0000-0000-0000-000000000000/ledger/statement/pdf',
  );
  assert.equal(res.status, 401);
});
