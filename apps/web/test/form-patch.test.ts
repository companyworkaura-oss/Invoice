import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFormPatch } from '../src/lib/form-patch.js';

// F08/F12: the frontend used to omit any blank field from the patch,
// unable to tell "still blank because nobody touched it" apart from
// "the user just cleared it" — so a field could never actually be
// cleared. buildFormPatch diffs against the original snapshot
// instead, so these are the cases that distinction depends on. Shared
// by CompanyProfileForm (F08) and CustomerForm (F12) — generic, so
// these tests exercise it standalone rather than through either form.

test('an untouched field (blank in both form and original) is omitted', () => {
  const original = { phone: '', address: '' };
  const form = { phone: '', address: '' };
  assert.deepEqual(buildFormPatch(form, original), {});
});

test('an untouched field with an existing value is omitted', () => {
  const original = { phone: '+1 555 0100', address: '12 Thread St' };
  const form = { phone: '+1 555 0100', address: '12 Thread St' };
  assert.deepEqual(buildFormPatch(form, original), {});
});

test('clearing a field that had a value sends an explicit null', () => {
  const original = { phone: '+1 555 0100', address: '12 Thread St' };
  const form = { phone: '', address: '12 Thread St' };
  assert.deepEqual(buildFormPatch(form, original), { phone: null });
});

test('changing a field to a new non-blank value sends that value', () => {
  const original = { phone: '+1 555 0100' };
  const form = { phone: '+1 555 0199' };
  assert.deepEqual(buildFormPatch(form, original), { phone: '+1 555 0199' });
});

test('typing into a field that was blank sends the new value, not null', () => {
  const original = { phone: '' };
  const form = { phone: '+1 555 0100' };
  assert.deepEqual(buildFormPatch(form, original), { phone: '+1 555 0100' });
});

test('clearing one field does not pull in sibling untouched fields', () => {
  const original = { phone: '+1 555 0100', ownerName: 'Priya Shah', email: 'a@b.com' };
  const form = { phone: '', ownerName: 'Priya Shah', email: 'a@b.com' };
  assert.deepEqual(buildFormPatch(form, original), { phone: null });
});

test('whitespace-only input is treated the same as fully blank (an explicit clear)', () => {
  const original = { address: '12 Thread St' };
  const form = { address: '   ' };
  assert.deepEqual(buildFormPatch(form, original), { address: null });
});

// ---- F12: the same helper used for Customer fields (businessName/phone/whatsapp/address/notes) ----

test('F12: clearing a customer field that had a value sends an explicit null', () => {
  const original = { phone: '555-1234', whatsapp: '9876543210', address: '123 Main St' };
  const form = { phone: '', whatsapp: '9876543210', address: '123 Main St' };
  assert.deepEqual(buildFormPatch(form, original), { phone: null });
});

test('F12: clearing multiple customer fields at once sends null for each', () => {
  const original = { phone: '555-1234', whatsapp: '9876543210', address: '123 Main St' };
  const form = { phone: '', whatsapp: '', address: '' };
  assert.deepEqual(buildFormPatch(form, original), { phone: null, whatsapp: null, address: null });
});

test('F12: leaving email/name untouched while clearing address does not send name', () => {
  const original = { name: 'Jane Doe', address: '123 Main St' };
  const form = { name: 'Jane Doe', address: '' };
  assert.deepEqual(buildFormPatch(form, original), { address: null });
});
