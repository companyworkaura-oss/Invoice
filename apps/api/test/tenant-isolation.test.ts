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

async function registerUser(companyName: string) {
  const agent = request.agent(app);
  const email = `${companyName.toLowerCase().replace(/\s+/g, '')}+${Date.now()}+${Math.random()}@example.com`;
  const res = await agent.post('/api/auth/register').send({
    companyName,
    fullName: 'Test User',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

test('a session only ever sees its own company, never one supplied by the caller', async () => {
  const aliceAgent = await registerUser('Alice Stitching');
  const bobAgent = await registerUser('Bob Embroidery');

  const aliceMe = await aliceAgent.get('/api/auth/me');
  const bobMe = await bobAgent.get('/api/auth/me');
  const aliceCompanyId: string = aliceMe.body.company.id;
  const bobCompanyId: string = bobMe.body.company.id;
  assert.notEqual(aliceCompanyId, bobCompanyId);

  // Bob is not a member of Alice's company: switching to it must be refused,
  // and Bob's active company must be unchanged afterwards.
  const switchAttempt = await bobAgent.post(`/api/companies/${aliceCompanyId}/switch`);
  assert.equal(switchAttempt.status, 403);

  const bobMeAfter = await bobAgent.get('/api/auth/me');
  assert.equal(bobMeAfter.body.company.id, bobCompanyId);

  // Renaming Alice's company from Bob's session must not be possible even
  // though Bob knows Alice's company id — there is no way to pass it in.
  const patchAttempt = await bobAgent.patch('/api/company').send({ name: 'Hijacked' });
  assert.equal(patchAttempt.status, 200); // this only ever touches Bob's own company
  const aliceStillIntact = await aliceAgent.get('/api/company');
  assert.equal(aliceStillIntact.body.name, 'Alice Stitching');
});

test('company creation adds a membership and switches the active session tenant', async () => {
  const agent = await registerUser('First Co');
  const firstMe = await agent.get('/api/auth/me');
  const firstCompanyId: string = firstMe.body.company.id;

  const created = await agent.post('/api/companies').send({ name: 'Second Co' });
  assert.equal(created.status, 201);
  assert.equal(created.body.role, 'owner');
  assert.equal(created.body.name, 'Second Co');

  // Creating switches the active tenant immediately.
  const meAfterCreate = await agent.get('/api/auth/me');
  assert.equal(meAfterCreate.body.company.id, created.body.id);
  assert.notEqual(meAfterCreate.body.company.id, firstCompanyId);

  const list = await agent.get('/api/companies');
  assert.equal(list.status, 200);
  const ids = list.body.map((c: { id: string }) => c.id).sort();
  assert.deepEqual(ids, [firstCompanyId, created.body.id].sort());

  // Switch back to the first company and confirm isolation holds both ways.
  const switched = await agent.post(`/api/companies/${firstCompanyId}/switch`);
  assert.equal(switched.status, 200);
  assert.equal(switched.body.id, firstCompanyId);
  const meAfterSwitch = await agent.get('/api/auth/me');
  assert.equal(meAfterSwitch.body.company.id, firstCompanyId);
});

test('staff role cannot update company settings', async () => {
  // Registering always makes the caller owner; role enforcement is exercised
  // directly against a manufactured staff membership.
  const owner = await registerUser('Role Test Co');
  const ownerMe = await owner.get('/api/auth/me');
  const companyId: string = ownerMe.body.company.id;

  const email = `staff+${Date.now()}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({
    companyName: 'Staff Personal Co',
    fullName: 'Staff Person',
    email,
    password: 'correct horse battery',
  });
  const staffUserId: string = reg.body.ok ? (await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email])).rows[0].id : '';
  await pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'staff')`, [
    companyId,
    staffUserId,
  ]);

  const staffAgent = request.agent(app);
  await staffAgent.post('/api/auth/login').send({ email, password: 'correct horse battery' });
  const switchRes = await staffAgent.post(`/api/companies/${companyId}/switch`);
  assert.equal(switchRes.status, 200);

  const patchRes = await staffAgent.patch('/api/company').send({ name: 'Should not work' });
  assert.equal(patchRes.status, 403);
});
