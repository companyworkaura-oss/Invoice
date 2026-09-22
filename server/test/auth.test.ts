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

test('register, me, logout, login round trip', async () => {
  const agent = request.agent(app);

  const reg = await agent.post('/api/auth/register').send({
    companyName: 'Stitch Co',
    fullName: 'Ada Lovelace',
    email: `ada+${Date.now()}@example.com`,
    password: 'correct horse battery',
  });
  assert.equal(reg.status, 201);

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.company.name, 'Stitch Co');
  assert.equal(me.body.role, 'owner');

  const patch = await agent.patch('/api/company').send({ name: 'Stitch Co Renamed' });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.name, 'Stitch Co Renamed');

  await agent.post('/api/auth/logout');
  const meAfterLogout = await agent.get('/api/auth/me');
  assert.equal(meAfterLogout.status, 401);
});

test('rejects duplicate email and bad login', async () => {
  const email = `dup+${Date.now()}@example.com`;
  const payload = { companyName: 'A', fullName: 'A A', email, password: 'password123' };
  const first = await request(app).post('/api/auth/register').send(payload);
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/auth/register').send(payload);
  assert.equal(second.status, 409);

  const badLogin = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
  assert.equal(badLogin.status, 401);
});

test('tenant isolation: unauthenticated request is rejected', async () => {
  const res = await request(app).get('/api/company');
  assert.equal(res.status, 401);
});
