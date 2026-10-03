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
    fullName: 'PDF Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createInvoice(agent: ReturnType<typeof request.agent>, customerName: string) {
  const customer = await agent.post('/api/customers').send({ name: customerName });
  const category = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  const invoice = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    items: [{ categoryId: category.body.id, stitches: 12000, quantity: '10' }],
  });
  assert.equal(invoice.status, 201);
  return invoice.body as { id: string; invoiceNumber: string };
}

test('downloads a real A4 PDF with the correct filename convention', async () => {
  const agent = await registeredOwner('PDF Download Co');
  const invoice = await createInvoice(agent, 'Print & Co');

  const res = await agent.get(`/api/invoices/${invoice.id}/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(
    res.headers['content-disposition'],
    new RegExp(`attachment; filename="${invoice.invoiceNumber}-Print-Co\\.pdf"`),
  );

  const buffer = res.body as Buffer;
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-'); // real PDF magic bytes
  assert.ok(buffer.length > 0, 'the response body must not be empty');
  assert.ok(buffer.length > 1000, 'a rendered A4 invoice should be more than a trivial handful of bytes');
  // Content-Length must match the actual bytes sent — a mismatch here is
  // exactly the kind of thing that produces a truncated, unopenable PDF.
  assert.equal(Number(res.headers['content-length']), buffer.length);
});

test('generates a real, non-empty PDF for an invoice combining lot number, per-item quantity, and a discount', async () => {
  const agent = await registeredOwner('PDF Full Featured Co');
  const customer = await agent.post('/api/customers').send({ name: 'Full Featured Customer' });
  const bazu = await agent
    .post('/api/categories')
    .send({ name: 'BAZU', defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  const front = await agent
    .post('/api/categories')
    .send({ name: 'FRONT', defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });

  const invoice = await agent.post('/api/invoices').send({
    customerId: customer.body.id,
    lotNumber: 'LOT-2026-145',
    customerLotNumber: 'CUST-458',
    discountType: 'percentage',
    discountValue: '10',
    items: [
      { categoryId: bazu.body.id, description: 'BAZU', stitches: 10000, quantity: '12' },
      { categoryId: front.body.id, description: 'FRONT', stitches: 150000, quantity: '8' },
    ],
  });
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.lotNumber, 'LOT-2026-145');
  assert.equal(invoice.body.customerLotNumber, 'CUST-458');
  assert.equal(invoice.body.discountType, 'percentage');

  const res = await agent.get(`/api/invoices/${invoice.body.id}/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.ok(Number(res.headers['content-length']) > 0, 'Content-Length must be greater than zero');

  const buffer = res.body as Buffer;
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0, 'the response body must not be empty');
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-'); // real PDF magic bytes, not an empty/corrupt file
  assert.equal(Number(res.headers['content-length']), buffer.length);
});

test('generateInvoicePdf (called directly) returns a non-empty buffer starting with the PDF magic bytes', async () => {
  const agent = await registeredOwner('PDF Direct Call Co');
  const invoice = await createInvoice(agent, 'Direct Call Customer');
  const me = await agent.get('/api/auth/me');
  const companyId = me.body.company.id as string;

  const { generateInvoicePdf } = await import('../src/modules/invoices/pdf/pdf.service.js');
  const { buffer, filename } = await generateInvoicePdf(companyId, invoice.id);

  assert.ok(buffer.length > 0, 'buffer must not be empty');
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(filename, /\.pdf$/);
});

test('accepts a template override via query param without changing the company default', async () => {
  const agent = await registeredOwner('PDF Template Override Co');
  const invoice = await createInvoice(agent, 'Override Customer');

  const res = await agent.get(`/api/invoices/${invoice.id}/pdf`).query({ template: 'industrial-blue' });
  assert.equal(res.status, 200);
  assert.equal((res.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');

  const profile = await agent.get('/api/company');
  assert.notEqual(profile.body.defaultInvoiceTemplate, 'industrial-blue'); // the override didn't stick
});

test('falls back cleanly for an unknown template id instead of failing', async () => {
  const agent = await registeredOwner('PDF Unknown Template Co');
  const invoice = await createInvoice(agent, 'Fallback Customer');

  const res = await agent.get(`/api/invoices/${invoice.id}/pdf`).query({ template: 'not-a-real-template' });
  assert.equal(res.status, 200);
  assert.equal((res.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');
});

test('tenant isolation: cannot download another company’s invoice PDF', async () => {
  const alice = await registeredOwner('Alice PDF Co');
  const bob = await registeredOwner('Bob PDF Co');
  const aliceInvoice = await createInvoice(alice, 'Alice Customer');

  const res = await bob.get(`/api/invoices/${aliceInvoice.id}/pdf`);
  assert.equal(res.status, 404);
});

test('requires authentication', async () => {
  const res = await request(app).get('/api/invoices/00000000-0000-0000-0000-000000000000/pdf');
  assert.equal(res.status, 401);
});
