import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { clearInvoiceDraft, loadInvoiceDraft, saveInvoiceDraft } from '../src/features/invoices/invoice-draft.js';

// UI/UX-03 Part 4/5/9/10: a recoverable localStorage draft for one
// user/company/invoice-mode combination. node:test runs in plain
// Node, which has no `localStorage` global at all; a tiny in-memory
// stand-in is installed per test (and removed afterward, so other
// test files are unaffected) to exercise the real save/load/clear
// round trip rather than just the "never throws" fallback paths.

function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: () => null,
  } as Storage;
}

function removeFakeLocalStorage(): void {
  delete (globalThis as { localStorage?: Storage }).localStorage;
}

beforeEach(installFakeLocalStorage);
afterEach(removeFakeLocalStorage);

test('UI/UX-03: with nothing saved yet, loadInvoiceDraft returns null', () => {
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'standard'), null);
});

test('UI/UX-03: saveInvoiceDraft persists, and loadInvoiceDraft reads it back with a version and timestamp', () => {
  saveInvoiceDraft('user-1', 'company-1', 'standard', { customerId: 'cust-1', items: [] });
  const loaded = loadInvoiceDraft<{ customerId: string; items: unknown[] }>('user-1', 'company-1', 'standard');
  assert.ok(loaded);
  assert.equal(loaded.version, 1);
  assert.equal(typeof loaded.savedAt, 'string');
  assert.deepEqual(loaded.data, { customerId: 'cust-1', items: [] });
});

test('UI/UX-03: clearInvoiceDraft removes it — a later load returns null', () => {
  saveInvoiceDraft('user-1', 'company-1', 'standard', { customerId: 'cust-1' });
  clearInvoiceDraft('user-1', 'company-1', 'standard');
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'standard'), null);
});

// ---- UI/UX-03 Part 5: Quick and Standard drafts are separate ----

test('UI/UX-03: a Standard draft and a Quick draft for the same user/company never collide', () => {
  saveInvoiceDraft('user-1', 'company-1', 'standard', { kind: 'standard-data' });
  saveInvoiceDraft('user-1', 'company-1', 'quick', { kind: 'quick-data' });

  assert.deepEqual(loadInvoiceDraft('user-1', 'company-1', 'standard')?.data, { kind: 'standard-data' });
  assert.deepEqual(loadInvoiceDraft('user-1', 'company-1', 'quick')?.data, { kind: 'quick-data' });

  clearInvoiceDraft('user-1', 'company-1', 'quick');
  assert.deepEqual(loadInvoiceDraft('user-1', 'company-1', 'standard')?.data, { kind: 'standard-data' }, 'clearing one mode never touches the other');
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'quick'), null);
});

// ---- UI/UX-03 Part 9: company isolation ----

test('UI/UX-03: a draft saved under one company never appears under another, same user', () => {
  saveInvoiceDraft('user-1', 'company-A', 'standard', { note: 'company A draft' });
  assert.equal(loadInvoiceDraft('user-1', 'company-B', 'standard'), null, 'Company A draft must not appear in Company B');

  saveInvoiceDraft('user-1', 'company-B', 'standard', { note: 'company B draft' });
  assert.deepEqual(loadInvoiceDraft('user-1', 'company-A', 'standard')?.data, { note: 'company A draft' }, 'Company A draft is still intact');
  assert.deepEqual(loadInvoiceDraft('user-1', 'company-B', 'standard')?.data, { note: 'company B draft' });
});

test('UI/UX-03: a draft saved under one user never appears under another, same company', () => {
  saveInvoiceDraft('user-1', 'company-1', 'standard', { note: 'user 1 draft' });
  assert.equal(loadInvoiceDraft('user-2', 'company-1', 'standard'), null);
});

// ---- Corruption / schema-version safety ----

test('UI/UX-03: a corrupted (non-JSON) stored value is treated as no draft, not a crash', () => {
  localStorage.setItem('invoice-draft:user-1:company-1:standard', 'not valid json {{{');
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'standard'), null);
});

test('UI/UX-03: a draft from a future/different schema version is ignored, not misread', () => {
  localStorage.setItem(
    'invoice-draft:user-1:company-1:standard',
    JSON.stringify({ version: 2, savedAt: new Date().toISOString(), data: { customerId: 'x' } }),
  );
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'standard'), null);
});

test('UI/UX-03: never throws when localStorage is unavailable (private window, blocked storage, or no browser at all)', () => {
  removeFakeLocalStorage();
  assert.doesNotThrow(() => saveInvoiceDraft('user-1', 'company-1', 'standard', { a: 1 }));
  assert.doesNotThrow(() => clearInvoiceDraft('user-1', 'company-1', 'standard'));
  assert.equal(loadInvoiceDraft('user-1', 'company-1', 'standard'), null);
});
