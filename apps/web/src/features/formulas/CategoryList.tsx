import type { EmbroideryCategory } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { EmptyState, ErrorState, InlineErrorBanner, LoadingState, UpdatingIndicator } from '../../lib/AsyncState';
import { useAsyncList } from '../../lib/use-async-list';
import * as categoriesApi from './api';

interface Props {
  onSelect: (category: EmbroideryCategory) => void;
  onAddCategory?: () => void;
  refreshToken: number;
}

const DEFAULT_STATUS: categoriesApi.StatusFilter = 'active';

export function CategoryList({ onSelect, onAddCategory, refreshToken }: Props) {
  const [status, setStatus] = useState<categoriesApi.StatusFilter>(DEFAULT_STATUS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<EmbroideryCategory[] | null>(null);

  const { data: fetchedCategories, isFetching, error, retry } = useAsyncList(
    () => categoriesApi.listCategories(status),
    [status, refreshToken],
    'Could not load categories.',
  );
  // toggle() below applies an optimistic update on top of the last
  // fetched list without waiting for a refetch — reset whenever a fresh
  // fetch actually lands. Tracked via a "last seen" state comparison
  // (same reset-on-change pattern PaymentsPage uses for
  // initialCustomerId) rather than an effect, so this settles within
  // the render the new fetch result arrives in.
  const [lastSeenFetched, setLastSeenFetched] = useState(fetchedCategories);
  if (lastSeenFetched !== fetchedCategories) {
    setLastSeenFetched(fetchedCategories);
    setLocalCategories(null);
  }
  const categories = localCategories ?? fetchedCategories;

  async function toggle(category: EmbroideryCategory) {
    setBusyId(category.id);
    try {
      const updated = category.active
        ? await categoriesApi.disableCategory(category.id)
        : await categoriesApi.enableCategory(category.id);
      setLocalCategories(
        (categories ?? [])
          .map((c) => (c.id === updated.id ? updated : c))
          .filter((c) => matchesFilter(c, status)),
      );
    } catch (err) {
      if (err instanceof ApiError) window.alert(err.body.error);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex justify-end">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as categoriesApi.StatusFilter)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="all">All</option>
        </select>
      </div>

      {categories === null ? (
        error ? (
          <ErrorState message={error} onRetry={retry} />
        ) : (
          <LoadingState label="Loading categories…" />
        )
      ) : (
        <>
          {isFetching && <UpdatingIndicator />}
          {!isFetching && error && <InlineErrorBanner message={error} onRetry={retry} />}

          {categories.length === 0 ? (
            status !== DEFAULT_STATUS ? (
              <EmptyState message="No matching categories." actionLabel="Clear filters" onAction={() => setStatus(DEFAULT_STATUS)} />
            ) : (
              <EmptyState message="No categories yet." actionLabel={onAddCategory ? 'Add category' : undefined} onAction={onAddCategory} />
            )
          ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <button type="button" onClick={() => onSelect(c)} className="flex-1 text-left hover:underline">
                <span className="block text-sm font-medium text-slate-900">
                  {c.name}
                  {!c.active && <span className="ml-2 text-xs font-normal text-slate-400">(disabled)</span>}
                </span>
                <span className="block text-xs text-slate-500">
                  {c.defaultRate} · {c.formulaType}
                </span>
              </button>
              <button
                type="button"
                disabled={busyId === c.id}
                onClick={() => toggle(c)}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {c.active ? 'Disable' : 'Enable'}
              </button>
            </li>
          ))}
        </ul>
          )}
        </>
      )}
    </div>
  );
}

function matchesFilter(c: EmbroideryCategory, status: categoriesApi.StatusFilter): boolean {
  if (status === 'all') return true;
  return status === 'active' ? c.active : !c.active;
}
