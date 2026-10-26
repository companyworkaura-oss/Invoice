import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// F07 — customer-facing invoice PDF link must work without shop
// login (re-verification, not a new fix): this report's F07 is the
// exact same root cause already fixed as "F09" in Phase 49 — the
// WhatsApp share message's PDF link used to point straight at the
// authenticated GET /api/invoices/:id/pdf route, which a customer's
// phone (no login, no session cookie) could never open.
//
// The existing fix's shape differs from the report's own "?token="
// example but satisfies every requirement it lists, and goes one step
// further on one of them: GET /api/public/invoice-pdf/:token carries
// no invoice id anywhere in its URL at all — only the token — so
// "token for invoice A used against invoice B" isn't just rejected,
// it's structurally impossible (there's no id to swap). The token
// itself (32 random bytes, stored only as a SHA-256 hash — see
// invoice-share.service.ts) plays the role of a signature: unforgeable,
// invoice-and-company-scoped, and carrying its own expiry
// (`expires_at`, from config.invoicePdfShareTtlHours).
//
// invoice-share.test.ts already covers most of this report's own test
// list (1, 2, 3, 5, 6) directly against the service/route. This file
// adds the two gaps: an explicit tampered-token case, and an
// end-to-end check that the WhatsApp preview message actually embeds
// a working signed URL when PUBLIC_BASE_URL is configured (every
// other WhatsApp test in this suite runs with no PUBLIC_BASE_URL set,
// so the link is always absent there) — plus a GET-preview-never-
// sends check in that same configuration, to prove enabling the link
// doesn't resurrect the F03 bug.
//
// PUBLIC_BASE_URL must be set *before* config.ts (and therefore
// app.ts) is first imported — config reads it once, synchronously, at
// module load. node:test runs each test file in its own process, so
// this only affects this file; every dynamic import below resolves
// against this file's own env, not the rest of the suite's.
process.env.PUBLIC_BASE_URL = 'https://invoices.example.com';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { createInvoicePdfShare, resolveInvoicePdfShare } = await import('../src/modules/invoices/invoice-share.service.js');
const request = (await import('supertest')).default;

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
    fullName: 'Public Link Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const me = await agent.get('/api/auth/me');
  return { agent, companyId: me.body.company.id as string };
}

async function createCustomer(agent: ReturnType<typeof request.agent>, input: { name: string; whatsapp?: string }) {
  const res = await agent.post('/api/customers').send(input);
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

async function createInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  return res.body as { id: string; invoiceNumber: string };
}

// ---- 1. Private route stays 401 without a session ----

