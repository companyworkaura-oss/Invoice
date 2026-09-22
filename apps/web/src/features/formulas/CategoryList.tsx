import type { EmbroideryCategory } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as categoriesApi from './api';

interface Props {
  onSelect: (category: EmbroideryCategory) => void;
  refreshToken: number;
}

export function CategoryList({ onSelect, refreshToken }: Props) {
  const [categories, setCategories] = useState<EmbroideryCategory[] | null>(null);
  const [status, setStatus] = useState<categoriesApi.StatusFilter>('active');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    categoriesApi
      .listCategories(status)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [status, refreshToken]);

  async function toggle(category: EmbroideryCategory) {
    setBusyId(category.id);
    try {
      const updated = category.active
        ? await categoriesApi.disableCategory(category.id)
        : await categoriesApi.enableCategory(category.id);
      setCategories((list) => list?.map((c) => (c.id === updated.id ? updated : c)).filter((c) => matchesFilter(c, status)) ?? null);
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
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : categories.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No categories yet.</p>
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
    </div>
  );
}

function matchesFilter(c: EmbroideryCategory, status: categoriesApi.StatusFilter): boolean {
  if (status === 'all') return true;
  return status === 'active' ? c.active : !c.active;
}
