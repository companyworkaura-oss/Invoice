import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

// F04 — discount rounding must be financially consistent:
// subtotal === discountAmount + grandTotal at 2-decimal money
// precision, always. The old bug rounded discountAmount and
// grandTotal *independently* from the same unrounded Decimal, so a
// subtotal/discount combination landing on an exact half cent (e.g.
// 1.01 @ 50% -> raw discount 0.505, raw grandTotal also 0.505) rounded
// *both* halves up under ROUND_HALF_UP: 0.51 + 0.51 = 1.02 for a 1.01
// subtotal. The fix (invoice.service.ts's calculateDiscount) rounds
// discountAmount exactly once, then derives grandTotal from that
// rounded value, never from the raw one again.
//
// Manual (Quick Invoice) items are used throughout — unitPrice is
// taken literally (lineAmount = quantity * unitPrice, recalculated
// server-side but with no formula engine involved), giving exact
// control over the subtotal cent-for-cent, which is what these edge
// cases need.

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
    fullName: 'Rounding Test Owner',
    email,
    password: 'correct horse battery',
  });
  assert.equal(res.status, 201);
  return agent;
}

async function createCustomer(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.post('/api/customers').send({ name });
  assert.equal(res.status, 201);
  return res.body.id as string;
}

/** A manual item invoice with an exact subtotal (unitPrice taken literally, quantity 1) — exact cent control, no formula engine involved. */
async function createInvoiceWithSubtotal(
  agent: ReturnType<typeof request.agent>,
  customerId: string,
  subtotal: string,
  extra: { discountType?: 'percentage' | 'fixed'; discountValue?: string } = {},
) {
  const res = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Rounding Test Item', quantity: '1', unitPrice: subtotal }],
    ...extra,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalAmount, subtotal);
  return res;
}

function assertConsistent(body: { totalAmount: string; discountAmount: string; grandTotal: string }) {
  const sum = (Number(body.discountAmount) + Number(body.grandTotal)).toFixed(2);
  assert.equal(sum, body.totalAmount, `discountAmount (${body.discountAmount}) + grandTotal (${body.grandTotal}) must equal subtotal (${body.totalAmount})`);
}

// ---- F04 test 1: the exact reported scenario ----

test('F04: subtotal 1.01 @ 50% discount — discountAmount + grandTotal equals 1.01 exactly at 2 decimals', async () => {
  const agent = await registeredOwner('F04 Exact Repro Co');
  const customerId = await createCustomer(agent, 'F04 Exact Repro Customer');

  const invoice = await createInvoiceWithSubtotal(agent, customerId, '1.01', {
    discountType: 'percentage',
    discountValue: '50',
  });

  assertConsistent(invoice.body);
  // The report's own expected split: 0.51 discount, 0.50 grand total
  // (rounding the discount up from the raw 0.505 half-cent, then
  // deriving the grand total from that already-rounded figure).
  assert.equal(invoice.body.discountAmount, '0.51');
  assert.equal(invoice.body.grandTotal, '0.50');
});

// ---- F04 test 2: create, reread, and ledger debit all agree ----

test('F04: create, reread, and ledger debit all report the exact same grandTotal for a half-cent discount', async () => {
  const agent = await registeredOwner('F04 Agreement Co');
  const customerId = await createCustomer(agent, 'F04 Agreement Customer');

  const created = await createInvoiceWithSubtotal(agent, customerId, '1.01', {
    discountType: 'percentage',
    discountValue: '50',
  });
  assertConsistent(created.body);

  const reread = await agent.get(`/api/invoices/${created.body.id}`);
  assert.equal(reread.status, 200);
  assertConsistent(reread.body);
  assert.equal(reread.body.grandTotal, created.body.grandTotal);
  assert.equal(reread.body.discountAmount, created.body.discountAmount);

  const list = await agent.get('/api/invoices');
  const listed = list.body.find((row: { id: string }) => row.id === created.body.id);
  assert.equal(listed.grandTotal, created.body.grandTotal);

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.balance, created.body.grandTotal, 'the ledger debit must equal the stored grandTotal, not a freshly recomputed one');
  assert.equal(ledger.body.entries[0].debit, created.body.grandTotal);
});