test('F07: GET /api/invoices/:id/pdf without a session is still 401', async () => {
  const { agent } = await registeredOwner('F07 Private Co');
  const customerId = await createCustomer(agent, { name: 'Private Customer' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const res = await request(app).get(`/api/invoices/${invoice.id}/pdf`);
  assert.equal(res.status, 401);
});

// ---- 2. Valid signed customer PDF URL -> 200, application/pdf ----

test('F07: a valid public share token opens the invoice PDF with no session at all', async () => {
  const { agent, companyId } = await registeredOwner('F07 Valid Link Co');
  const customerId = await createCustomer(agent, { name: 'Valid Link Customer' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const { token } = await createInvoicePdfShare(companyId, invoice.id);
  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
});

// ---- 3. Expired token rejected ----

test('F07: an expired share token is rejected', async () => {
  const { agent, companyId } = await registeredOwner('F07 Expired Co');
  const customerId = await createCustomer(agent, { name: 'Expired Customer' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const { token } = await createInvoicePdfShare(companyId, invoice.id);
  await pool.query("UPDATE invoice_pdf_share_tokens SET expires_at = now() - interval '1 minute' WHERE invoice_id = $1", [
    invoice.id,
  ]);

  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 404);
});

// ---- 4. Tampered token rejected ----

test('F07: a tampered (one character flipped) token is rejected, not silently accepted', async () => {
  const { agent, companyId } = await registeredOwner('F07 Tampered Co');
  const customerId = await createCustomer(agent, { name: 'Tampered Customer' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const { token } = await createInvoicePdfShare(companyId, invoice.id);
  const flippedChar = token[0] === 'a' ? 'b' : 'a';
  const tampered = flippedChar + token.slice(1);
  assert.notEqual(tampered, token);

  const res = await request(app).get(`/api/public/invoice-pdf/${tampered}`);
  assert.equal(res.status, 404);
});

// ---- 5. Token for invoice A used against invoice B is rejected ----
// (structurally impossible here: the public route carries no invoice
// id at all, so there's nothing in the URL for an attacker to swap —
// confirmed directly on the resolver instead.)

test('F07: a token minted for invoice A never resolves to invoice B', async () => {
  const { agent, companyId } = await registeredOwner('F07 Cross Invoice Co');
  const customerId = await createCustomer(agent, { name: 'Cross Invoice Customer' });
  const categoryId = await createCategory(agent);
  const invoiceA = await createInvoice(agent, customerId, categoryId);
  const invoiceB = await createInvoice(agent, customerId, categoryId);

  const { token } = await createInvoicePdfShare(companyId, invoiceA.id);
  const resolved = await resolveInvoicePdfShare(token);
  assert.equal(resolved.invoiceId, invoiceA.id);
  assert.notEqual(resolved.invoiceId, invoiceB.id);
});

// ---- 6. Cross-company invoice access rejected ----

test('F07: a token minted under one company never resolves under another company\'s context', async () => {
  const ownerA = await registeredOwner('F07 Company A');
  const ownerB = await registeredOwner('F07 Company B');
  const customerId = await createCustomer(ownerA.agent, { name: 'Company A Customer' });
  const categoryId = await createCategory(ownerA.agent);
  const invoice = await createInvoice(ownerA.agent, customerId, categoryId);

  const { token } = await createInvoicePdfShare(ownerA.companyId, invoice.id);
  const resolved = await resolveInvoicePdfShare(token);
  assert.equal(resolved.companyId, ownerA.companyId);
  assert.notEqual(resolved.companyId, ownerB.companyId);

  // The public route itself never trusts a caller-supplied company —
  // it only ever uses the one the token resolves to, so there is no
  // way for anything to even ask for a different company's invoice
  // through this route.
  const res = await request(app).get(`/api/public/invoice-pdf/${token}`);
  assert.equal(res.status, 200);
});

// ---- 7. WhatsApp preview uses the valid signed URL when link sharing is enabled ----

test('F07: the WhatsApp preview message embeds a working public PDF link when PUBLIC_BASE_URL is configured', async () => {
  const { agent } = await registeredOwner('F07 WhatsApp Link Co');
  const customerId = await createCustomer(agent, { name: 'WhatsApp Link Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 200);
  assert.match(preview.body.message, /PDF invoice: https:\/\/invoices\.example\.com\/api\/public\/invoice-pdf\//);
  assert.doesNotMatch(preview.body.message, new RegExp(invoice.id), 'the raw invoice id must never appear in the message');

  // The embedded link must actually work, with no session, exactly as
  // a customer's phone would open it.
  const url = preview.body.message.match(/PDF invoice: (\S+)/)[1] as string;
  const path = url.replace('https://invoices.example.com', '');
  const pdfRes = await request(app).get(path);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
});

// ---- 8. GET preview still causes zero WhatsApp sends, even with the link enabled (preserve F03) ----

test('F07: GET preview with PUBLIC_BASE_URL configured still never sends anything (F03 preserved)', async () => {
  const { agent } = await registeredOwner('F07 No Send Co');
  const customerId = await createCustomer(agent, { name: 'No Send Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error('GET preview must never make an outbound call — no WhatsApp API or anything else');
  }) as typeof fetch;

  try {
    const first = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
    const second = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0, 'minting a share link/building a preview must never make an outbound call');
});
