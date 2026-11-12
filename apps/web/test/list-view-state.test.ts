import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveListViewState } from '../src/lib/list-view-state.js';

// UI/UX-04: deriveListViewState is the pure decision behind the five
// list states (loading / refreshing / load-failed / truly-empty /
// no-filter-matches) — "refreshing" isn't one of its outputs (see its
// own doc comment), but the other four are, and this is what must never
// let "request failed" collapse into the same bucket as "zero rows,
// genuinely".

test('UI/UX-04: no data yet and no error is loading', () => {
  assert.deepEqual(deriveListViewState(null, null, false), { kind: 'loading' });
});

test('UI/UX-04: no data yet and an error is the error state, never "empty"', () => {
  assert.deepEqual(deriveListViewState(null, 'Could not load customers.', false), {
    kind: 'error',
    message: 'Could not load customers.',
  });
});

test('UI/UX-04: a successful zero-row response with no active filter is truly empty', () => {
  assert.deepEqual(deriveListViewState([], null, false), { kind: 'empty' });
});

test('UI/UX-04: a successful zero-row response with an active filter is "no match", not "empty"', () => {
  assert.deepEqual(deriveListViewState([], null, true), { kind: 'no-match' });
});

test('UI/UX-04: a non-empty response is ready, regardless of filter state', () => {
  assert.deepEqual(deriveListViewState([1, 2, 3], null, true), { kind: 'ready', items: [1, 2, 3] });
  assert.deepEqual(deriveListViewState(['a'], null, false), { kind: 'ready', items: ['a'] });
});

test('UI/UX-04: an error never wins over already-loaded rows — a refetch failure keeps showing "ready"', () => {
  // This is the "keep existing rows visible on a failed refresh" case:
  // once data has successfully loaded once, a subsequent error (while
  // data is still non-null) must not blank the screen back to the error
  // panel — the caller renders its own non-destructive inline banner on
  // top of 'ready' instead (see CustomerList.tsx/PaymentsPage.tsx).
  assert.deepEqual(deriveListViewState([1], 'Could not refresh.', false), { kind: 'ready', items: [1] });
});

test('UI/UX-04: a retry that succeeds with previously-zero rows still distinguishes empty vs no-match correctly', () => {
  assert.deepEqual(deriveListViewState([], null, false), { kind: 'empty' });
  assert.deepEqual(deriveListViewState([], null, true), { kind: 'no-match' });
});
