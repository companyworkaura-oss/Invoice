import type { Customer, CustomerStatus } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, InlineErrorBanner, LoadingState, UpdatingIndicator } from '../../lib/AsyncState';
import { deriveListViewState } from '../../lib/list-view-state';
import { useAsyncList } from '../../lib/use-async-list';
import * as customersApi from './api';

interface Props {
  onSelect: (customer: Customer) => void;
  onAddCustomer: () => void;
  refreshToken: number;
}

type StatusFilter = CustomerStatus | 'all';

const DEFAULT_STATUS: StatusFilter = 'active';

export function CustomerList({ onSelect, onAddCustomer, refreshToken }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>(DEFAULT_STATUS);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // 200ms debounce, same as before — delays the *fetch*, not the input itself.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handle);
  }, [search]);

  const { data: customers, isFetching, error, retry } = useAsyncList(
    () => customersApi.listCustomers({ search: debouncedSearch || undefined, status }),
    [debouncedSearch, status, refreshToken],
    'Could not load customers.',
  );

  const hasActiveFilter = debouncedSearch.trim() !== '' || status !== DEFAULT_STATUS;
  const viewState = deriveListViewState(customers, error, hasActiveFilter);

  function clearFilters() {
    setSearch('');
    setStatus(DEFAULT_STATUS);
  }

  return (
    <div>
      <div className="flex gap-2">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <input
          id="customer-search"
          type="search"
          placeholder="Search name, business, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <label htmlFor="customer-status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="customer-status-filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="mt-3">
        {viewState.kind === 'loading' && <LoadingState label="Loading customers…" />}
        {viewState.kind === 'error' && <ErrorState message={viewState.message} onRetry={retry} />}

        {(viewState.kind === 'empty' || viewState.kind === 'no-match' || viewState.kind === 'ready') && (
          <>
            {isFetching && <UpdatingIndicator />}
            {!isFetching && error && <InlineErrorBanner message={error} onRetry={retry} />}

            {viewState.kind === 'no-match' ? (
              <EmptyState message="No matching customers." actionLabel="Clear filters" onAction={clearFilters} />
            ) : viewState.kind === 'empty' ? (
              <EmptyState message="No customers yet." actionLabel="Add customer" onAction={onAddCustomer} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {viewState.items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c)}
                      className="flex w-full items-center justify-between py-2 text-left hover:bg-slate-50"
                    >
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{c.name}</span>
                        <span className="block text-xs text-slate-500">
                          {c.businessName ?? c.phone ?? '—'}
                          {c.status === 'archived' ? ' · archived' : ''}
                        </span>
                      </span>
                      <span className="text-xs text-slate-400">{c.openingBalance}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
