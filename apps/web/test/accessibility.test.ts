import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatDocumentTitle } from '../src/lib/use-document-title.js';

// UI/UX-09 Part 12: the one bit of useDocumentTitle that doesn't need a
// DOM — the title string itself — is pulled out as a pure function so
// it's testable without jsdom/RTL (this repo has neither).

test('UI/UX-09: a route title is suffixed with the app name', () => {
  assert.equal(formatDocumentTitle('Invoices'), 'Invoices — Embroidery Billing');
  assert.equal(formatDocumentTitle('INV-001'), 'INV-001 — Embroidery Billing');
});

test('UI/UX-09: an empty title falls back to just the app name', () => {
  assert.equal(formatDocumentTitle(''), 'Embroidery Billing');
});

// UI/UX-09 Part 9: the task explicitly warns not to invent a different
// password rule than the backend actually enforces. This test reads
// both source files directly and fails if they ever drift apart again,
// rather than trusting that a human remembers to keep them in sync.

test('UI/UX-09: the password length shown to a user at registration matches the backend rule exactly', () => {
  const backend = readFileSync(
    new URL('../../api/src/modules/auth/auth.routes.ts', import.meta.url),
    'utf8',
  );
  const backendMatch = backend.match(/requireString\(body,\s*'password',\s*\{\s*min:\s*(\d+)/);
  assert.ok(backendMatch, 'expected to find the backend password min-length rule');
  const backendMin = Number(backendMatch![1]);

  const frontend = readFileSync(
    new URL('../src/features/auth/RegisterForm.tsx', import.meta.url),
    'utf8',
  );
  const frontendMatch = frontend.match(/PASSWORD_MIN_LENGTH\s*=\s*(\d+)/);
  assert.ok(frontendMatch, 'expected to find RegisterForm\'s displayed password min-length constant');
  const frontendMin = Number(frontendMatch![1]);

  assert.equal(frontendMin, backendMin, 'RegisterForm must show the real backend minimum, not an invented one');
});
