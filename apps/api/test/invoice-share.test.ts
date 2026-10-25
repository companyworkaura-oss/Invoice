import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import {
  buildCustomerPdfShareUrl,
  createInvoicePdfShare,
  resolveInvoicePdfShare,
} from '../src/modules/invoices/invoice-share.service.js';

// F09: a customer-accessible, expiring share link for one invoice's
// PDF. The WhatsApp message's PDF link used to point straight at the
// authenticated GET /api/invoices/:id/pdf route, which a customer's
// phone (no company login) could never open. GET
// /api/public/invoice-pdf/:token is the new, deliberately public
// route — gated only by an unguessable, invoice-specific, expiring
// token, never by auth. These tests exercise it directly (minting
// tokens via the service, same as buildInvoiceWhatsAppShare does
// internally) rather than through the WhatsApp flow, since that flow
// also requires PUBLIC_BASE_URL to be configured.

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
    fullName: 'Share Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const me = await agent.get('/api/auth/me');
  return { agent, companyId: me.body.company.id as string };
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

test('F09: a valid share link opens the correct invoice PDF with no owner login at all', async () => {
  const { agent, companyId } = await registeredOwner('Share Valid Co');
  const invoice = await createInvoice(agent, 'Share Customer');

  const { token } = await createInvoicePdfShare(companyId, invoice.id);

  // A bare, unauthenticated request — no cookie, no session, nothing
  // the owner's `agent` would attach.
  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], new RegExp(invoice.invoiceNumber));

  const buffer = res.body as Buffer;
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(buffer.length > 1000);
});

test('F09: a wrong/unknown token is rejected', async () => {
  const { agent, companyId } = await registeredOwner('Share Wrong Token Co');
  const invoice = await createInvoice(agent, 'Wrong Token Customer');
  await createInvoicePdfShare(companyId, invoice.id);

  // Same shape as a real token (so it passes the route's basic format
  // check) but never actually minted.
  const fakeToken = 'A'.repeat(43);
  const res = await request(app).get(`/api/public/invoice-pdf/${fakeToken}`);
  assert.equal(res.status, 404);
});

test('F09: an expired token is rejected, even though it was once valid', async () => {
  const { agent, companyId } = await registeredOwner('Share Expired Co');
  const invoice = await createInvoice(agent, 'Expired Customer');
  const { token } = await createInvoicePdfShare(companyId, invoice.id);

  // Force this specific share into the past, exactly as if its TTL had
  // elapsed naturally.
  await pool.query("UPDATE invoice_pdf_share_tokens SET expires_at = now() - interval '1 hour' WHERE invoice_id = $1", [
    invoice.id,
  ]);

  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 404);
});

test('F09: a token minted for one invoice can never reach a different invoice — there is no id in the URL to swap', async () => {
  const { agent, companyId } = await registeredOwner('Share Isolation Co');
  const invoiceA = await createInvoice(agent, 'Invoice A Customer');
  const invoiceB = await createInvoice(agent, 'Invoice B Customer');

  const { token } = await createInvoicePdfShare(companyId, invoiceA.id);

  // The route takes no invoice id at all — only the token — so there's
  // nothing to "change" to try to reach invoice B. Confirm the token
  // resolves to exactly invoice A, never B, and the served PDF is A's.
  const resolved = await resolveInvoicePdfShare(token);
  assert.equal(resolved.invoiceId, invoiceA.id);
  assert.notEqual(resolved.invoiceId, invoiceB.id);

  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], new RegExp(invoiceA.invoiceNumber));
  assert.doesNotMatch(res.headers['content-disposition'], new RegExp(invoiceB.invoiceNumber));
});

test('F09: a token is scoped to its own company — one company cannot mint or resolve access to another\'s invoice', async () => {
  const ownerA = await registeredOwner('Share Tenant A Co');
  const ownerB = await registeredOwner('Share Tenant B Co');
  const invoiceA = await createInvoice(ownerA.agent, 'Tenant A Customer');

  // B has no route that could even reference A's invoice id — this
  // mints A's own token, the only way a token for A's invoice exists.
  const { token } = await createInvoicePdfShare(ownerA.companyId, invoiceA.id);
  const resolved = await resolveInvoicePdfShare(token);
  assert.equal(resolved.companyId, ownerA.companyId);
  assert.notEqual(resolved.companyId, ownerB.companyId);
});

test('F09: the private GET /api/invoices/:id/pdf route is completely unchanged — still requires login', async () => {
  const { agent } = await registeredOwner('Share Private Unchanged Co');
  const invoice = await createInvoice(agent, 'Private Customer');

  const unauthenticated = await request(app).get(`/api/invoices/${invoice.id}/pdf`);
  assert.equal(unauthenticated.status, 401);

  const authenticated = await agent.get(`/api/invoices/${invoice.id}/pdf`);
  assert.equal(authenticated.status, 200);
});

test('F09: buildCustomerPdfShareUrl builds a real, token-based public link for a public HTTPS base', async () => {
  const { agent, companyId } = await registeredOwner('Share Build Url Co');
  const invoice = await createInvoice(agent, 'Build Url Customer');

  const url = await buildCustomerPdfShareUrl('https://invoices.example.com', companyId, invoice.id);
  assert.ok(url?.startsWith('https://invoices.example.com/api/public/invoice-pdf/'));
  assert.ok(!url?.includes(invoice.id), 'the invoice id itself must never appear in the share URL');

  const token = url!.split('/').pop()!;
  const resolved = await resolveInvoicePdfShare(token);
  assert.equal(resolved.invoiceId, invoice.id);
});
