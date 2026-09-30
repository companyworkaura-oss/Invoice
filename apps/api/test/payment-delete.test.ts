import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// Delete Payment (safe deletion): removing a payment must reverse its
// ledger credit and only that credit, in one transaction — never just
// the payment row by itself. Invoice paid/balance/paymentStatus and
// customer balance are always FIFO-derived live from ledger_entries on
// read (see payment.service.ts's deletePayment doc comment), so this
// exercises that the cascade actually happens correctly end to end.

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
    fullName: 'Payment Delete Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  const me = await agent.get('/api/auth/me');
  return { agent, companyId: me.body.company.id as string };
}

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

async function createCategory(agent: ReturnType<typeof request.agent>, name = 'HS/HP') {
  const res = await agent
    .post('/api/categories')
    .send({ name, defaultRate: '1.00', formulaConfig: { expression: 'stitches / 1000 * rate' } });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

async function paymentStatusOf(agent: ReturnType<typeof request.agent>, invoiceId: string) {
  const list = await agent.get('/api/invoices').query({ archived: 'all' });
  const entry = list.body.find((i: { id: string }) => i.id === invoiceId);
  return entry?.paymentStatus as string | undefined;
}

async function createInvoice(agent: ReturnType<typeof request.agent>, customerId: string, categoryId: string, stitches = 10000000) {
  // stitches / 1000 * rate(1.00) => 10000000/1000 = 10000.00
  const res = await agent.post('/api/invoices').send({
    customerId,
    status: 'issued',
    items: [{ categoryId, stitches }],
  });
  assert.equal(res.status, 201);
  return res.body as { id: string; totalAmount: string };
}

test('deletes a normal customer payment: payment row and ledger credit both gone', async () => {
  const { agent } = await registeredOwner('Delete Normal Payment Co');
  const customerId = await createCustomer(agent, 'Normal Customer', '500.00');

  const payment = await agent.post('/api/payments').send({ customerId, amount: '150.00', paymentMethod: 'bank' });
  assert.equal(payment.status, 201);

  const del = await agent.delete(`/api/payments/${payment.body.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);
  assert.equal(del.body.id, payment.body.id);

  const getDeleted = await agent.get(`/api/payments/${payment.body.id}`);
  assert.equal(getDeleted.status, 404, 'the payment itself is gone');
});

test('deleting a payment removes only its own ledger credit, never unrelated entries', async () => {
  const { agent } = await registeredOwner('Ledger Scoped Delete Co');
  const customerId = await createCustomer(agent, 'Scoped Customer', '1000.00');

  const keep = await agent.post('/api/payments').send({ customerId, amount: '40.00', paymentMethod: 'cash' });
  const toDelete = await agent.post('/api/payments').send({ customerId, amount: '60.00', paymentMethod: 'cash' });

  const before = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(before.body.balance, '900.00'); // 1000 - 40 - 60

  const del = await agent.delete(`/api/payments/${toDelete.body.id}`);
  assert.equal(del.status, 200);

  const after = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(after.body.balance, '960.00', 'only the deleted payment credit is gone'); // 1000 - 40 (60 removed)
  assert.ok(
    !after.body.entries.some((e: { referenceId: string }) => e.referenceId === toDelete.body.id),
    "the deleted payment's ledger entry must be gone",
  );
  assert.ok(
    after.body.entries.some((e: { referenceId: string }) => e.referenceId === keep.body.id),
    "the other payment's ledger entry must remain untouched",
  );
});

test('customer balance immediately reflects the deletion', async () => {
  const { agent } = await registeredOwner('Balance Reflect Co');
  const customerId = await createCustomer(agent, 'Balance Customer', '200.00');

  const payment = await agent.post('/api/payments').send({ customerId, amount: '75.00', paymentMethod: 'cash' });
  const midLedger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(midLedger.body.balance, '125.00');

  await agent.delete(`/api/payments/${payment.body.id}`);

  const finalLedger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(finalLedger.body.balance, '200.00', 'balance is back to the opening balance');
});

test('deleting a payment that fully paid an invoice: invoice reverts from PAID to UNPAID', async () => {
  const { agent } = await registeredOwner('Full Payment Reversal Co');
  const customerId = await createCustomer(agent, 'Full Payment Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId); // 10000.00 total

  const payment = await agent.post('/api/payments').send({ customerId, amount: '10000.00', paymentMethod: 'bank' });
  assert.equal(payment.status, 201);

  const paidState = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(paidState.body.amountPaid, '10000.00');
  assert.equal(paidState.body.currentBalance, '0.00');
  assert.equal(await paymentStatusOf(agent, invoice.id), 'PAID');

  const del = await agent.delete(`/api/payments/${payment.body.id}`);
  assert.equal(del.status, 200);

  const reverted = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(reverted.body.amountPaid, '0.00');
  assert.equal(reverted.body.currentBalance, '10000.00');
  assert.equal(await paymentStatusOf(agent, invoice.id), 'UNPAID');
});

test('deleting one of several partial payments recalculates amount paid and status correctly', async () => {
  const { agent } = await registeredOwner('Partial Payment Reversal Co');
  const customerId = await createCustomer(agent, 'Partial Payment Customer');
  const categoryId = await createCategory(agent);
  const invoice = await createInvoice(agent, customerId, categoryId); // 10000.00 total

  const first = await agent.post('/api/payments').send({ customerId, amount: '3000.00', paymentMethod: 'cash' });
  const second = await agent.post('/api/payments').send({ customerId, amount: '4000.00', paymentMethod: 'bank' });

  const partialState = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(partialState.body.amountPaid, '7000.00');
  assert.equal(partialState.body.currentBalance, '3000.00');
  assert.equal(await paymentStatusOf(agent, invoice.id), 'PARTIAL');

  const del = await agent.delete(`/api/payments/${second.body.id}`);
  assert.equal(del.status, 200);

  const after = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(after.body.amountPaid, '3000.00');
  assert.equal(after.body.currentBalance, '7000.00');
  assert.equal(await paymentStatusOf(agent, invoice.id), 'PARTIAL');

  // Deleting the remaining payment too brings it back to fully unpaid.
  await agent.delete(`/api/payments/${first.body.id}`);
  const empty = await agent.get(`/api/invoices/${invoice.id}`);
  assert.equal(empty.body.amountPaid, '0.00');
  assert.equal(empty.body.currentBalance, '10000.00');
  assert.equal(await paymentStatusOf(agent, invoice.id), 'UNPAID');
});

test('tenant isolation: cannot delete another company’s payment', async () => {
  const alice = await registeredOwner('Alice Delete Payment Co');
  const bob = await registeredOwner('Bob Delete Payment Co');
  const aliceCustomer = await createCustomer(alice.agent, 'Alice Payment Customer');

  const alicePayment = await alice.agent.post('/api/payments').send({
    customerId: aliceCustomer,
    amount: '50.00',
    paymentMethod: 'cash',
  });
  assert.equal(alicePayment.status, 201);

  const bobAttempt = await bob.agent.delete(`/api/payments/${alicePayment.body.id}`);
  assert.equal(bobAttempt.status, 404);

  // Confirm Bob's attempt did not affect Alice's payment or ledger.
  const stillThere = await alice.agent.get(`/api/payments/${alicePayment.body.id}`);
  assert.equal(stillThere.status, 200);
  const ledger = await alice.agent.get(`/api/customers/${aliceCustomer}/ledger`);
  assert.equal(ledger.body.balance, '-50.00');
});

test('permissions: staff cannot delete a payment; owner and admin can', async () => {
  const { agent: owner, companyId } = await registeredOwner('Permissions Delete Payment Co');
  const customerId = await createCustomer(owner, 'Perm Payment Customer');
  const staff = await memberAgent(companyId, 'staff');
  const admin = await memberAgent(companyId, 'admin');

  const staffTarget = await owner.post('/api/payments').send({ customerId, amount: '20.00', paymentMethod: 'cash' });
  assert.equal((await staff.delete(`/api/payments/${staffTarget.body.id}`)).status, 403);

  const adminTarget = await owner.post('/api/payments').send({ customerId, amount: '30.00', paymentMethod: 'cash' });
  const adminDelete = await admin.delete(`/api/payments/${adminTarget.body.id}`);
  assert.equal(adminDelete.status, 200);
});

test('audit log: records PAYMENT_DELETED with payment snapshot metadata', async () => {
  const { agent } = await registeredOwner('Audit Delete Payment Co');
  const customerId = await createCustomer(agent, 'Audit Payment Customer');

  const payment = await agent.post('/api/payments').send({
    customerId,
    amount: '88.50',
    date: '2026-03-15',
    paymentMethod: 'cheque',
    reference: 'CHQ-777',
    notes: 'Audit trail check',
  });
  assert.equal(payment.status, 201);

  await agent.delete(`/api/payments/${payment.body.id}`);

  const logs = await agent.get('/api/audit-logs');
  assert.equal(logs.status, 200);

  const deleted = logs.body.find(
    (l: { action: string; entityId: string }) => l.action === 'PAYMENT_DELETED' && l.entityId === payment.body.id,
  );
  assert.ok(deleted, 'expected a PAYMENT_DELETED entry');
  assert.equal(deleted.metadata.customerId, customerId);
  assert.equal(deleted.metadata.amount, '88.50');
  assert.equal(deleted.metadata.date, '2026-03-15');
  assert.equal(deleted.metadata.paymentMethod, 'cheque');
  assert.equal(deleted.metadata.reference, 'CHQ-777');
  assert.equal(deleted.metadata.notes, 'Audit trail check');
});

test('deleting a nonexistent payment returns 404', async () => {
  const { agent } = await registeredOwner('Nonexistent Payment Co');
  const fakeId = '00000000-0000-0000-0000-000000000000';

  const res = await agent.delete(`/api/payments/${fakeId}`);
  assert.equal(res.status, 404);
});

test('requires authentication to delete a payment', async () => {
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const res = await request(app).delete(`/api/payments/${fakeId}`);
  assert.equal(res.status, 401);
});
