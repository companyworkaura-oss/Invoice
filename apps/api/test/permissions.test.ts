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
    fullName: 'Permissions Test Owner',
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

test('owner sees every defined permission on GET /api/auth/me', async () => {
  const owner = await registeredOwner('Permissions Owner Co');
  const me = await owner.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'owner');
  assert.ok(me.body.permissions.includes('invoice.view'));
  assert.ok(me.body.permissions.includes('company.manage'));
  assert.ok(me.body.permissions.includes('users.manage'));
  assert.ok(me.body.permissions.includes('audit.view'));
  assert.equal(me.body.permissions.length, 14);
});

test('admin sees every permission except users.manage', async () => {
  const owner = await registeredOwner('Permissions Admin Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;

  const admin = await memberAgent(owner, companyId, 'admin');
  const me = await admin.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'admin');
  assert.ok(me.body.permissions.includes('company.manage'));
  assert.ok(me.body.permissions.includes('invoice.edit'));
  assert.ok(me.body.permissions.includes('audit.view'));
  assert.equal(me.body.permissions.includes('users.manage'), false);
  assert.equal(me.body.permissions.length, 13);
});

test('staff sees the operational permission set — no company.manage, users.manage, invoice.edit, or invoice.cancel', async () => {
  const owner = await registeredOwner('Permissions Staff Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;

  const staff = await memberAgent(owner, companyId, 'staff');
  const me = await staff.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'staff');
  const permissions: string[] = me.body.permissions;
  assert.ok(permissions.includes('invoice.view'));
  assert.ok(permissions.includes('invoice.create'));
  assert.ok(permissions.includes('customer.edit'));
  assert.ok(permissions.includes('formula.manage'));
  assert.equal(permissions.includes('invoice.edit'), false);
  assert.equal(permissions.includes('invoice.cancel'), false);
  assert.equal(permissions.includes('company.manage'), false);
  assert.equal(permissions.includes('users.manage'), false);
});

test('staff can still perform every operational action their permissions grant', async () => {
  const owner = await registeredOwner('Permissions Staff Ops Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;
  const staff = await memberAgent(owner, companyId, 'staff');

  const customer = await staff.post('/api/customers').send({ name: 'Staff Made Customer' });
  assert.equal(customer.status, 201);

  const editCustomer = await staff.patch(`/api/customers/${customer.body.id}`).send({ notes: 'edited by staff' });
  assert.equal(editCustomer.status, 200);

  const category = await staff.post('/api/categories').send({
    name: 'Staff Category',
    defaultRate: '1.00',
    formulaConfig: { expression: 'stitches / 1000 * rate' },
  });
  assert.equal(category.status, 201);

  const invoice = await staff.post('/api/invoices').send({
    customerId: customer.body.id,
    quantity: '1',
    items: [{ categoryId: category.body.id, stitches: 1000 }],
  });
  assert.equal(invoice.status, 201);

  const payment = await staff.post('/api/payments').send({
    customerId: customer.body.id,
    amount: '10.00',
    paymentMethod: 'cash',
  });
  assert.equal(payment.status, 201);
});

test('admin can update company settings (company.manage) — same access as before this phase', async () => {
  const owner = await registeredOwner('Permissions Admin Manage Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;
  const admin = await memberAgent(owner, companyId, 'admin');

  const patch = await admin.patch('/api/company').send({ factoryName: 'Admin Edited' });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.factoryName, 'Admin Edited');
});

test('permission routes require authentication', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.equal(res.status, 401);
});
