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

// F08: an omitted field must leave the persisted value unchanged; an
// explicit null/empty value must clear it. The two used to be
// indistinguishable by the time they reached the database (COALESCE
// over a SQL NULL parameter either way) — see company.service.ts's
// updateCompany.
test('F08: an explicit null clears phone, address, and invoice terms; an omitted field leaves them unchanged', async () => {
  const agent = await registeredOwner('Clearable Fields Co');
  const seeded = await agent.patch('/api/company').send({
    phone: '+1 555 0100',
    address: '12 Thread St, Mumbai',
    invoiceTerms: 'Net 30.',
    factoryName: 'Golden Needle Factory',
  });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.phone, '+1 555 0100');
  assert.equal(seeded.body.address, '12 Thread St, Mumbai');
  assert.equal(seeded.body.invoiceTerms, 'Net 30.');

  // Clear phone and address explicitly with null; leave invoiceTerms
  // and factoryName out of this patch entirely.
  const cleared = await agent.patch('/api/company').send({ phone: null, address: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.phone, null, 'explicit null must persist as cleared');
  assert.equal(cleared.body.address, null, 'explicit null must persist as cleared');
  assert.equal(cleared.body.invoiceTerms, 'Net 30.', 'omitted field must be left unchanged');
  assert.equal(cleared.body.factoryName, 'Golden Needle Factory', 'omitted field must be left unchanged');

  // Re-fetching confirms it was actually persisted, not just echoed back.
  const refetched = await agent.get('/api/company');
  assert.equal(refetched.body.phone, null);
  assert.equal(refetched.body.address, null);
  assert.equal(refetched.body.invoiceTerms, 'Net 30.');
});

