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
    fullName: 'Customer Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

test('create, view, list, and edit a customer', async () => {
  const agent = await registeredOwner('Customer CRUD Co');

  const created = await agent.post('/api/customers').send({
    name: 'Acme Uniforms',
    businessName: 'Acme Uniforms LLC',
    phone: '+1 555 0111',
    openingBalance: '250.75',
    notes: 'Prefers embroidered polos',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Acme Uniforms');
  assert.equal(created.body.openingBalance, '250.75'); // decimal string, not a float
  assert.equal(created.body.status, 'active');
  assert.equal(typeof created.body.id, 'string');

  const details = await agent.get(`/api/customers/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.businessName, 'Acme Uniforms LLC');

  const list = await agent.get('/api/customers');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, created.body.id);

  const edited = await agent.patch(`/api/customers/${created.body.id}`).send({ phone: '+1 555 0199' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.phone, '+1 555 0199');
  assert.equal(edited.body.name, 'Acme Uniforms'); // untouched fields survive a partial patch
});

test('opening balance defaults to zero and rejects non-decimal input', async () => {
  const agent = await registeredOwner('Balance Co');

  const noBalance = await agent.post('/api/customers').send({ name: 'No Balance Customer' });
  assert.equal(noBalance.status, 201);
  assert.equal(noBalance.body.openingBalance, '0.00');

  const badBalance = await agent.post('/api/customers').send({ name: 'Bad Balance', openingBalance: 'twelve' });
  assert.equal(badBalance.status, 400);

  const floatLooking = await agent.post('/api/customers').send({ name: 'Precise', openingBalance: '10.999' });
  assert.equal(floatLooking.status, 400); // more than 2 decimal places
});

test('search filters by name, business name, or phone', async () => {
  const agent = await registeredOwner('Search Co');
  await agent.post('/api/customers').send({ name: 'Blue Thread Studio', phone: '111-2222' });
  await agent.post('/api/customers').send({ name: 'Red Needle Shop', businessName: 'Bluebird Designs' });
  await agent.post('/api/customers').send({ name: 'Green Stitch', phone: '333-4444' });

  const byName = await agent.get('/api/customers').query({ search: 'blue' });
  assert.equal(byName.status, 200);
  assert.equal(byName.body.length, 2); // matches name and business_name

  const byPhone = await agent.get('/api/customers').query({ search: '333-4444' });
  assert.equal(byPhone.body.length, 1);
  assert.equal(byPhone.body[0].name, 'Green Stitch');
});

test('archive removes a customer from the default list but not from the database', async () => {
  const agent = await registeredOwner('Archive Co');
  const created = await agent.post('/api/customers').send({ name: 'Soon Archived' });

  const archived = await agent.post(`/api/customers/${created.body.id}/archive`);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.status, 'archived');

  const defaultList = await agent.get('/api/customers');
  assert.equal(defaultList.body.length, 0);

  const archivedList = await agent.get('/api/customers').query({ status: 'archived' });
  assert.equal(archivedList.body.length, 1);

  const allList = await agent.get('/api/customers').query({ status: 'all' });
  assert.equal(allList.body.length, 1);

  // Still directly reachable and editable, just not in the active list.
  const stillReachable = await agent.get(`/api/customers/${created.body.id}`);
  assert.equal(stillReachable.status, 200);
});

test('tenant isolation: a customer created in one company is invisible to another', async () => {
  const alice = await registeredOwner('Alice Customer Co');
  const bob = await registeredOwner('Bob Customer Co');

  const aliceCustomer = await alice.post('/api/customers').send({ name: 'Alice-only customer' });
  assert.equal(aliceCustomer.status, 201);

  const bobList = await bob.get('/api/customers');
  assert.equal(bobList.body.length, 0);

  const bobDirectFetch = await bob.get(`/api/customers/${aliceCustomer.body.id}`);
  assert.equal(bobDirectFetch.status, 404); // exists, but not in Bob's tenant

  const bobEditAttempt = await bob.patch(`/api/customers/${aliceCustomer.body.id}`).send({ name: 'Hijacked' });
  assert.equal(bobEditAttempt.status, 404);

  const bobArchiveAttempt = await bob.post(`/api/customers/${aliceCustomer.body.id}/archive`);
  assert.equal(bobArchiveAttempt.status, 404);

  const stillAlices = await alice.get(`/api/customers/${aliceCustomer.body.id}`);
  assert.equal(stillAlices.body.name, 'Alice-only customer');
});

test('customer routes require authentication', async () => {
  const res = await request(app).get('/api/customers');
  assert.equal(res.status, 401);
});
