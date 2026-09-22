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
    fullName: 'Category Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

test('create, view, list, and edit a category with a custom formula config', async () => {
  const agent = await registeredOwner('Category CRUD Co');

  const created = await agent.post('/api/categories').send({
    name: 'HS/HP',
    description: 'Hand stitch / hand pattern work',
    defaultRate: '45.00',
    formulaType: 'per_unit',
    formulaConfig: { unit: 'piece', minimumQuantity: 10 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'HS/HP');
  assert.equal(created.body.defaultRate, '45.00'); // decimal string, not a float
  assert.equal(created.body.formulaType, 'per_unit');
  assert.deepEqual(created.body.formulaConfig, { unit: 'piece', minimumQuantity: 10 });
  assert.equal(created.body.active, true);

  const details = await agent.get(`/api/categories/${created.body.id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.description, 'Hand stitch / hand pattern work');

  const list = await agent.get('/api/categories');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);

  const edited = await agent.patch(`/api/categories/${created.body.id}`).send({ defaultRate: '50.00' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.defaultRate, '50.00');
  assert.equal(edited.body.name, 'HS/HP'); // untouched fields survive a partial patch
  assert.deepEqual(edited.body.formulaConfig, { unit: 'piece', minimumQuantity: 10 }); // also untouched
});

test('is not hard-coded to any particular set of category names or formula types', async () => {
  const agent = await registeredOwner('Arbitrary Category Co');
  const names = ['Daman Lace', 'Motia', 'Patti', 'Bazu', 'Dupatta', 'Something Nobody Has Named Before'];
  for (const name of names) {
    const res = await agent.post('/api/categories').send({ name, formulaType: 'whatever_new_type_v7' });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, name);
    assert.equal(res.body.formulaType, 'whatever_new_type_v7');
  }
  const list = await agent.get('/api/categories');
  assert.equal(list.body.length, names.length);
});

test('defaults: rate zero, formula type "fixed", empty config', async () => {
  const agent = await registeredOwner('Category Defaults Co');
  const res = await agent.post('/api/categories').send({ name: 'Plain Category' });
  assert.equal(res.status, 201);
  assert.equal(res.body.defaultRate, '0.00');
  assert.equal(res.body.formulaType, 'fixed');
  assert.deepEqual(res.body.formulaConfig, {});
});

test('rejects a non-decimal default rate and a non-object formula config', async () => {
  const agent = await registeredOwner('Category Validation Co');

  const badRate = await agent.post('/api/categories').send({ name: 'Bad Rate', defaultRate: 'free' });
  assert.equal(badRate.status, 400);

  const badConfig = await agent.post('/api/categories').send({ name: 'Bad Config', formulaConfig: 'not an object' });
  assert.equal(badConfig.status, 400);

  const arrayConfig = await agent.post('/api/categories').send({ name: 'Array Config', formulaConfig: [1, 2, 3] });
  assert.equal(arrayConfig.status, 400);
});

test('disable removes a category from the default list without deleting it; enable brings it back', async () => {
  const agent = await registeredOwner('Category Disable Co');
  const created = await agent.post('/api/categories').send({ name: 'Soon Disabled' });

  const disabled = await agent.post(`/api/categories/${created.body.id}/disable`);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.active, false);

  const defaultList = await agent.get('/api/categories');
  assert.equal(defaultList.body.length, 0);

  const disabledList = await agent.get('/api/categories').query({ status: 'disabled' });
  assert.equal(disabledList.body.length, 1);

  const allList = await agent.get('/api/categories').query({ status: 'all' });
  assert.equal(allList.body.length, 1);

  const stillReachable = await agent.get(`/api/categories/${created.body.id}`);
  assert.equal(stillReachable.status, 200);

  const enabled = await agent.post(`/api/categories/${created.body.id}/enable`);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.active, true);
  const activeListAgain = await agent.get('/api/categories');
  assert.equal(activeListAgain.body.length, 1);
});

test('tenant isolation: a category created in one company is invisible to another', async () => {
  const alice = await registeredOwner('Alice Category Co');
  const bob = await registeredOwner('Bob Category Co');

  const aliceCategory = await alice.post('/api/categories').send({ name: 'Alice-only category' });
  assert.equal(aliceCategory.status, 201);

  const bobList = await bob.get('/api/categories');
  assert.equal(bobList.body.length, 0);

  const bobDirectFetch = await bob.get(`/api/categories/${aliceCategory.body.id}`);
  assert.equal(bobDirectFetch.status, 404);

  const bobEditAttempt = await bob.patch(`/api/categories/${aliceCategory.body.id}`).send({ name: 'Hijacked' });
  assert.equal(bobEditAttempt.status, 404);

  const bobDisableAttempt = await bob.post(`/api/categories/${aliceCategory.body.id}/disable`);
  assert.equal(bobDisableAttempt.status, 404);

  const stillAlices = await alice.get(`/api/categories/${aliceCategory.body.id}`);
  assert.equal(stillAlices.body.name, 'Alice-only category');
  assert.equal(stillAlices.body.active, true);
});

test('category routes require authentication', async () => {
  const res = await request(app).get('/api/categories');
  assert.equal(res.status, 401);
});
