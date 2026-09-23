import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Phase 19 security audit: tests for things that aren't specific to any
// one business module (SQL injection, XSS escaping is covered in
// statement-pdf-html.test.ts / invoice-pdf-html.test.ts, auth timing/
// enumeration, rate limiting, error handling, race conditions).

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
    fullName: 'Security Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

test('login does not reveal whether an email is registered', async () => {
  const knownEmail = `known+${Date.now()}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({
    companyName: 'Enumeration Co',
    fullName: 'Known User',
    email: knownEmail,
    password: 'correct horse battery',
  });
  assert.equal(reg.status, 201);

  const wrongPassword = await request(app).post('/api/auth/login').send({ email: knownEmail, password: 'wrong-one' });
  const unknownEmail = await request(app)
    .post('/api/auth/login')
    .send({ email: `nobody+${Date.now()}@example.com`, password: 'whatever123' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.body.error, unknownEmail.body.error);
});

test('the session cookie is httpOnly and SameSite=Lax', async () => {
  const res = await request(app).post('/api/auth/register').send({
    companyName: 'Cookie Flags Co',
    fullName: 'Cookie Tester',
    email: `cookieflags+${Date.now()}@example.com`,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie && setCookie.length > 0);
  const sidCookie = setCookie.find((c: string) => c.startsWith('sid='));
  assert.ok(sidCookie);
  assert.match(sidCookie, /HttpOnly/i);
  assert.match(sidCookie, /SameSite=Lax/i);
});

test('SQL-injection-shaped search input is treated as a literal string, never breaks the query', async () => {
  const owner = await registeredOwner('Injection Co');
  const payload = "'; DROP TABLE customers; --";

  const created = await owner.post('/api/customers').send({ name: 'Safe Customer' });
  assert.equal(created.status, 201);

  const search = await owner.get('/api/customers').query({ search: payload });
  assert.equal(search.status, 200);
  assert.equal(search.body.length, 0); // no customer literally named that string

  // The table is unharmed — a normal, unrelated query still works fine.
  const stillWorks = await owner.get('/api/customers');
  assert.equal(stillWorks.status, 200);
  assert.equal(stillWorks.body.length, 1);
  assert.equal(stillWorks.body[0].name, 'Safe Customer');
});

test('SQL-injection-shaped input in invoice history search is handled safely', async () => {
  const owner = await registeredOwner('Injection History Co');
  const res = await owner.get('/api/invoices').query({ search: "x' OR '1'='1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('an invalid UUID in a path param is a clean 400, not a raw DB error', async () => {
  const owner = await registeredOwner('Bad UUID Co');
  const res = await owner.get('/api/customers/not-a-uuid');
  assert.equal(res.status, 400);
  assert.equal(typeof res.body.error, 'string');
  assert.ok(!/relation|syntax error|pg_|postgres/i.test(res.body.error));
});

test('an unhandled server error never leaks internals to the client', async () => {
  // A malformed body that survives JSON parsing but fails downstream —
  // exercises the generic error handler's fallback path.
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email": "a@example.com", "password": ' + '"x"'.repeat(50000) + '}');
  // Whatever status this lands on, the body must never contain a stack
  // trace or raw driver/error-class internals.
  assert.ok(res.status === 400 || res.status === 401 || res.status === 413 || res.status === 500);
  const bodyText = JSON.stringify(res.body);
  assert.ok(!bodyText.includes('at ') || !bodyText.includes('.js:')); // no stack-trace-shaped text
  assert.ok(!/node_modules/.test(bodyText));
});

test('concurrent registration with the same email never produces a 500 — exactly one succeeds', async () => {
  const email = `race+${Date.now()}@example.com`;
  const payload = { companyName: 'Race Co', fullName: 'Race User', email, password: 'correct horse battery' };

  const results = await Promise.all([
    request(app).post('/api/auth/register').send(payload),
    request(app).post('/api/auth/register').send(payload),
  ]);

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  for (const r of results) {
    if (r.status === 409) assert.equal(r.body.error, 'An account with this email already exists');
  }
});

test('rate limiting middleware returns 429 once the limit is exceeded', async () => {
  // Mounted on a throwaway app so this doesn't interact with the shared
  // app's own (test-env-disabled) limiter or the rest of the suite's
  // request volume — this verifies the express-rate-limit wiring itself
  // works, independent of config.rateLimitDisabled.
  const miniApp = express();
  const limiter = rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: true, legacyHeaders: false });
  miniApp.get('/probe', limiter, (_req, res) => res.json({ ok: true }));

  for (let i = 0; i < 3; i++) {
    const res = await request(miniApp).get('/probe');
    assert.equal(res.status, 200);
  }
  const fourth = await request(miniApp).get('/probe');
  assert.equal(fourth.status, 429);
});

test('a decimal amount with excess precision is rejected, not silently rounded or floated', async () => {
  const owner = await registeredOwner('Precision Co');
  const customer = await owner.post('/api/customers').send({ name: 'Precision Customer' });
  assert.equal(customer.status, 201);

  const tooManyDecimals = await owner.post('/api/payments').send({
    customerId: customer.body.id,
    amount: '10.999', // three decimal places — money is 2dp everywhere in this app
    paymentMethod: 'cash',
  });
  assert.equal(tooManyDecimals.status, 400);

  const scientificNotation = await owner.post('/api/payments').send({
    customerId: customer.body.id,
    amount: '1e2',
    paymentMethod: 'cash',
  });
  assert.equal(scientificNotation.status, 400);
});
