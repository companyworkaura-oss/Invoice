import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F03: GET /api/invoices/:id/whatsapp-share must be a read-only
// preview — it never sends anything, no matter how many times it's
// called or whether WhatsApp Business Cloud API is configured. Only
// POST /api/invoices/:id/whatsapp-send is allowed to actually send.
// See apps/api's whatsapp-share.service.ts.

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
    fullName: 'WhatsApp Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, input: { name: string; whatsapp?: string }) {
  const res = await agent.post('/api/customers').send(input);
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post('/api/categories').send({
    name: 'HS/HP',
    defaultRate: '1.20',
    formulaConfig: { expression: 'stitches / 1000 * rate' },
  });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ categoryId, stitches: 12000, quantity: '10' }],
  });
  assert.equal(res.status, 201);
  return res.body;
}

test('GET preview builds a click-to-chat payload with all required fields', async () => {
  const agent = await registeredOwner('WhatsApp Full Co');
  const customerId = await createCustomer(agent, { name: 'Jane Doe', whatsapp: '+1 (415) 555-2671' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.cloudApiConfigured, false);
  // toPhone is the normalized (digits-only, international) number, not the raw saved value.
  assert.equal(preview.body.toPhone, '14155552671');
  assert.ok(preview.body.fallbackUrl.startsWith('https://wa.me/14155552671?text='));

  const message = decodeURIComponent(preview.body.fallbackUrl.split('?text=')[1]);
  assert.match(message, /Jane Doe/);
  assert.match(message, new RegExp(invoice.invoiceNumber));
  assert.match(message, /Invoice Total: 144\.00/);
  assert.match(message, /Previous Balance: 0\.00/);
  assert.match(message, /Paid Amount: 0\.00/);
  assert.match(message, /Current Balance: 144\.00/);
  assert.equal(preview.body.message, message);
  assert.equal(preview.body.invoiceNumber, invoice.invoiceNumber);
});

test('normalizes a Pakistani local WhatsApp number (leading 0) to international format', async () => {
  const agent = await registeredOwner('WhatsApp Pakistan Co');
  const customerId = await createCustomer(agent, { name: 'Local Number Customer', whatsapp: '03001234567' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.toPhone, '923001234567');
  assert.ok(preview.body.fallbackUrl.startsWith('https://wa.me/923001234567?text='));
});

test('an already-international Pakistani number (with or without +) normalizes to the same result', async () => {
  const agent = await registeredOwner('WhatsApp Intl Co');
  const categoryId = await createCategory(agent);

  const withPlus = await createCustomer(agent, { name: 'With Plus', whatsapp: '+923001234567' });
  const withoutPlus = await createCustomer(agent, { name: 'Without Plus', whatsapp: '923001234567' });

  const invoiceWithPlus = await createInvoice(agent, withPlus, categoryId);
  const invoiceWithoutPlus = await createInvoice(agent, withoutPlus, categoryId);

  const previewWithPlus = await agent.get(`/api/invoices/${invoiceWithPlus.id}/whatsapp-share`);
  const previewWithoutPlus = await agent.get(`/api/invoices/${invoiceWithoutPlus.id}/whatsapp-share`);

  assert.equal(previewWithPlus.body.toPhone, '923001234567');
  assert.equal(previewWithoutPlus.body.toPhone, '923001234567');
});

test('reflects previous balance and amount paid for a second invoice after a payment', async () => {
  const agent = await registeredOwner('WhatsApp Balances Co');
  const customerId = await createCustomer(agent, { name: 'Repeat Buyer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);

  const first = await createInvoice(agent, customerId, categoryId);
  assert.equal(first.totalAmount, '144.00');

  const payment = await agent.post('/api/payments').send({
    customerId,
    amount: '44.00',
    paymentMethod: 'cash',
  });
  assert.equal(payment.status, 201);

  const second = await createInvoice(agent, customerId, categoryId);
  // previous balance = 144.00 (first invoice) - 44.00 (payment) = 100.00
  assert.equal(second.previousBalance, '100.00');

  const preview = await agent.get(`/api/invoices/${second.id}/whatsapp-share`);
  assert.equal(preview.status, 200);
  const message = decodeURIComponent(preview.body.fallbackUrl.split('?text=')[1]);
  assert.match(message, /Previous Balance: 100\.00/);
  assert.match(message, /Current Balance: 244\.00/);
});

test('rejects sharing when the customer has no saved WhatsApp number', async () => {
  const agent = await registeredOwner('WhatsApp Missing Co');
  const customerId = await createCustomer(agent, { name: 'No Number' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 400);
  assert.equal(preview.body.details.whatsapp, 'Customer WhatsApp number is missing or invalid.');
});

test('rejects sharing when the customer\'s saved WhatsApp number is invalid (too short/junk)', async () => {
  const agent = await registeredOwner('WhatsApp Invalid Co');
  const customerId = await createCustomer(agent, { name: 'Bad Number Customer', whatsapp: '123' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 400);
  assert.equal(preview.body.details.whatsapp, 'Customer WhatsApp number is missing or invalid.');
});

test('never puts a localhost PDF link in the WhatsApp message (no PUBLIC_BASE_URL configured in this env)', async () => {
  const agent = await registeredOwner('WhatsApp No Public URL Co');
  const customerId = await createCustomer(agent, { name: 'No Public URL Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(preview.status, 200);
  const message = decodeURIComponent(preview.body.fallbackUrl.split('?text=')[1]);
  assert.ok(!message.includes('PDF invoice:'), 'no PDF link line when no public base URL is configured');
  assert.ok(!message.includes('localhost'), 'never a localhost URL in a customer-facing message');
});

test('WhatsApp sharing is tenant isolated (GET preview and POST send both)', async () => {
  const agentA = await registeredOwner('WhatsApp Tenant A');
  const customerId = await createCustomer(agentA, { name: 'Tenant A Customer', whatsapp: '1234567890' });
  const categoryId = await createCategory(agentA);
  const invoice = await createInvoice(agentA, customerId, categoryId);

  const agentB = await registeredOwner('WhatsApp Tenant B');
  const foreignPreview = await agentB.get(`/api/invoices/${invoice.id}/whatsapp-share`);
  assert.equal(foreignPreview.status, 404);

  // F03 test 6: cross-tenant send must be rejected the same way — a
  // user from company B can never trigger a send against company A's
  // invoice just by guessing/reusing its id.
  const foreignSend = await agentB
    .post(`/api/invoices/${invoice.id}/whatsapp-send`)
    .send({ idempotencyKey: 'cross-tenant-attempt' });
  assert.equal(foreignSend.status, 404);
});

test('WhatsApp preview and send routes both require authentication', async () => {
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const preview = await request(app).get(`/api/invoices/${fakeId}/whatsapp-share`);
  assert.equal(preview.status, 401);

  // F03 test 5: an unauthenticated POST must be rejected the same way
  // a GET always has been — no session, no send, regardless of body.
  const send = await request(app).post(`/api/invoices/${fakeId}/whatsapp-send`).send({ idempotencyKey: 'anon' });
  assert.equal(send.status, 401);
});

test('F03: a cross-site-style POST (non-JSON Content-Type) to whatsapp-send is rejected by the standard CSRF guard', async () => {
  const agent = await registeredOwner('F03 Csrf Guard Co');
  const customerId = await createCustomer(agent, { name: 'Csrf Guard Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  // requireJsonForMutations (middleware/errors.ts) is this app's one
  // CSRF defense for every state-changing route — a cross-site form
  // POST can only ever send application/x-www-form-urlencoded (or
  // multipart) without a CORS preflight, never application/json, so
  // rejecting anything that isn't JSON/multipart here is what makes a
  // cross-site <form> POST to this new route unable to trigger a send.
  // Mounted globally under /api, so the new route inherits it with no
  // route-specific wiring of its own to get wrong.
  const res = await agent
    .post(`/api/invoices/${invoice.id}/whatsapp-send`)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send('idempotencyKey=whatever');
  assert.equal(res.status, 415);
});

// ---- F03: GET must never send, even when Business Cloud API is configured ----

test('F03: GET /whatsapp-share never sends, and never generates a PDF, even called twice', async () => {
  const agent = await registeredOwner('F03 Get Never Sends Co');
  const customerId = await createCustomer(agent, { name: 'Preview Only Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalls++;
    return originalFetch(...args);
  }) as typeof fetch;

  try {
    const first = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
    assert.equal(first.status, 200);
    const second = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
    assert.equal(second.status, 200);

    // Two GET requests — the report's exact reproduction — must make
    // zero outbound send calls (fetch is only ever used by the
    // Business Cloud API service; click-to-chat never calls it).
    assert.equal(fetchCalls, 0, 'GET must never make any outbound network call at all');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('F03: GET remains read-only (zero outbound calls) even when WhatsApp Business Cloud API is configured', async () => {
  // Swaps in a "configured" Business Cloud API service via the
  // test-only seam in lib/whatsapp/index.ts (ESM named exports are
  // read-only bindings, so the getter itself can't just be
  // reassigned) — proves the GET route never reaches the send path,
  // not just that the default (unconfigured) test environment happens
  // to be in click-to-chat mode.
  const { BusinessCloudApiWhatsAppService } = await import('../src/lib/whatsapp/business-cloud-api-whatsapp-service.js');
  const { setWhatsAppServiceForTesting } = await import('../src/lib/whatsapp/index.js');

  const agent = await registeredOwner('F03 Get Safe With Cloud Api Co');
  const customerId = await createCustomer(agent, { name: 'Cloud Api Preview Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error('GET must never reach this — no outbound call is allowed from a read-only preview');
  }) as typeof fetch;

  setWhatsAppServiceForTesting(
    new BusinessCloudApiWhatsAppService({ phoneNumberId: 'test-phone-id', accessToken: 'test-token', apiVersion: 'v21.0' }),
  );

  try {
    const preview = await agent.get(`/api/invoices/${invoice.id}/whatsapp-share`);
    assert.equal(preview.status, 200);
    assert.equal(
      preview.body.cloudApiConfigured,
      true,
      'the preview must still report the server CAN send — just that GET itself never does',
    );
    assert.equal(fetchCalls, 0, 'GET must make zero outbound calls even with Business Cloud API configured');
  } finally {
    setWhatsAppServiceForTesting(undefined);
    globalThis.fetch = originalFetch;
  }
});

// ---- F03: POST /whatsapp-send is the only path that may actually send ----

test('F03: POST /whatsapp-send sends exactly once for a fresh idempotency key', async () => {
  const agent = await registeredOwner('F03 Post Sends Once Co');
  const customerId = await createCustomer(agent, { name: 'Send Once Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  // Default test env has no Business Cloud API configured, so the
  // click-to-chat service's buildShare makes no outbound network call
  // at all — the POST route itself (and the idempotency bookkeeping
  // around it) is what's under test here, independent of which
  // WhatsAppService is active.
  const send = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: 'send-once-key' });
  assert.equal(send.status, 200);
  assert.equal(send.body.mode, 'click-to-chat');
  assert.equal(send.body.toPhone, '9876543210');
  assert.ok(send.body.url.startsWith('https://wa.me/'));
});

test('F03: the same POST retried with the same idempotency key does not duplicate the send', async () => {
  const agent = await registeredOwner('F03 Idempotent Retry Co');
  const customerId = await createCustomer(agent, { name: 'Idempotent Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const key = 'retry-same-key-123';
  const first = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: key });
  assert.equal(first.status, 200);

  const second = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: key });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body, 'a repeated key must replay the exact same result, not recompute a new one');

  // Exactly one row for this key — the UNIQUE constraint, not just the
  // returned payload, is what actually prevents a second send.
  const rows = await pool.query(
    'SELECT count(*)::int AS count FROM whatsapp_send_requests WHERE invoice_id = $1 AND idempotency_key = $2',
    [invoice.id, key],
  );
  assert.equal(rows.rows[0].count, 1);
});

test('F03: a different idempotency key for the same invoice is treated as a new, independent send', async () => {
  const agent = await registeredOwner('F03 Different Key Co');
  const customerId = await createCustomer(agent, { name: 'Different Key Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const first = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: 'key-one' });
  assert.equal(first.status, 200);
  const second = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: 'key-two' });
  assert.equal(second.status, 200);

  const rows = await pool.query('SELECT count(*)::int AS count FROM whatsapp_send_requests WHERE invoice_id = $1', [
    invoice.id,
  ]);
  assert.equal(rows.rows[0].count, 2);
});

test('F03: POST /whatsapp-send requires an idempotencyKey', async () => {
  const agent = await registeredOwner('F03 Missing Key Co');
  const customerId = await createCustomer(agent, { name: 'Missing Key Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const res = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({});
  assert.equal(res.status, 400);
});

test('F03: POST /whatsapp-send with Business Cloud API configured actually calls the send path exactly once per idempotency key', async () => {
  const { BusinessCloudApiWhatsAppService } = await import('../src/lib/whatsapp/business-cloud-api-whatsapp-service.js');
  const { setWhatsAppServiceForTesting } = await import('../src/lib/whatsapp/index.js');

  const agent = await registeredOwner('F03 Post Sends Via Cloud Api Co');
  const customerId = await createCustomer(agent, { name: 'Cloud Api Send Customer', whatsapp: '9876543210' });
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  let mediaUploads = 0;
  let messagesSent = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/media')) {
      mediaUploads++;
      return new Response(JSON.stringify({ id: 'media-123' }), { status: 200 });
    }
    if (href.endsWith('/messages')) {
      messagesSent++;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`Unexpected fetch to ${href}`);
  }) as typeof fetch;

  setWhatsAppServiceForTesting(
    new BusinessCloudApiWhatsAppService({ phoneNumberId: 'test-phone-id', accessToken: 'test-token', apiVersion: 'v21.0' }),
  );

  try {
    const key = 'cloud-api-send-key';
    const first = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: key });
    assert.equal(first.status, 200);
    assert.equal(first.body.mode, 'business-api');
    assert.equal(first.body.status, 'sent');
    assert.equal(mediaUploads, 1);
    assert.equal(messagesSent, 1);

    // F03 test 4: retried with the same key — must not call the
    // WhatsApp API a second time.
    const second = await agent.post(`/api/invoices/${invoice.id}/whatsapp-send`).send({ idempotencyKey: key });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(mediaUploads, 1, 'a repeated key must never re-upload the PDF');
    assert.equal(messagesSent, 1, 'a repeated key must never send a second message');
  } finally {
    setWhatsAppServiceForTesting(undefined);
    globalThis.fetch = originalFetch;
  }
});
