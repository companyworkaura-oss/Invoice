import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getLastInvoiceMode, setLastInvoiceMode } from '../src/features/invoices/last-invoice-mode.js';

// UI/UX-02: remembers which of "Quick Invoice" / "New invoice" the
// user picked last, purely so the entry buttons can give that one
// slightly more visual weight next time — never a new preference
// system, just one localStorage key. node:test runs in plain Node,
// which has no `localStorage` global at all; a stand-in is installed
// per test so the real get/set round trip is exercised, and removed
// afterward so other test files are unaffected.

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

test('UI/UX-02: with nothing stored yet, returns the given fallback', () => {
  assert.equal(getLastInvoiceMode('standard'), 'standard');
  assert.equal(getLastInvoiceMode('quick'), 'quick');
});

test('UI/UX-02: setLastInvoiceMode persists, and getLastInvoiceMode reads it back', () => {
  setLastInvoiceMode('quick');
  assert.equal(getLastInvoiceMode(), 'quick');

  setLastInvoiceMode('standard');
  assert.equal(getLastInvoiceMode(), 'standard');
});

test('UI/UX-02: a corrupted/unexpected stored value falls back rather than being trusted as-is', () => {
  localStorage.setItem('invoices:lastEntryMode', 'something-unexpected');
  assert.equal(getLastInvoiceMode('standard'), 'standard');
});

test('UI/UX-02: never throws when localStorage is unavailable (private window, blocked storage, or no browser at all)', () => {
  removeFakeLocalStorage();
  assert.doesNotThrow(() => getLastInvoiceMode());
  assert.doesNotThrow(() => setLastInvoiceMode('quick'));
  assert.equal(getLastInvoiceMode('standard'), 'standard', 'falls back cleanly with no localStorage at all');
});