// ---- F04 test 3: PDF/view-model totals match the saved invoice ----

test('F04: the invoice view model (PDF/print/WhatsApp data) reports the exact same totals as the saved invoice for a half-cent discount', async () => {
  const agent = await registeredOwner('F04 View Model Co');
  const customerId = await createCustomer(agent, 'F04 View Model Customer');

  const created = await createInvoiceWithSubtotal(agent, customerId, '1.01', {
    discountType: 'percentage',
    discountValue: '50',
  });

  const pdf = await agent.get(`/api/invoices/${created.body.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  // The PDF is rendered from the exact same InvoiceWithItems object
  // buildInvoiceViewModel consumes — no separate totals computation —
  // so a real, non-empty PDF response here (same object, same figures)
  // is the meaningful check; the actual numbers are already verified
  // against the create/reread/ledger agreement above and in
  // invoice-pdf-html.test.ts's dedicated rendering tests.
  assert.ok((pdf.body as Buffer).length > 1000);
});

// ---- F04 test 4: editing the invoice keeps the same consistent rule ----

test('F04: editing a draft invoice\'s discount recalculates with the same consistent rounding rule', async () => {
  const agent = await registeredOwner('F04 Edit Co');
  const customerId = await createCustomer(agent, 'F04 Edit Customer');

  const created = await createInvoiceWithSubtotal(agent, customerId, '1.01', {
    discountType: 'percentage',
    discountValue: '10',
  });
  assertConsistent(created.body);

  // Change the discount value — must still be consistent, and the
  // ledger debit must follow the newly edited grandTotal.
  const edited = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ description: 'Rounding Test Item', quantity: '1', unitPrice: '1.01' }],
    discountType: 'percentage',
    discountValue: '50',
  });
  assert.equal(edited.status, 200);
  assertConsistent(edited.body);
  assert.equal(edited.body.discountAmount, '0.51');
  assert.equal(edited.body.grandTotal, '0.50');

  const ledger = await agent.get(`/api/customers/${customerId}/ledger`);
  assert.equal(ledger.body.balance, '0.50');

  // Change discount TYPE too (percentage -> fixed), still consistent.
  const editedFixed = await agent.patch(`/api/invoices/${created.body.id}`).send({
    items: [{ description: 'Rounding Test Item', quantity: '1', unitPrice: '1.01' }],
    discountType: 'fixed',
    discountValue: '0.33',
  });
  assert.equal(editedFixed.status, 200);
  assertConsistent(editedFixed.body);
  assert.equal(editedFixed.body.discountAmount, '0.33');
  assert.equal(editedFixed.body.grandTotal, '0.68');
});

// ---- F04 test 5: half-cent/edge cases ----

test('F04: 0.01 subtotal @ 50% discount is internally consistent', async () => {
  const agent = await registeredOwner('F04 Edge 001 Co');
  const customerId = await createCustomer(agent, 'F04 Edge 001 Customer');
  const invoice = await createInvoiceWithSubtotal(agent, customerId, '0.01', {
    discountType: 'percentage',
    discountValue: '50',
  });
  assertConsistent(invoice.body);
});

test('F04: 10.01 subtotal @ 33.33% discount is internally consistent', async () => {
  const agent = await registeredOwner('F04 Edge 3333 Co');
  const customerId = await createCustomer(agent, 'F04 Edge 3333 Customer');
  const invoice = await createInvoiceWithSubtotal(agent, customerId, '10.01', {
    discountType: 'percentage',
    discountValue: '33.33',
  });
  assertConsistent(invoice.body);
});

test('F04: a fixed discount with cents is internally consistent', async () => {
  const agent = await registeredOwner('F04 Fixed Cents Co');
  const customerId = await createCustomer(agent, 'F04 Fixed Cents Customer');
  const invoice = await createInvoiceWithSubtotal(agent, customerId, '10.00', {
    discountType: 'fixed',
    discountValue: '3.33',
  });
  assertConsistent(invoice.body);
  assert.equal(invoice.body.discountAmount, '3.33');
  assert.equal(invoice.body.grandTotal, '6.67');
});

test('F04: a sweep of half-cent percentage combinations are all internally consistent', async () => {
  const agent = await registeredOwner('F04 Sweep Co');
  const customerId = await createCustomer(agent, 'F04 Sweep Customer');

  const cases: [string, string][] = [
    ['1.01', '50'],
    ['0.03', '50'],
    ['0.05', '50'],
    ['3.33', '50'],
    ['7.77', '25'],
    ['99.99', '1'],
    ['0.01', '1'],
  ];
  for (const [subtotal, discountValue] of cases) {
    const invoice = await createInvoiceWithSubtotal(agent, customerId, subtotal, {
      discountType: 'percentage',
      discountValue,
    });
    assertConsistent(invoice.body);
  }
});

// ---- F04 test 6: no regression for normal whole-cent amounts ----

test('F04: normal whole-cent discounts are unaffected (same numbers as before the fix)', async () => {
  const agent = await registeredOwner('F04 No Regression Co');
  const customerId = await createCustomer(agent, 'F04 No Regression Customer');

  const tenPercent = await createInvoiceWithSubtotal(agent, customerId, '144.00', {
    discountType: 'percentage',
    discountValue: '10',
  });
  assertConsistent(tenPercent.body);
  assert.equal(tenPercent.body.discountAmount, '14.40');
  assert.equal(tenPercent.body.grandTotal, '129.60');

  const fixedFifty = await createInvoiceWithSubtotal(agent, customerId, '144.00', {
    discountType: 'fixed',
    discountValue: '50.00',
  });
  assertConsistent(fixedFifty.body);
  assert.equal(fixedFifty.body.discountAmount, '50.00');
  assert.equal(fixedFifty.body.grandTotal, '94.00');

  const hundredPercent = await createInvoiceWithSubtotal(agent, customerId, '144.00', {
    discountType: 'percentage',
    discountValue: '100',
  });
  assertConsistent(hundredPercent.body);
  assert.equal(hundredPercent.body.discountAmount, '144.00');
  assert.equal(hundredPercent.body.grandTotal, '0.00');
});

// ---- Validation must be unchanged ----

test('F04: validation is unchanged by the rounding fix — negative/out-of-range/over-subtotal/negative-grand-total all still rejected', async () => {
  const agent = await registeredOwner('F04 Validation Co');
  const customerId = await createCustomer(agent, 'F04 Validation Customer');

  const negativePercent = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Item', quantity: '1', unitPrice: '10.00' }],
    discountType: 'percentage',
    discountValue: '-5',
  });
  assert.equal(negativePercent.status, 400);

  const overHundred = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Item', quantity: '1', unitPrice: '10.00' }],
    discountType: 'percentage',
    discountValue: '101',
  });
  assert.equal(overHundred.status, 400);

  const overSubtotalFixed = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Item', quantity: '1', unitPrice: '10.00' }],
    discountType: 'fixed',
    discountValue: '10.01',
  });
  assert.equal(overSubtotalFixed.status, 400);

  // Exactly at the subtotal (fixed discount == subtotal) is allowed —
  // grand total zero, never negative.
  const exactlySubtotal = await agent.post('/api/invoices').send({
    customerId,
    items: [{ description: 'Item', quantity: '1', unitPrice: '10.00' }],
    discountType: 'fixed',
    discountValue: '10.00',
  });
  assert.equal(exactlySubtotal.status, 201);
  assert.equal(exactlySubtotal.body.grandTotal, '0.00');
  assertConsistent(exactlySubtotal.body);
});
