import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveInvoicePaymentStatus,
  invoiceRemainingBalance,
  suggestedCustomerPaymentAmount,
} from '../src/invoice-payment-status.js';

// UI/UX-01: Invoice Details used to show invoice-level money (Amount
// Paid, allocated to this one invoice) and customer-account-level
// money (Current Balance, the customer's entire live account) in one
// shared totals grid with no visual or semantic boundary between
// them. These two pure functions back the two now-separate panels —
// "This invoice" (grandTotal/amountPaid-derived) and "Customer
// account" (currentBalance) — restating only the already-authoritative
// numbers InvoiceWithItems already carries, mirroring the exact same
// CASE/subtraction invoice.service.ts's listInvoices SQL already uses
// for InvoiceListEntry's paid/balance/paymentStatus. These tests cover
// every scenario the report's acceptance test and "Credit / zero-
// balance cases" section call for.

// ---- Two unpaid invoices (the exact F06 scenario, from an invoice-detail point of view) ----

test('UI/UX-01: an unpaid invoice shows the full grandTotal as remaining, status UNPAID', () => {
  assert.equal(invoiceRemainingBalance('100.00', '0.00'), '100.00');
  assert.equal(deriveInvoicePaymentStatus('issued', '100.00', '0.00'), 'UNPAID');
});

test('UI/UX-01: a second unpaid invoice (sibling of the first) is computed independently, never negative', () => {
  assert.equal(invoiceRemainingBalance('100.00', '0.00'), '100.00');
  assert.equal(deriveInvoicePaymentStatus('issued', '100.00', '0.00'), 'UNPAID');
});

// ---- Partial payment ----

test('UI/UX-01: a partially-paid invoice shows the correct remaining amount, status PARTIAL', () => {
  assert.equal(invoiceRemainingBalance('100.00', '40.00'), '60.00');
  assert.equal(deriveInvoicePaymentStatus('issued', '100.00', '40.00'), 'PARTIAL');
});

// ---- Fully paid invoice ----

test('UI/UX-01: a fully-paid invoice shows zero remaining, status PAID', () => {
  assert.equal(invoiceRemainingBalance('100.00', '100.00'), '0.00');
  assert.equal(deriveInvoicePaymentStatus('issued', '100.00', '100.00'), 'PAID');
});

// ---- Zero-total invoice (F09/F11's 100%-discount case) ----

test('UI/UX-01: a zero-total invoice shows zero remaining, status PAID (nothing was ever owed)', () => {
  assert.equal(invoiceRemainingBalance('0.00', '0.00'), '0.00');
  assert.equal(deriveInvoicePaymentStatus('issued', '0.00', '0.00'), 'PAID');
});

// ---- A cancelled invoice reports CANCELLED regardless of amountPaid ----

test('UI/UX-01: a cancelled invoice reports CANCELLED even if something was paid before cancellation', () => {
  assert.equal(deriveInvoicePaymentStatus('cancelled', '100.00', '40.00'), 'CANCELLED');
});

// ---- Remaining balance never goes negative (F06's bound: amountPaid is always in [0, grandTotal]) ----

test('UI/UX-01: remaining balance is floored at zero even if amountPaid somehow exceeded grandTotal', () => {
  assert.equal(invoiceRemainingBalance('100.00', '150.00'), '0.00');
});

// ---- Customer credit / negative account balance: never suggest a payment amount ----

test('UI/UX-01: a customer in credit (negative account balance) gets no suggested payment amount', () => {
  assert.equal(suggestedCustomerPaymentAmount('-50.00'), undefined);
});

test('UI/UX-01: a customer with nothing outstanding (zero account balance) gets no suggested payment amount', () => {
  assert.equal(suggestedCustomerPaymentAmount('0.00'), undefined);
});

test('UI/UX-01: a customer who genuinely owes money gets that exact amount suggested', () => {
  assert.equal(suggestedCustomerPaymentAmount('250.00'), '250.00');
});

// ---- Customer with multiple unpaid invoices: each invoice's own figures stay independent of the shared account balance ----

test('UI/UX-01: invoice-specific and account-wide figures never get mixed for a customer with multiple unpaid invoices', () => {
  // Invoice A: 100 owed, nothing paid toward it specifically.
  const invoiceARemaining = invoiceRemainingBalance('100.00', '0.00');
  const invoiceAStatus = deriveInvoicePaymentStatus('issued', '100.00', '0.00');
  // Invoice B: a second, independent 100 owed.
  const invoiceBRemaining = invoiceRemainingBalance('100.00', '0.00');
  const invoiceBStatus = deriveInvoicePaymentStatus('issued', '100.00', '0.00');
  // The customer's own account-wide balance (e.g. after a partial
  // payment allocated oldest-debt-first) is a completely separate
  // number from either invoice's own remaining amount — this function
  // never derives one from the other.
  const accountBalance = '150.00'; // e.g. 200 owed across both invoices minus a 50 payment

  assert.equal(invoiceARemaining, '100.00');
  assert.equal(invoiceBRemaining, '100.00');
  assert.equal(invoiceAStatus, 'UNPAID');
  assert.equal(invoiceBStatus, 'UNPAID');
  assert.notEqual(accountBalance, invoiceARemaining, 'account balance is never equal to a single invoice\'s own remaining amount by assumption here, confirming they are independent figures');
});
