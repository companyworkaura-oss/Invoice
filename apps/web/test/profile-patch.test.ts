import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProfilePatch } from '../src/features/company/profile-patch.js';

// F08: the frontend used to omit any blank field from the patch,
// unable to tell "still blank because nobody touched it" apart from
// "the user just cleared it" — so a field could never actually be
// cleared. buildProfilePatch diffs against the original snapshot
// instead, so these are the cases that distinction depends on.

test('F08: an untouched field (blank in both form and original) is omitted', () => {
  const original = { phone: '', address: '' };
  const form = { phone: '', address: '' };
  assert.deepEqual(buildProfilePatch(form, original), {});
});

test('F08: an untouched field with an existing value is omitted', () => {
  const original = { phone: '+1 555 0100', address: '12 Thread St' };
  const form = { phone: '+1 555 0100', address: '12 Thread St' };
  assert.deepEqual(buildProfilePatch(form, original), {});
});

test('F08: clearing a field that had a value sends an explicit null', () => {
  const original = { phone: '+1 555 0100', address: '12 Thread St' };
  const form = { phone: '', address: '12 Thread St' };
  assert.deepEqual(buildProfilePatch(form, original), { phone: null });
});

test('F08: changing a field to a new non-blank value sends that value', () => {
  const original = { phone: '+1 555 0100' };
  const form = { phone: '+1 555 0199' };
  assert.deepEqual(buildProfilePatch(form, original), { phone: '+1 555 0199' });
});

test('F08: typing into a field that was blank sends the new value, not null', () => {
  const original = { phone: '' };
  const form = { phone: '+1 555 0100' };
  assert.deepEqual(buildProfilePatch(form, original), { phone: '+1 555 0100' });
});

test('F08: clearing one field does not pull in sibling untouched fields', () => {
  const original = { phone: '+1 555 0100', ownerName: 'Priya Shah', email: 'a@b.com' };
  const form = { phone: '', ownerName: 'Priya Shah', email: 'a@b.com' };
  assert.deepEqual(buildProfilePatch(form, original), { phone: null });
});

test('F08: whitespace-only input is treated the same as fully blank (an explicit clear)', () => {
  const original = { address: '12 Thread St' };
  const form = { address: '   ' };
  assert.deepEqual(buildProfilePatch(form, original), { address: null });
});
