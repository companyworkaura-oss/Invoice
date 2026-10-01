import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as companiesApi from './api';

interface Props {
  activeCompanyId: string;
  onSwitched: () => void;
}

/** Minimal list of the user's companies, with switch, create-new, and reactivate actions. */
export function CompanySwitcher({ activeCompanyId, onSwitched }: Props) {
  const [companies, setCompanies] = useState<companiesApi.CompanyMembershipWithStatus[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    companiesApi.listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [activeCompanyId]);

  const active = companies.filter((c) => c.status === 'active');
  const deactivated = companies.filter((c) => c.status === 'deactivated');

  async function handleSwitch(companyId: string) {
    if (companyId === activeCompanyId) return;
    setError(null);
    setBusy(true);
    try {
      await companiesApi.switchCompany(companyId);
      onSwitched();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not switch company');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await companiesApi.createCompany(newName.trim());
      setNewName('');
      onSwitched();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not create company');
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate(companyId: string) {
    setError(null);
    setBusy(true);
    try {
      await companiesApi.reactivateCompany(companyId);
      companiesApi.listCompanies().then(setCompanies).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not reactivate company');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your companies</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <ul className="mt-2 space-y-1">
        {active.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSwitch(c.id)}
              className={`w-full rounded-md px-2 py-1 text-left text-sm ${
                c.id === activeCompanyId ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {c.name} <span className="text-xs text-slate-400">({c.role})</span>
            </button>
          </li>
        ))}
      </ul>

      {deactivated.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Deactivated</p>
          <ul className="mt-2 space-y-1">
            {deactivated.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1">
                <span className="text-sm text-slate-400">
                  {c.name} <span className="text-xs">({c.role})</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReactivate(c.id)}
                  className="shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Reactivate
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="New company name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </div>
  );
}
