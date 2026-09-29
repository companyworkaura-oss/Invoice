import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Invoice lifecycle actions (Phase 21): archive/unarchive (visibility
// only, never an accounting reversal) and a hard delete that's only ever
// allowed when it can't corrupt accounting history — see
// apps/api's invoice.service.ts for the exact rules this exercises.

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
    fullName: 'Archive Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const me = await agent.get('/api/auth/me');
  return { agent, companyId: me.body.company.id as string };
}

/** Adds a second user to the owner's company with the given role, and returns a logged-in, switched agent for them. */
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

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.post('/api/customers').send({ name });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createCategory(agent: ReturnType<typeof request.agent>, name = 'HS/HP') {
  const res = await agent
    .post('/api/categories')
    .send({ name, defaultRate: '1.20', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function createInvoice(
  agent: ReturnType<typeof request.agent>,
  customerId: string,
  categoryId: string,
  status?: 'draft' | 'issued',
) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    quantity: '10',
    status,
    items: [{ categoryId, stitches: 12000 }],
  });
  assert.equal(res.status, 201);
  return res.body as { id: string; invoiceNumber: string; customerId: string };
}

test('archives an invoice: hidden from the default (active) list, visible in archived/all', async () => {
  const { agent } = await registeredOwner('Archive Basic Co');
  const customerId = await createCustomer(agent, 'Archive Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const archiveRes = await agent.patch(`/api/invoices/${invoice.id}/archive`);
  assert.equal(archiveRes.status, 200);
  assert.ok(archiveRes.body.archivedAt, 'archivedAt should be set on the response');

  const activeList = await agent.get('/api/invoices'); // default = active
  assert.ok(!activeList.body.some((i: { id: string }) => i.id === invoice.id), 'must not appear in the active list');

  const archivedList = await agent.get('/api/invoices').query({ archived: 'archived' });
  assert.ok(archivedList.body.some((i: { id: string }) => i.id === invoice.id), 'must appear in the archived list');

  const allList = await agent.get('/api/invoices').query({ archived: 'all' });
  assert.ok(allList.body.some((i: { id: string }) => i.id === invoice.id), 'must appear in the all list');

  // A direct GET still works — archiving never hides the invoice from a
  // direct fetch, only from the default list.
  const direct = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(direct.status, 200);
  assert.ok(direct.body.archivedAt);
});

test('rejects archiving an already-archived invoice', async () => {
  const { agent } = await registeredOwner('Archive Twice Co');
  const customerId = await createCustomer(agent, 'Twice Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  await agent.patch(`/api/invoices/${invoice.id}/archive`);
  const second = await agent.patch(`/api/invoices/${invoice.id}/archive`);
  assert.equal(second.status, 400);
});

test('unarchives an invoice: restored to the active list, calculations/payments untouched', async () => {
  const { agent } = await registeredOwner('Unarchive Co');
  const customerId = await createCustomer(agent, 'Unarchive Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  await agent.post('/api/payments').send({ customerId, amount: '50.00', paymentMethod: 'cash' });

  await agent.patch(`/api/invoices/${invoice.id}/archive`);
  const unarchiveRes = await agent.patch(`/api/invoices/${invoice.id}/unarchive`);
  assert.equal(unarchiveRes.status, 200);
  assert.equal(unarchiveRes.body.archivedAt, null);
  // Ledger-derived figures are exactly what they'd be if archiving never happened.
  assert.equal(unarchiveRes.body.totalAmount, '144.00');
  assert.equal(unarchiveRes.body.amountPaid, '50.00');

  const activeList = await agent.get('/api/invoices');
  assert.ok(activeList.body.some((i: { id: string }) => i.id === invoice.id), 'must be back in the active list');
});

test('rejects unarchiving an invoice that is not archived', async () => {
  const { agent } = await registeredOwner('Unarchive Not Archived Co');
  const customerId = await createCustomer(agent, 'Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  const res = await agent.patch(`/api/invoices/${invoice.id}/unarchive`);
  assert.equal(res.status, 400);
});

test('deletes a safe draft invoice with no payments: removed, ledger entry removed, balances still correct', async () => {
  const { agent } = await registeredOwner('Delete Safe Draft Co');
  const customerId = await createCustomer(agent, 'Delete Customer');
  const categoryId = await createCategory(agent);
  const keep = await createInvoice(agent, customerId, categoryId); // an untouched sibling invoice
  const toDelete = await createInvoice(agent, customerId, categoryId);

  const before = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(before.body.balance, '288.00'); // 144 + 144

  const del = await agent.delete(`/api/invoices/${toDelete.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  const getDeleted = await agent.get(`/api/invoices/${toDelete.id}`);
  assert.equal(getDeleted.status, 404, 'the invoice itself is gone');

  const after = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(after.body.balance, '144.00', "only the deleted invoice's debit is gone");
  assert.ok(
    !after.body.entries.some((e: { referenceId: string }) => e.referenceId === toDelete.id),
    "the deleted invoice's ledger entry must be gone too",
  );

  const stillThere = await agent.get(`/api/invoices/${keep.id}`);
  assert.equal(stillThere.status, 200, 'the sibling invoice is untouched');
});

test('blocks deleting an issued invoice, even with no payments', async () => {
  const { agent } = await registeredOwner('Delete Issued Co');
  const customerId = await createCustomer(agent, 'Issued Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId, 'issued');

  const res = await agent.delete(`/api/invoices/${invoice.id}`);
  assert.equal(res.status, 400);
  assert.match(res.body.details?.status ?? '', /draft/i);

  const stillThere = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(stillThere.status, 200, 'blocked delete must not remove the invoice');
});

test('blocks deleting a draft invoice once a payment has actually reached it', async () => {
  const { agent } = await registeredOwner('Delete Paid Draft Co');
  const customerId = await createCustomer(agent, 'Paid Draft Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId); // total 144.00

  // Pay it off in full — FIFO now attributes this payment to this exact invoice.
  const payment = await agent.post('/api/payments').send({ customerId, amount: '144.00', paymentMethod: 'cash' });
  assert.equal(payment.status, 201);

  const res = await agent.delete(`/api/invoices/${invoice.id}`);
  assert.equal(res.status, 400);

  const stillThere = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(stillThere.status, 200, 'blocked delete must not remove the invoice');

  // The payment and its ledger credit are completely untouched.
  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '0.00');
});

test('archived invoices still count toward historical/accounting totals', async () => {
  const { agent } = await registeredOwner('Archive Totals Co');
  const customerId = await createCustomer(agent, 'Totals Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId, 'issued');

  const before = await agent.get(`/api/customers/${customerId}/ledger`);
  await agent.patch(`/api/invoices/${invoice.id}/archive`);
  const after = await agent.get(`/api/customers/${customerId}/ledger`);

  // Archiving is visibility only — the customer's ledger balance (and by
  // extension every dashboard/statement figure derived from it) is
  // identical before and after.
  assert.equal(after.body.balance, before.body.balance);
  assert.equal(after.body.balance, '144.00');
});

test('tenant isolation: cannot archive, unarchive, or delete another company’s invoice', async () => {
  const alice = await registeredOwner('Alice Archive Co');
  const bob = await registeredOwner('Bob Archive Co');
  const aliceCustomer = await createCustomer(alice.agent, 'Alice Customer');
  const aliceCategory = await createCategory(alice.agent);
  const aliceInvoice = await createInvoice(alice.agent, aliceCustomer, aliceCategory);

  assert.equal((await bob.agent.patch(`/api/invoices/${aliceInvoice.id}/archive`)).status, 404);
  assert.equal((await bob.agent.patch(`/api/invoices/${aliceInvoice.id}/unarchive`)).status, 404);
  assert.equal((await bob.agent.delete(`/api/invoices/${aliceInvoice.id}`)).status, 404);

  // Confirm none of Bob's attempts actually did anything to Alice's invoice.
  const stillThere = await alice.agent.get(`/api/invoices/${aliceInvoice.id}`);
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.body.archivedAt, null);
});

test('permissions: staff cannot archive, unarchive, or delete an invoice; owner and admin can', async () => {
  const { agent: owner, companyId } = await registeredOwner('Permissions Archive Co');
  const customerId = await createCustomer(owner, 'Perm Customer');
  const categoryId = await createCategory(owner);
  const staff = await memberAgent(companyId, 'staff');
  const admin = await memberAgent(companyId, 'admin');

  const staffInvoice = await createInvoice(owner, customerId, categoryId);
  assert.equal((await staff.patch(`/api/invoices/${staffInvoice.id}/archive`)).status, 403);
  assert.equal((await staff.delete(`/api/invoices/${staffInvoice.id}`)).status, 403);

  const adminInvoice = await createInvoice(owner, customerId, categoryId);
  const adminArchive = await admin.patch(`/api/invoices/${adminInvoice.id}/archive`);
  assert.equal(adminArchive.status, 200);
  const adminUnarchive = await admin.patch(`/api/invoices/${adminInvoice.id}/unarchive`);
  assert.equal(adminUnarchive.status, 200);
  const adminDelete = await admin.delete(`/api/invoices/${adminInvoice.id}`);
  assert.equal(adminDelete.status, 200);
});

test('audit log: archive, unarchive, and delete each post their own entry', async () => {
  const { agent } = await registeredOwner('Audit Archive Co');
  const customerId = await createCustomer(agent, 'Audit Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId);

  await agent.patch(`/api/invoices/${invoice.id}/archive`);
  await agent.patch(`/api/invoices/${invoice.id}/unarchive`);
  await agent.delete(`/api/invoices/${invoice.id}`);

  const logs = await agent.get('/api/audit-logs');
  assert.equal(logs.status, 200);

  const archived = logs.body.find((l: { action: string; entityId: string }) => l.action === 'INVOICE_ARCHIVED' && l.entityId === invoice.id);
  const unarchived = logs.body.find((l: { action: string; entityId: string }) => l.action === 'INVOICE_UNARCHIVED' && l.entityId === invoice.id);
  const deleted = logs.body.find((l: { action: string; entityId: string }) => l.action === 'INVOICE_DELETED' && l.entityId === invoice.id);

  assert.ok(archived, 'expected an INVOICE_ARCHIVED entry');
  assert.equal(archived.metadata.invoiceNumber, invoice.invoiceNumber);
  assert.ok(unarchived, 'expected an INVOICE_UNARCHIVED entry');
  assert.ok(deleted, 'expected an INVOICE_DELETED entry');
  assert.equal(deleted.metadata.invoiceNumber, invoice.invoiceNumber);
  assert.equal(deleted.metadata.totalAmount, '144.00');
});

test('requires authentication for archive/unarchive/delete', async () => {
  const fakeId = '00000000-0000-0000-0000-000000000000';
  assert.equal((await request(app).patch(`/api/invoices/${fakeId}/archive`)).status, 401);
  assert.equal((await request(app).patch(`/api/invoices/${fakeId}/unarchive`)).status, 401);
  assert.equal((await request(app).delete(`/api/invoices/${fakeId}`)).status, 401);
});
