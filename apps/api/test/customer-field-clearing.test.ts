import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F12 — a customer's optional contact fields (businessName, phone,
// whatsapp, address, notes — all nullable `text` columns; Customer
// has no `email` field at all) could never actually be cleared once
// saved. The PATCH route validated them with `optionalString`, which
// rejects an empty value outright (`requireString`'s `min: 1`
// default), so an explicit clear attempt returned 400 instead of
// clearing the field; even if that were fixed, updateCustomer's SQL
// used `COALESCE($n, column)` for every field, which can't tell
// "omitted" apart from "explicitly cleared" — both arrive as a SQL
// NULL parameter, so the old value would always survive regardless.
// Fixed the same way company.routes.ts/company.service.ts already
// were for F08: optionalClearableString at the route layer (omitted
// -> undefined, explicit clear -> null, non-blank -> trimmed string),
// and a dynamic SET clause at the service layer (only a key actually
// present in the patch is included in the UPDATE at all; `null` is
// assigned directly, never COALESCE'd). `name` is NOT NULL (with a
// non-blank CHECK) and stays a plain required field — there is
// nothing to "clear" it to.

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
    fullName: 'Field Clearing Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createFullCustomer(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post('/api/customers').send({
    name: 'Full Contact Customer',
    businessName: 'Acme Uniforms LLC',
    phone: '555-1234',
    whatsapp: '9876543210',
    address: '123 Main St',
    notes: 'Prefers morning delivery',
  });
  assert.equal(res.status, 201);
  return res.body;
}

// ---- 1-4: create with all fields, clear all three (+ businessName/notes), re-read, assert null ----

test('F12: a customer\'s phone, whatsapp, address, businessName, and notes can all be explicitly cleared', async () => {
  const agent = await registeredOwner('F12 Clear All Co');
  const customer = await createFullCustomer(agent);
  assert.equal(customer.phone, '555-1234');
  assert.equal(customer.whatsapp, '9876543210');
  assert.equal(customer.address, '123 Main St');

  const cleared = await agent.patch(`/api/customers/${customer.id}`).send({
    businessName: null,
    phone: null,
    whatsapp: null,
    address: null,
    notes: null,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.businessName, null);
  assert.equal(cleared.body.phone, null);
  assert.equal(cleared.body.whatsapp, null);
  assert.equal(cleared.body.address, null);
  assert.equal(cleared.body.notes, null);
  assert.equal(cleared.body.name, 'Full Contact Customer', 'untouched field survives');

  // Re-read independently of the PATCH response.
  const reread = await agent.get(`/api/customers/${customer.id}`);
  assert.equal(reread.status, 200);
  assert.equal(reread.body.phone, null);
  assert.equal(reread.body.whatsapp, null);
  assert.equal(reread.body.address, null);
  assert.equal(reread.body.businessName, null);
  assert.equal(reread.body.notes, null);
});

test('F12: clearing a field with an empty string has the same effect as null', async () => {
  const agent = await registeredOwner('F12 Empty String Co');
  const customer = await createFullCustomer(agent);

  const cleared = await agent.patch(`/api/customers/${customer.id}`).send({ phone: '', address: '   ' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.phone, null);
  assert.equal(cleared.body.address, null, 'whitespace-only is treated as an explicit clear too');
  assert.equal(cleared.body.whatsapp, '9876543210', 'untouched field is unaffected');
});

// ---- update only phone, leave others (incl. email-equivalent whatsapp) unchanged ----

test('F12: updating only phone leaves whatsapp/address/businessName/notes unchanged', async () => {
  const agent = await registeredOwner('F12 Partial Update Co');
  const customer = await createFullCustomer(agent);

  const updated = await agent.patch(`/api/customers/${customer.id}`).send({ phone: '555-9999' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.phone, '555-9999');
  assert.equal(updated.body.whatsapp, '9876543210');
  assert.equal(updated.body.address, '123 Main St');
  assert.equal(updated.body.businessName, 'Acme Uniforms LLC');
  assert.equal(updated.body.notes, 'Prefers morning delivery');
});

// ---- clear only address ----

test('F12: clearing only address leaves every other field unchanged', async () => {
  const agent = await registeredOwner('F12 Clear One Co');
  const customer = await createFullCustomer(agent);

  const cleared = await agent.patch(`/api/customers/${customer.id}`).send({ address: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.address, null);
  assert.equal(cleared.body.phone, '555-1234');
  assert.equal(cleared.body.whatsapp, '9876543210');
  assert.equal(cleared.body.businessName, 'Acme Uniforms LLC');
  assert.equal(cleared.body.notes, 'Prefers morning delivery');
});

// ---- omitting a field entirely (not present in the body at all) leaves it unchanged ----

test('F12: omitting a field from the PATCH body entirely leaves it unchanged (not cleared)', async () => {
  const agent = await registeredOwner('F12 Omit Co');
  const customer = await createFullCustomer(agent);

  const updated = await agent.patch(`/api/customers/${customer.id}`).send({ name: 'Renamed Customer' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Renamed Customer');
  assert.equal(updated.body.phone, '555-1234');
  assert.equal(updated.body.whatsapp, '9876543210');
  assert.equal(updated.body.address, '123 Main St');
});

// ---- name (NOT NULL) still cannot be cleared ----

test('F12: name cannot be cleared — it is NOT NULL with no "empty" state to clear it to', async () => {
  const agent = await registeredOwner('F12 Name Not Nullable Co');
  const customer = await createFullCustomer(agent);

  const res = await agent.patch(`/api/customers/${customer.id}`).send({ name: '' });
  assert.equal(res.status, 400);

  const reread = await agent.get(`/api/customers/${customer.id}`);
  assert.equal(reread.body.name, 'Full Contact Customer', 'rejected clear must not partially apply');
});

// ---- a valid non-empty update still works (no regression) ----

test('F12: a valid non-empty update to every clearable field still works', async () => {
  const agent = await registeredOwner('F12 Valid Update Co');
  const customer = await createFullCustomer(agent);

  const updated = await agent.patch(`/api/customers/${customer.id}`).send({
    businessName: 'New Business Name',
    phone: '555-0000',
    whatsapp: '1112223333',
    address: '456 Oak Ave',
    notes: 'Updated notes',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.businessName, 'New Business Name');
  assert.equal(updated.body.phone, '555-0000');
  assert.equal(updated.body.whatsapp, '1112223333');
  assert.equal(updated.body.address, '456 Oak Ave');
  assert.equal(updated.body.notes, 'Updated notes');
});

// ---- a field that was never set and is cleared again stays null, no crash ----

test('F12: clearing a field that was already null (never set) is a harmless no-op', async () => {
  const agent = await registeredOwner('F12 Already Null Co');
  const customer = await agent.post('/api/customers').send({ name: 'Bare Customer' });
  assert.equal(customer.status, 201);
  assert.equal(customer.body.phone, null);

  const res = await agent.patch(`/api/customers/${customer.body.id}`).send({ phone: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.phone, null);
});
