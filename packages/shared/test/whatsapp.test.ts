import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInvoiceWhatsAppMessage,
  buildWhatsAppClickToChatUrl,
  normalizeWhatsAppPhone,
} from '../src/whatsapp.js';

test('buildInvoiceWhatsAppMessage includes all required fields', () => {
  const message = buildInvoiceWhatsAppMessage({
    customerName: 'Jane Doe',
    invoiceNumber: 'INV-0007',
    invoiceAmount: '150.00',
    previousBalance: '50.00',
    amountPaid: '20.00',
    currentBalance: '180.00',
    companyName: 'Acme Embroidery',
  });

  assert.match(message, /Jane Doe/);
  assert.match(message, /Acme Embroidery/);
  assert.match(message, /INV-0007/);
  assert.match(message, /150\.00/);
  assert.match(message, /50\.00/);
  assert.match(message, /20\.00/);
  assert.match(message, /180\.00/);
});

test('buildInvoiceWhatsAppMessage falls back to a generic greeting without a company name', () => {
  const message = buildInvoiceWhatsAppMessage({
    customerName: 'Jane Doe',
    invoiceNumber: 'INV-0007',
    invoiceAmount: '150.00',
    previousBalance: '0.00',
    amountPaid: '0.00',
    currentBalance: '150.00',
  });

  assert.match(message, /Here is your invoice\./);
});

test('normalizeWhatsAppPhone strips everything but digits', () => {
  assert.equal(normalizeWhatsAppPhone('+1 (415) 555-2671'), '14155552671');
  assert.equal(normalizeWhatsAppPhone('91-98765-43210'), '919876543210');
  assert.equal(normalizeWhatsAppPhone('9876543210'), '9876543210');
});

test('buildWhatsAppClickToChatUrl builds a wa.me link with an encoded message', () => {
  const url = buildWhatsAppClickToChatUrl('+1 415 555 2671', 'Hi there\nLine two');
  assert.equal(url, `https://wa.me/14155552671?text=${encodeURIComponent('Hi there\nLine two')}`);
});
