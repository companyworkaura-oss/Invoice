import type { Customer, CustomerStatus } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as customersApi from './api';

interface Props {
  onSelect: (customer: Customer) => void;
  refreshToken: number;
}

type StatusFilter = CustomerStatus | 'all';

export function CustomerList({ onSelect, refreshToken }: Props) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');

  useEffect(() => {
    const handle = setTimeout(() => {
      customersApi
        .listCustomers({ search: search || undefined, status })
        .then(setCustomers)
        .catch(() => setCustomers([]));
    }, 200); // debounce search-as-you-type
    return () => clearTimeout(handle);
  }, [search, status, refreshToken]);

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search name, business, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      {customers === null ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No customers found.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {customers.map((c) => (
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
    </div>
  );
}
