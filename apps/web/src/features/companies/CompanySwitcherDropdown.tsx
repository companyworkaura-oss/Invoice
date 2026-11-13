import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { Dropdown } from '../../lib/Dropdown';
import * as companiesApi from './api';

interface Props {
  activeCompanyId: string;
  activeCompanyName: string;
  /** Called after a successful switch — same `refreshMe` the full CompanySwitcher on the Company settings page already calls. */
  onSwitched: () => void;
}

/**
 * UI/UX-06 Part 2/8: a compact "COMPANY NAME ▾" control in the main
 * header, next to the company name — switching companies no longer
 * requires navigating away to the Company settings page first. The
 * full CompanySwitcher (create company, reactivate a deactivated one)
 * still lives only on the Company settings page; this is deliberately
 * just the everyday "switch to one of my other active companies"
 * action, reached from wherever the user already is. Uses the exact
 * same `switchCompany` API and F02 safety behavior as the full
 * switcher — nothing about company-switch safety changes here.
 */
export function CompanySwitcherDropdown({ activeCompanyId, activeCompanyName, onSwitched }: Props) {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<companiesApi.CompanyMembershipWithStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadCompanies() {
    companiesApi.listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }

  async function handleSwitch(companyId: string, close: () => void) {
    if (companyId === activeCompanyId) {
      close();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await companiesApi.switchCompany(companyId);
      close();
      onSwitched();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not switch company');
    } finally {
      setBusy(false);
    }
  }

  const activeCompanies = (companies ?? []).filter((c) => c.status === 'active');

  return (
    <Dropdown
      trigger={(toggle, open) => (
        <button
          type="button"
          onClick={() => {
            loadCompanies();
            toggle();
          }}
          aria-expanded={open}
          
          className="flex max-w-[260px] items-center gap-1 rounded-md py-1 pr-1.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          <span className="truncate text-lg font-semibold text-slate-900">{activeCompanyName}</span>
          <span aria-hidden className="shrink-0 text-xs text-slate-400">
            ▾
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="w-64">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your companies</p>
          {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}
          {companies === null ? (
            <p className="px-3 py-1.5 text-sm text-slate-400">Loading…</p>
          ) : activeCompanies.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-slate-400">No active companies.</p>
          ) : (
            <ul>
              {activeCompanies.map((c) => {
                const isActive = c.id === activeCompanyId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSwitch(c.id, close)}
                      aria-current={isActive ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${
                        isActive ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-600'
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      {isActive && (
                        <span aria-hidden className="shrink-0 text-xs text-slate-500">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={() => {
                close();
                navigate('/settings');
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
            >
              Manage companies
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}
