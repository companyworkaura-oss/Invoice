/**
 * UI/UX-04: the pure decision behind which of the five list states a
 * screen should show, given what useAsyncList reports plus whether the
 * caller currently has an active filter. Kept separate from useAsyncList
 * itself (and from any one screen) purely so it's unit-testable without a
 * React renderer — this repo has no component-test runner, only plain
 * node:test over pure functions (see invoice-list-filters.ts,
 * create-invoice-payload.ts for the same pattern).
 *
 * `isFetching` is deliberately not an input: a screen renders 'ready'
 * (with whatever rows it has) the moment `data` is non-null, and layers
 * its own "Updating…"/inline-error-banner on top while a refetch is in
 * flight — collapsing that into this function would stop a caller from
 * keeping previous rows visible during a refresh, which is exactly the
 * behavior UI/UX-04 asks for.
 */
export type ListViewState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'ready'; items: T[] };

export function deriveListViewState<T>(data: T[] | null, error: string | null, hasActiveFilter: boolean): ListViewState<T> {
  if (data === null) {
    return error ? { kind: 'error', message: error } : { kind: 'loading' };
  }
  if (data.length === 0) {
    return hasActiveFilter ? { kind: 'no-match' } : { kind: 'empty' };
  }
  return { kind: 'ready', items: data };
}