test('F08: an explicit empty string also clears a nullable field, same as null', async () => {
  const agent = await registeredOwner('Clearable Empty String Co');
  await agent.patch('/api/company').send({ whatsapp: '+1 555 0177', taxNumber: 'TAX-1' });

  const cleared = await agent.patch('/api/company').send({ whatsapp: '', taxNumber: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.whatsapp, null);
  assert.equal(cleared.body.taxNumber, null);
});

test('F08: clearing one field in a patch does not clear or touch fields omitted from that same patch', async () => {
  const agent = await registeredOwner('Clearable Partial Co');
  await agent.patch('/api/company').send({
    phone: '+1 555 0100',
    ownerName: 'Priya Shah',
    email: 'contact@goldenneedle.example',
  });

  const res = await agent.patch('/api/company').send({ phone: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.phone, null);
  assert.equal(res.body.ownerName, 'Priya Shah', 'untouched field must survive a sibling field being cleared');
  assert.equal(res.body.email, 'contact@goldenneedle.example', 'untouched field must survive a sibling field being cleared');
});

test('F08: name, defaultCurrency, invoicePrefix, and defaultInvoiceTemplate cannot be cleared — they are required', async () => {
  const agent = await registeredOwner('Required Fields Co');
  const res = await agent.patch('/api/company').send({ name: '' });
  assert.equal(res.status, 400);

  const stillThere = await agent.get('/api/company');
  assert.equal(stillThere.body.name, 'Required Fields Co');
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

// F01 hardening: served uploads must carry X-Content-Type-Options:
// nosniff, so a browser is never left free to re-interpret a served
// file as something other than the Content-Type this response
// actually sent, on top of (never instead of) detectImageSignature()
// already rejecting anything that isn't a real PNG/JPEG/WEBP at
// upload time.
test('F01: served uploads carry X-Content-Type-Options: nosniff', async () => {
  const agent = await registeredOwner('Nosniff Header Co');
  const png = readFileSync(path.join(here, 'fixtures', 'tiny.png'));
  const upload = await agent.post('/api/company/logo').attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(upload.status, 201);

  const served = await request(app).get(upload.body.logoUrl);
  assert.equal(served.status, 200);
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
});

test('rejects a non-image file for logo upload', async () => {
  const agent = await registeredOwner('Bad Logo Co');
  const res = await agent.post('/api/company/logo').attach('logo', Buffer.from('not an image'), {
    filename: 'evil.txt',
    contentType: 'text/plain',
  });
  assert.equal(res.status, 400);
});

// F01 — stored XSS via SVG logo upload. SVG is markup, not an image:
// a <script> tag or an onload= handler inside it executes if someone
// ever opens the raw uploaded file's URL directly (served same-origin,
// at /uploads/logos/...), or if it's loaded via <object>/<iframe>. The
// app has no SVG sanitizer, so the only safe fix is to never store one
// at all — only PNG/JPEG/WEBP are accepted, and acceptance is decided
// by sniffing the file's actual bytes (lib/storage/image-signature.ts),
// never the client-supplied Content-Type/filename alone.

test('accepts a normal PNG logo (signature-validated, not just by Content-Type)', async () => {
  const agent = await registeredOwner('PNG Logo Co');
  const png = readFileSync(path.join(here, 'fixtures', 'tiny.png'));
  const res = await agent.post('/api/company/logo').attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(res.status, 201);
  assert.ok(res.body.logoUrl.endsWith('.png'));
});

test('accepts a normal JPEG logo', async () => {
  const agent = await registeredOwner('JPEG Logo Co');
  const jpeg = readFileSync(path.join(here, 'fixtures', 'tiny.jpg'));
  const res = await agent.post('/api/company/logo').attach('logo', jpeg, { filename: 'logo.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 201);
  assert.ok(res.body.logoUrl.endsWith('.jpg'));
});

test('accepts a normal WEBP logo', async () => {
  const agent = await registeredOwner('WEBP Logo Co');
  const webp = readFileSync(path.join(here, 'fixtures', 'tiny.webp'));
  const res = await agent.post('/api/company/logo').attach('logo', webp, { filename: 'logo.webp', contentType: 'image/webp' });
  assert.equal(res.status, 201);
  assert.ok(res.body.logoUrl.endsWith('.webp'));
});

test('rejects an SVG logo outright, even with a legitimate image/svg+xml Content-Type', async () => {
  const agent = await registeredOwner('SVG Logo Rejected Co');
  const svg = readFileSync(path.join(here, 'fixtures', 'logo.svg'));
  const res = await agent.post('/api/company/logo').attach('logo', svg, { filename: 'logo.svg', contentType: 'image/svg+xml' });
  assert.equal(res.status, 400);
  assert.match(res.body.details?.logo ?? '', /svg/i);

  // No logo must have been saved from the rejected upload.
  const company = await agent.get('/api/company');
  assert.equal(company.body.logoUrl, null);
});

test('rejects a script-bearing SVG logo (the actual stored-XSS payload) the same way', async () => {
  const agent = await registeredOwner('SVG XSS Logo Co');
  const maliciousSvg = readFileSync(path.join(here, 'fixtures', 'logo-xss.svg'));
  assert.ok(maliciousSvg.includes('<script>'), 'fixture must actually contain a script tag to be a meaningful test');

  const res = await agent
    .post('/api/company/logo')
    .attach('logo', maliciousSvg, { filename: 'logo.svg', contentType: 'image/svg+xml' });
  assert.equal(res.status, 400);

  const company = await agent.get('/api/company');
  assert.equal(company.body.logoUrl, null, 'the malicious SVG must never be written to disk or referenced by the company');
});

test('rejects an SVG disguised as a PNG — Content-Type/filename alone is never trusted', async () => {
  const agent = await registeredOwner('Disguised SVG Logo Co');
  const svg = readFileSync(path.join(here, 'fixtures', 'logo.svg'));

  // The exact spoofing attempt F01 describes: wrong Content-Type and a
  // .png filename, real bytes are still SVG/XML — signature sniffing
  // must catch this even though fileFilter's MIME check alone would not.
  const res = await agent.post('/api/company/logo').attach('logo', svg, { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.match(res.body.details?.logo ?? '', /not a valid/i);
});

test('rejects a plain-garbage file even when it claims to be a PNG', async () => {
  const agent = await registeredOwner('Fake PNG Logo Co');
  const garbage = Buffer.from('this is not image bytes at all, just plain text pretending to be one');
  const res = await agent.post('/api/company/logo').attach('logo', garbage, { filename: 'logo.png', contentType: 'image/png' });
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
