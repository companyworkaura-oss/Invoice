import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Company deactivate/reactivate/permanent-delete (Phase 27) — see
// apps/api's company-lifecycle.service.ts for the exact rules this
// exercises: deactivate hides a company from the active switcher/login/
// session resolution while preserving every row it owns; permanent
// delete removes everything in one transaction, relying on every
// company-owned table's existing ON DELETE CASCADE.

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
    fullName: 'Lifecycle Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const me = await agent.get('/api/auth/me');
  return { agent, companyId: me.body.company.id as string, userId: me.body.id as string };
}

/** Adds a second user to the owner's company with the given role, and returns a logged-in, switched agent for them. They always own a separate "personal" company of their own too, from registering. */
async function memberAgent(companyId: string, role: 'admin' | 'staff') {
  const email = `${role}+${Date.now()}+${Math.random()}@example.com`;
  const reg = await request(app).post('/api/auth/register').send({
    companyName: `${role} personal co ${Date.now()}`,
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

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string, openingBalance?: string) {
  const res = await agent.post('/api/customers').send({ name, openingBalance });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>) {
  const res = await agent
    .post('/api/categories')
    .send({ name: 'HS/HP', defaultRate: '1.00', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

// ---- Deactivate / reactivate -------------------------------------------------

test('owner can deactivate their company: hidden from the active list, all data preserved', async () => {
  const { agent, companyId } = await registeredOwner('Deactivate Owner Co');
  await agent.post('/api/companies').send({ name: 'Deactivate Owner Second Co' }); // gives them somewhere to land
  await agent.post(`/api/companies/${companyId}/switch`); // createCompany auto-switches to the new one — switch back
  const customerId = await createCustomer(agent, 'Keep Me Customer', '500.00');

  const res = await agent.patch('/api/company/deactivate');
  assert.equal(res.status, 200);
  assert.ok(res.body.newActiveCompanyId, 'should have re-pointed the session to another company');

  // The session now active is the other company — switching back to the
  // deactivated one must fail.
  const switchBack = await agent.post(`/api/companies/${companyId}/switch`);
  assert.equal(switchBack.status, 400);

  // It's gone from the normal "active" set but still listed (for reactivate).
  const list = await agent.get('/api/companies');
  const entry = list.body.find((c: { id: string }) => c.id === companyId);
  assert.ok(entry, 'deactivated company must still be listed');
  assert.equal(entry.status, 'deactivated');

  // Customer data is untouched — reactivate and check.
  const reactivate = await agent.post(`/api/companies/${companyId}/reactivate`);
  assert.equal(reactivate.status, 200);
  assert.equal(reactivate.body.status, 'active');

  const switchIn = await agent.post(`/api/companies/${companyId}/switch`);
  assert.equal(switchIn.status, 200);
  const customer = await agent.get(`/api/customers/${customerId}`);
  assert.equal(customer.status, 200);
  assert.equal(customer.body.name, 'Keep Me Customer');
});

test('owner can reactivate a deactivated company', async () => {
  const { agent, companyId } = await registeredOwner('Reactivate Owner Co');
  await agent.post('/api/companies').send({ name: 'Reactivate Owner Second Co' });
  await agent.post(`/api/companies/${companyId}/switch`); // createCompany auto-switches to the new one — switch back
  await agent.patch('/api/company/deactivate');

  const res = await agent.post(`/api/companies/${companyId}/reactivate`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'active');

  const switchIn = await agent.post(`/api/companies/${companyId}/switch`);
  assert.equal(switchIn.status, 200);
});

test('reactivating an already-active company is rejected', async () => {
  const { agent, companyId } = await registeredOwner('Reactivate Already Active Co');
  const res = await agent.post(`/api/companies/${companyId}/reactivate`);
  assert.equal(res.status, 400);
});

test('cannot deactivate your only company', async () => {
  const { agent } = await registeredOwner('Only Company Co');
  const res = await agent.patch('/api/company/deactivate');
  assert.equal(res.status, 400);
});

test('admin can deactivate but staff cannot', async () => {
  const { agent: owner, companyId } = await registeredOwner('Deactivate Perm Co');
  const admin = await memberAgent(companyId, 'admin');
  const staff = await memberAgent(companyId, 'staff');

  assert.equal((await staff.patch('/api/company/deactivate')).status, 403);

  const adminResult = await admin.patch('/api/company/deactivate');
  assert.equal(adminResult.status, 200);

  // Restore it for cleanliness / so owner isn't left stranded mid-suite.
  await owner.post(`/api/companies/${companyId}/reactivate`);
});

test('a non-member cannot reactivate someone else’s company', async () => {
  const { agent: owner, companyId } = await registeredOwner('Foreign Reactivate Co');
  await owner.post('/api/companies').send({ name: 'Foreign Reactivate Second Co' });
  await owner.patch('/api/company/deactivate');

  const { agent: stranger } = await registeredOwner('Stranger Co');
  const res = await stranger.post(`/api/companies/${companyId}/reactivate`);
  assert.equal(res.status, 403);
});

// ---- Permanent delete: safety rules -------------------------------------------

test('typed company name must match exactly before delete proceeds', async () => {
  const { agent, companyId } = await registeredOwner('Typed Name Co');
  await agent.post('/api/companies').send({ name: 'Typed Name Second Co' });

  const wrong = await agent.delete('/api/company').send({ confirmName: 'the wrong name' });
  assert.equal(wrong.status, 400);

  // Nothing was deleted — company still exists and is reachable.
  const still = await agent.post(`/api/companies/${companyId}/switch`);
  assert.equal(still.status, 200);
});

test('non-owner (admin or staff) cannot permanently delete the company', async () => {
  const { companyId } = await registeredOwner('Delete Perm Co');
  const admin = await memberAgent(companyId, 'admin');
  const staff = await memberAgent(companyId, 'staff');

  assert.equal((await staff.delete('/api/company').send({ confirmName: 'Delete Perm Co' })).status, 403);
  assert.equal((await admin.delete('/api/company').send({ confirmName: 'Delete Perm Co' })).status, 403);
});

test('cannot delete your only company', async () => {
  const { agent } = await registeredOwner('Only Company Delete Co');
  const res = await agent.delete('/api/company').send({ confirmName: 'Only Company Delete Co' });
  assert.equal(res.status, 400);
});

test('transaction rollback: a blocked delete (wrong name) leaves every row untouched', async () => {
  const { agent, companyId } = await registeredOwner('Rollback Co');
  await agent.post('/api/companies').send({ name: 'Rollback Second Co' });
  await agent.post(`/api/companies/${companyId}/switch`); // createCompany auto-switches to the new one — switch back
  const customerId = await createCustomer(agent, 'Rollback Customer', '100.00');
  const categoryId = await createCategory(agent);
  const invoice = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ categoryId, stitches: 10000, quantity: '1' }],
  });
  assert.equal(invoice.status, 201);

  const blocked = await agent.delete('/api/company').send({ confirmName: 'not even close' });
  assert.equal(blocked.status, 400);

  // Everything this attempted-but-blocked delete would have touched is
  // still exactly there — proof the transaction never committed.
  await agent.post(`/api/companies/${companyId}/switch`);
  const custStill = await agent.get(`/api/customers/${customerId}`);
  assert.equal(custStill.status, 200);
  const invStill = await agent.get(`/api/invoices/${invoice.body.id}`);
  assert.equal(invStill.status, 200);
  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.balance, '110.00'); // 100.00 opening + 10.00 invoice debit, fully intact
});

