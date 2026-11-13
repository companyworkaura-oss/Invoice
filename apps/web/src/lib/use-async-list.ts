import { useEffect, useRef, useState } from 'react';

/**
 * UI/UX-04: a list-fetching effect that never collapses "the request
 * failed" into the same empty array as "the request succeeded with zero
 * rows" or "nothing matches the current filters" — those three are
 * always distinguishable by the caller:
 *
 *   - `data === null && isFetching`       → first load, nothing to show yet
 *   - `data === null && error`            → first load failed, nothing to show
 *   - `data !== null && isFetching`       → a refetch is in flight; previous
 *                                           rows (if any) are still in `data`
 *   - `data !== null && error`            → a refetch failed; `data` still
 *                                           holds the last successfully
 *                                           loaded rows, so the caller can
 *                                           keep them visible rather than
 *                                           blanking the screen
 *   - `data !== null && !error`           → the last fetch succeeded; an
 *                                           empty array here is a genuine
 *                                           "zero rows" response — whether
 *                                           that means truly-empty or
 *                                           no-filter-matches is up to the
 *                                           caller (it owns the filter
 *                                           state, this hook doesn't).
 *
 * `fetcher` is called once per change of any value in `deps`, and again
 * whenever `retry()` is called. It is never called concurrently with
 * itself for the same hook instance — only the most recent call's result
 * is ever applied.
 */
/** A stable, shared empty array — use as the `data ?? EMPTY_LIST` fallback so a `null` state doesn't produce a fresh array reference every render (which would otherwise bust memoization downstream). */
export const EMPTY_LIST: readonly never[] = [];

export interface AsyncListState<T> {
  data: T[] | null;
  isFetching: boolean;
  error: string | null;
  retry: () => void;
}

export function useAsyncList<T>(fetcher: () => Promise<T[]>, deps: unknown[], errorMessage: string): AsyncListState<T> {
  return useAsyncValue(fetcher, deps, errorMessage);
}

/**
 * Same loading/refetching/error/retry state machine as useAsyncList,
 * for a fetch that resolves to one value rather than an array (e.g.
 * the Dashboard's single summary object) — same five-state
 * reasoning in this module's doc comment above applies, just without
 * "zero rows" being a meaningful concept for a single value.
 */
export interface AsyncDataState<T> {
  data: T | null;
  isFetching: boolean;
  error: string | null;
  retry: () => void;
}

export function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[], errorMessage: string): AsyncDataState<T> {
  return useAsyncValue(fetcher, deps, errorMessage);
}

function useAsyncValue<T>(fetcher: () => Promise<T>, deps: unknown[], errorMessage: string): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  // Always the latest fetcher, read from inside the effect below — so a
  // caller's inline closure can change every render without re-running
  // the effect for a reason unrelated to its actual `deps`.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError(errorMessage);
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // deps is caller-controlled and intentionally spread here — retryToken
    // is the only value this hook owns itself.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryToken, errorMessage]);

  return {
    data,
    isFetching,
    error,
    retry: () => setRetryToken((t) => t + 1),
  };
}
