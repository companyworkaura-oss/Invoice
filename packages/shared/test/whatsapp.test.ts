import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInvoiceWhatsAppMessage,
  buildWhatsAppClickToChatUrl,
  isValidWhatsAppPhone,
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

test('buildInvoiceWhatsAppMessage falls back to a generic "is ready" line without a company name', () => {
  const message = buildInvoiceWhatsAppMessage({
    customerName: 'Jane Doe',
    invoiceNumber: 'INV-0007',
    invoiceAmount: '150.00',
    previousBalance: '0.00',
    amountPaid: '0.00',
    currentBalance: '150.00',
  });

  assert.match(message, /Your invoice INV-0007 is ready\./);
  assert.ok(!message.includes(' from '), 'no "from <company>" clause when companyName is omitted');
});

test('buildInvoiceWhatsAppMessage includes a PDF link line only when pdfUrl is given', () => {
  const withLink = buildInvoiceWhatsAppMessage({
    customerName: 'Jane Doe',
    invoiceNumber: 'INV-0007',
    invoiceAmount: '150.00',
    previousBalance: '0.00',
    amountPaid: '0.00',
    currentBalance: '150.00',
    pdfUrl: 'https://invoices.example.com/api/invoices/abc/pdf',
  });
  assert.match(withLink, /PDF invoice: https:\/\/invoices\.example\.com\/api\/invoices\/abc\/pdf/);

  const withoutLink = buildInvoiceWhatsAppMessage({
    customerName: 'Jane Doe',
    invoiceNumber: 'INV-0007',
    invoiceAmount: '150.00',
    previousBalance: '0.00',
    amountPaid: '0.00',
    currentBalance: '150.00',
  });
  assert.ok(!withoutLink.includes('PDF invoice:'), 'no PDF link line at all when pdfUrl is omitted');
});

test('normalizeWhatsAppPhone strips spaces, dashes, brackets, and a leading +', () => {
  assert.equal(normalizeWhatsAppPhone('+1 (415) 555-2671'), '14155552671');
  assert.equal(normalizeWhatsAppPhone('91-98765-43210'), '919876543210');
  assert.equal(normalizeWhatsAppPhone('9876543210'), '9876543210');
});

test('normalizeWhatsAppPhone converts a Pakistani local number to international format', () => {
  assert.equal(normalizeWhatsAppPhone('03001234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhone('0300 123 4567'), '923001234567');
  assert.equal(normalizeWhatsAppPhone('0300-123-4567'), '923001234567');
});

test('normalizeWhatsAppPhone leaves an already-international Pakistani number unchanged', () => {
  assert.equal(normalizeWhatsAppPhone('+923001234567'), '923001234567');
  assert.equal(normalizeWhatsAppPhone('923001234567'), '923001234567');
});

test('isValidWhatsAppPhone accepts a believable normalized number and rejects junk', () => {
  assert.equal(isValidWhatsAppPhone('923001234567'), true);
  assert.equal(isValidWhatsAppPhone('14155552671'), true);
  assert.equal(isValidWhatsAppPhone(''), false); // missing entirely
  assert.equal(isValidWhatsAppPhone('123'), false); // too short to be a real number
  assert.equal(isValidWhatsAppPhone('1234567890123456'), false); // too long
});

test('buildWhatsAppClickToChatUrl builds a wa.me link with an encoded message', () => {
  const url = buildWhatsAppClickToChatUrl('+1 415 555 2671', 'Hi there\nLine two');
  assert.equal(url, `https://wa.me/14155552671?text=${encodeURIComponent('Hi there\nLine two')}`);
});

test('buildWhatsAppClickToChatUrl normalizes a Pakistani local number the same way', () => {
  const url = buildWhatsAppClickToChatUrl('03001234567', 'Hello');
  assert.ok(url.startsWith('https://wa.me/923001234567?text='));
});
