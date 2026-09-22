import { useEffect, useState } from 'react';
import * as companiesApi from './api';

interface Props {
  activeCompanyId: string;
  onSwitched: () => void;
}

/** Minimal list of the user's companies, with switch and create-new actions. */
export function CompanySwitcher({ activeCompanyId, onSwitched }: Props) {
  const [companies, setCompanies] = useState<companiesApi.CompanyMembership[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    companiesApi.listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [activeCompanyId]);

  async function handleSwitch(companyId: string) {
    if (companyId === activeCompanyId) return;
    setBusy(true);
    try {
      await companiesApi.switchCompany(companyId);
      onSwitched();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await companiesApi.createCompany(newName.trim());
      setNewName('');
      onSwitched();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your companies</p>
      <ul className="mt-2 space-y-1">
        {companies.map((c) => (
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