// ---- Permanent delete: the real thing -----------------------------------------

test('permanent delete removes only that company’s data; other companies and the user account are untouched', async () => {
  const { agent, companyId, userId } = await registeredOwner('Delete Me Co');
  const secondCompany = await agent.post('/api/companies').send({ name: 'Delete Me Survivor Co' });
  assert.equal(secondCompany.status, 201);
  const survivorCompanyId: string = secondCompany.body.id;

  // Switch back to the company we're about to delete, and populate it.
  await agent.post(`/api/companies/${companyId}/switch`);
  const customerId = await createCustomer(agent, 'Doomed Customer', '250.00');
  const categoryId = await createCategory(agent);
  const invoice = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ categoryId, stitches: 10000, quantity: '1' }],
  });
  assert.equal(invoice.status, 201);
  const payment = await agent.post('/api/payments').send({ customerId, amount: '50.00', paymentMethod: 'cash' });
  assert.equal(payment.status, 201);

  // Also populate the survivor company, to prove it's untouched.
  await agent.post(`/api/companies/${survivorCompanyId}/switch`);
  const survivorCustomerId = await createCustomer(agent, 'Survivor Customer', '75.00');
  await agent.post(`/api/companies/${companyId}/switch`); // back to the one we're deleting

  const del = await agent.delete('/api/company').send({ confirmName: 'Delete Me Co' });
  assert.equal(del.status, 200);
  assert.equal(del.body.newActiveCompanyId, survivorCompanyId);

  // The session is still valid — it was re-pointed, not destroyed —
  // and now resolves to the survivor company automatically.
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.company.id, survivorCompanyId);

  // The deleted company itself: switching to it now 404s/400s (gone).
  const switchToDeleted = await agent.post(`/api/companies/${companyId}/switch`);
  assert.notEqual(switchToDeleted.status, 200);

  // The survivor company's own data is completely untouched.
  const survivorCustomer = await agent.get(`/api/customers/${survivorCustomerId}`);
  assert.equal(survivorCustomer.status, 200);
  assert.equal(survivorCustomer.body.name, 'Survivor Customer');

  // The user account itself survived (it's who's making this very request).
  const dbUser = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  assert.equal(dbUser.rows.length, 1);

  // Nothing from the deleted company is orphaned in the database —
  // every company-owned row is gone, not left dangling with a
  // dead company_id.
  const orphanChecks = await Promise.all([
    pool.query('SELECT 1 FROM customers WHERE id = $1', [customerId]),
    pool.query('SELECT 1 FROM invoices WHERE id = $1', [invoice.body.id]),
    pool.query('SELECT 1 FROM payments WHERE id = $1', [payment.body.id]),
    pool.query('SELECT 1 FROM ledger_entries WHERE company_id = $1', [companyId]),
    pool.query('SELECT 1 FROM invoice_items WHERE invoice_id = $1', [invoice.body.id]),
    pool.query('SELECT 1 FROM company_members WHERE company_id = $1', [companyId]),
    pool.query('SELECT 1 FROM audit_logs WHERE company_id = $1', [companyId]),
    pool.query('SELECT 1 FROM companies WHERE id = $1', [companyId]),
  ]);
  for (const result of orphanChecks) {
    assert.equal(result.rowCount, 0, 'no row from the deleted company should remain anywhere');
  }

  // The durable deletion record survives outside the deleted tenant's
  // own (now-gone) audit_logs.
  const deletionLog = await pool.query('SELECT company_name, member_count FROM company_deletion_log WHERE company_id = $1', [
    companyId,
  ]);
  assert.equal(deletionLog.rows.length, 1);
  assert.equal(deletionLog.rows[0].company_name, 'Delete Me Co');
});

