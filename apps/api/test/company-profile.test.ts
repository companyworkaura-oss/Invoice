import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

const app = createApp();
const here = path.dirname(fileURLToPath(import.meta.url));

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
    fullName: 'Profile Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

test('a fresh company has the profile fields with sensible defaults', async () => {
  const agent = await registeredOwner('Blank Profile Co');
  const res = await agent.get('/api/company');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Blank Profile Co');
  assert.equal(res.body.defaultCurrency, 'USD');
  assert.equal(res.body.invoicePrefix, 'INV');
  assert.equal(res.body.defaultInvoiceTemplate, 'default');
  assert.equal(res.body.logoUrl, null);
  assert.equal(res.body.factoryName, null);
});

test('owner can edit the full company profile', async () => {
  const agent = await registeredOwner('Editable Co');
  const res = await agent.patch('/api/company').send({
    factoryName: 'Golden Needle Factory',
    ownerName: 'Priya Shah',
    phone: '+1 555 0100',
    whatsapp: '+1 555 0100',
    email: 'contact@goldenneedle.example',
    address: '12 Thread St, Mumbai',
    taxNumber: 'TAX-9988',
    invoicePrefix: 'GN',
    defaultInvoiceTemplate: 'classic',
    invoiceTerms: 'Net 30. Payment due in USD.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.factoryName, 'Golden Needle Factory');
  assert.equal(res.body.ownerName, 'Priya Shah');
  assert.equal(res.body.email, 'contact@goldenneedle.example');
  assert.equal(res.body.invoicePrefix, 'GN');
  assert.equal(res.body.defaultInvoiceTemplate, 'classic');
  assert.equal(res.body.invoiceTerms, 'Net 30. Payment due in USD.');

  // A partial patch must not clobber fields it didn't mention.
  const partial = await agent.patch('/api/company').send({ phone: '+1 555 0199' });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.phone, '+1 555 0199');
  assert.equal(partial.body.factoryName, 'Golden Needle Factory');
});

test('rejects a malformed contact email in the profile', async () => {
  const agent = await registeredOwner('Bad Email Co');
  const res = await agent.patch('/api/company').send({ email: 'not-an-email' });
  assert.equal(res.status, 400);
});

test('uploading a logo stores it, updates logoUrl, and serves it back', async () => {
  const agent = await registeredOwner('Logo Co');
  const png = readFileSync(path.join(here, 'fixtures', 'tiny.png'));

  const upload = await agent.post('/api/company/logo').attach('logo', png, {
    filename: 'logo.png',
    contentType: 'image/png',
  });
  assert.equal(upload.status, 201);
  assert.ok(upload.body.logoUrl.startsWith('/uploads/logos/'));

  const served = await request(app).get(upload.body.logoUrl);
  assert.equal(served.status, 200);
  assert.ok(Buffer.from(served.body).equals(png));

  // Re-uploading replaces the logo (old file cleaned up) rather than accumulating.
  const secondUpload = await agent.post('/api/company/logo').attach('logo', png, {
    filename: 'logo2.png',
    contentType: 'image/png',
  });
  assert.equal(secondUpload.status, 201);
  assert.notEqual(secondUpload.body.logoUrl, upload.body.logoUrl);

  const oldLogoNowGone = await request(app).get(upload.body.logoUrl);
  assert.equal(oldLogoNowGone.status, 404);
});

test('rejects a non-image file for logo upload', async () => {
  const agent = await registeredOwner('Bad Logo Co');
  const res = await agent.post('/api/company/logo').attach('logo', Buffer.from('not an image'), {
    filename: 'evil.txt',
    contentType: 'text/plain',
  });
  assert.equal(res.status, 400);
});

test('staff cannot edit the profile or upload a logo', async () => {
  const owner = await registeredOwner('Staff Guard Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;

  const email = `staffguard+${Date.now()}@example.com`;
  await request(app).post('/api/auth/register').send({
    companyName: 'Staff Personal Co 2',
    fullName: 'Staff Two',
    email,
    password: 'correct horse battery',
  });
  const staffUserId: string = (await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email])).rows[0].id;
  await pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'staff')`, [
    companyId,
    staffUserId,
  ]);

  const staffAgent = request.agent(app);
  await staffAgent.post('/api/auth/login').send({ email, password: 'correct horse battery' });
  await staffAgent.post(`/api/companies/${companyId}/switch`);

  const patchRes = await staffAgent.patch('/api/company').send({ factoryName: 'Nope' });
  assert.equal(patchRes.status, 403);

  const logoRes = await staffAgent
    .post('/api/company/logo')
    .attach('logo', readFileSync(path.join(here, 'fixtures', 'tiny.png')), 'logo.png');
  assert.equal(logoRes.status, 403);
});
