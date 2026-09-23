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
    fullName: 'Audit Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

/** Adds a second user to the owner's company with the given role, and returns a logged-in, switched agent for them. */
async function memberAgent(owner: ReturnType<typeof request.agent>, companyId: string, role: 'admin' | 'staff') {
  const email = `${role}+${Date.now()}+${Math.random()}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({
    companyName: `${role} personal co`,
    fullName: `${role[0].toUpperCase()}${role.slice(1)} Member`,
    email,
    password: 'correct horse battery',
  });
  assert.equal(reg.status, 201);
  const userId: string = (await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email])).rows[0].id;
  await pool.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [
    companyId,
    userId,
    role,
  ]);

  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: 'correct horse battery' });
  await agent.post(`/api/companies/${companyId}/switch`);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.post('/api/customers').send({ name });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>, name = 'HS/HP') {
  const res = await agent.post('/api/categories').send({
    name,
    defaultRate: '1.00',
    formulaConfig: { expression: 'stitches / 1000 * rate' },
  });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

test('creating an invoice logs INVOICE_CREATED with useful metadata', async () => {
  const owner = await registeredOwner('Audit Invoice Co');
  const customerId = await createCustomer(owner, 'Audit Customer');
  const categoryId = await createCategory(owner);

  const invoice = await owner.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }],
  });
  assert.equal(invoice.status, 201);

  const logs = await owner.get('/api/audit-logs');
  assert.equal(logs.status, 200);
  const entry = logs.body.find((l: { action: string }) => l.action === 'INVOICE_CREATED');
  assert.ok(entry, 'expected an INVOICE_CREATED entry');
  assert.equal(entry.entityType, 'invoice');
  assert.equal(entry.entityId, invoice.body.id);
  assert.equal(entry.metadata.invoiceNumber, invoice.body.invoiceNumber);
  assert.equal(entry.metadata.customerId, customerId);
  assert.equal(entry.metadata.totalAmount, '1.00');
  assert.ok(entry.userName);
});

test('duplicating an invoice logs its own INVOICE_CREATED entry noting the source invoice', async () => {
  const owner = await registeredOwner('Audit Duplicate Co');
  const customerId = await createCustomer(owner, 'Audit Customer');
  const categoryId = await createCategory(owner);

  const original = await owner.post('/api/invoices').send({
    customerId,
    quantity: '1',
    items: [{ categoryId, stitches: 1000 }],
  });
  assert.equal(original.status, 201);

  const dup = await owner.post(`/api/invoices/${original.body.id}/duplicate`);
  assert.equal(dup.status, 201);

  const logs = await owner.get('/api/audit-logs').query({ entityType: 'invoice' });
  assert.equal(logs.status, 200);
  const created = logs.body.filter((l: { action: string }) => l.action === 'INVOICE_CREATED');
  assert.equal(created.length, 2);

  const dupEntry = created.find((l: { entityId: string }) => l.entityId === dup.body.id);
  assert.ok(dupEntry);
  assert.equal(dupEntry.metadata.duplicatedFromInvoiceId, original.body.id);
  assert.equal(dupEntry.metadata.duplicatedFromInvoiceNumber, original.body.invoiceNumber);
});

test('recording a payment logs PAYMENT_CREATED', async () => {
  const owner = await registeredOwner('Audit Payment Co');
  const customerId = await createCustomer(owner, 'Audit Customer');

  const payment = await owner.post('/api/payments').send({ customerId, amount: '25.00', paymentMethod: 'cash' });
  assert.equal(payment.status, 201);

  const logs = await owner.get('/api/audit-logs').query({ action: 'PAYMENT_CREATED' });
  assert.equal(logs.status, 200);
  assert.equal(logs.body.length, 1);
  assert.equal(logs.body[0].entityId, payment.body.id);
  assert.equal(logs.body[0].metadata.amount, '25.00');
  assert.equal(logs.body[0].metadata.paymentMethod, 'cash');
});

test('changing a category rate logs RATE_CHANGED; changing its formula logs FORMULA_CHANGED; a name-only edit logs neither', async () => {
  const owner = await registeredOwner('Audit Category Co');
  const categoryId = await createCategory(owner);

  const rateOnly = await owner.patch(`/api/categories/${categoryId}`).send({ defaultRate: '2.50' });
  assert.equal(rateOnly.status, 200);

  const formulaOnly = await owner.patch(`/api/categories/${categoryId}`).send({
    formulaConfig: { expression: 'stitches / 500 * rate' },
  });
  assert.equal(formulaOnly.status, 200);

  const nameOnly = await owner.patch(`/api/categories/${categoryId}`).send({ name: 'Renamed Category' });
  assert.equal(nameOnly.status, 200);

  const logs = await owner.get('/api/audit-logs').query({ entityType: 'formula' });
  assert.equal(logs.status, 200);

  const rateEntries = logs.body.filter((l: { action: string }) => l.action === 'RATE_CHANGED');
  assert.equal(rateEntries.length, 1);
  assert.equal(rateEntries[0].metadata.oldRate, '1.00');
  assert.equal(rateEntries[0].metadata.newRate, '2.50');

  const formulaEntries = logs.body.filter((l: { action: string }) => l.action === 'FORMULA_CHANGED');
  assert.equal(formulaEntries.length, 1);

  // The name-only patch added no third entry of either type.
  assert.equal(logs.body.length, 2);
});

test('updating company settings logs COMPANY_SETTINGS_CHANGED with the changed field names', async () => {
  const owner = await registeredOwner('Audit Company Co');

  const patch = await owner.patch('/api/company').send({ factoryName: 'New Factory', phone: '555-0100' });
  assert.equal(patch.status, 200);

  const logs = await owner.get('/api/audit-logs').query({ action: 'COMPANY_SETTINGS_CHANGED' });
  assert.equal(logs.status, 200);
  assert.equal(logs.body.length, 1);
  const changedFields: string[] = logs.body[0].metadata.changedFields;
  assert.ok(changedFields.includes('factoryName'));
  assert.ok(changedFields.includes('phone'));
  assert.equal(changedFields.length, 2);
});

test('filters by date range narrow the results', async () => {
  const owner = await registeredOwner('Audit Date Filter Co');
  const customerId = await createCustomer(owner, 'Audit Customer');
  await owner.post('/api/payments').send({ customerId, amount: '5.00', paymentMethod: 'cash' });

  const today = new Date().toISOString().slice(0, 10);
  const inRange = await owner.get('/api/audit-logs').query({ from: today, to: today });
  assert.equal(inRange.status, 200);
  assert.ok(inRange.body.length > 0);

  const outOfRange = await owner.get('/api/audit-logs').query({ from: '2000-01-01', to: '2000-01-02' });
  assert.equal(outOfRange.status, 200);
  assert.equal(outOfRange.body.length, 0);
});

test('rejects an invalid action or entityType filter', async () => {
  const owner = await registeredOwner('Audit Invalid Filter Co');
  const badAction = await owner.get('/api/audit-logs').query({ action: 'NOT_A_REAL_ACTION' });
  assert.equal(badAction.status, 400);

  const badEntityType = await owner.get('/api/audit-logs').query({ entityType: 'not-a-real-type' });
  assert.equal(badEntityType.status, 400);
});

test('owner and admin can view logs; staff cannot', async () => {
  const owner = await registeredOwner('Audit Access Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;

  const ownerLogs = await owner.get('/api/audit-logs');
  assert.equal(ownerLogs.status, 200);

  const admin = await memberAgent(owner, companyId, 'admin');
  const adminLogs = await admin.get('/api/audit-logs');
  assert.equal(adminLogs.status, 200);

  const staff = await memberAgent(owner, companyId, 'staff');
  const staffLogs = await staff.get('/api/audit-logs');
  assert.equal(staffLogs.status, 403);
});

test('audit logs are tenant isolated', async () => {
  const alice = await registeredOwner('Audit Tenant Alice Co');
  const customerId = await createCustomer(alice, 'Alice Customer');
  await alice.post('/api/payments').send({ customerId, amount: '5.00', paymentMethod: 'cash' });

  const bob = await registeredOwner('Audit Tenant Bob Co');
  const bobLogs = await bob.get('/api/audit-logs');
  assert.equal(bobLogs.status, 200);
  assert.equal(bobLogs.body.length, 0);
});

test('audit log routes require authentication', async () => {
  const res = await request(app).get('/api/audit-logs');
  assert.equal(res.status, 401);
});