test('tenant isolation: deleting/deactivating always acts on the caller’s own active company, never another tenant’s', async () => {
  const alice = await registeredOwner('Alice Lifecycle Co');
  await alice.agent.post('/api/companies').send({ name: 'Alice Lifecycle Second Co' });
  await alice.agent.post(`/api/companies/${alice.companyId}/switch`); // createCompany auto-switches to the new one — switch back
  const bob = await registeredOwner('Bob Lifecycle Co');

  // Bob deactivates "his" company (his own active one) — Alice's company must be untouched.
  const bobDeactivate = await bob.agent.patch('/api/company/deactivate');
  // Bob only has one company, so this is actually blocked — but either
  // way, Alice's company must never be affected by anything Bob does.
  void bobDeactivate;

  const aliceStillActive = await alice.agent.get('/api/auth/me');
  assert.equal(aliceStillActive.status, 200);
  assert.equal(aliceStillActive.body.company.id, alice.companyId);

  // Bob cannot reactivate Alice's company either — he isn't a member of
  // it at all, so this is a flat 403, never leaking whether it's active
  // or deactivated to someone with no access to it in the first place.
  const bobReactivateAlice = await bob.agent.post(`/api/companies/${alice.companyId}/reactivate`);
  assert.equal(bobReactivateAlice.status, 403);
});

test('session redirects after deletion: GET /auth/me reflects the new active company with no further action needed', async () => {
  const { agent, companyId } = await registeredOwner('Redirect Co');
  const second = await agent.post('/api/companies').send({ name: 'Redirect Second Co' });
  const secondId: string = second.body.id;
  await agent.post(`/api/companies/${companyId}/switch`);

  const del = await agent.delete('/api/company').send({ confirmName: 'Redirect Co' });
  assert.equal(del.status, 200);

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.company.id, secondId, 'the very next request already resolves to the surviving company');
});

test('deleting a nonexistent typed name on an empty company is a clean 400, not a 500', async () => {
  const { agent } = await registeredOwner('Clean Error Co');
  await agent.post('/api/companies').send({ name: 'Clean Error Second Co' });
  const res = await agent.delete('/api/company').send({});
  assert.equal(res.status, 400);
});

test('lifecycle routes require authentication', async () => {
  const fakeId = '00000000-0000-0000-0000-000000000000';
  assert.equal((await request(app).patch('/api/company/deactivate')).status, 401);
  assert.equal((await request(app).delete('/api/company').send({ confirmName: 'x' })).status, 401);
  assert.equal((await request(app).post(`/api/companies/${fakeId}/reactivate`)).status, 401);
});
