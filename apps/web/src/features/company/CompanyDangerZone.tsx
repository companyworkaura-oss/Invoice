import type { Permission } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import * as companyApi from './api';

interface Props {
  companyName: string;
  permissions: Permission[];
  /** Called after a successful deactivate/delete — the caller's session has already been re-pointed at another company (or, for delete, this was blocked entirely if none existed), so this just needs to refresh `me`. */
  onCompanyChanged: () => void;
}

/**
 * Deactivate (reversible, data-preserving) and permanent delete
 * (irreversible) both act on the *current* company only — same
 * "no company picker here" convention as the rest of the Company
 * Settings page. Gated per-action by permission, not role name, so a
 * future role change never needs this component touched.
 */
export function CompanyDangerZone({ companyName, permissions, onCompanyChanged }: Props) {
  const canDeactivate = permissions.includes('company.deactivate');
  const canDelete = permissions.includes('company.delete');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [typedName, setTypedName] = useState('');

  if (!canDeactivate && !canDelete) return null;

  async function handleDeactivate() {
    if (
      !window.confirm(
        `Deactivate "${companyName}"? It will be hidden from your active company switcher, but all its data (invoices, customers, ledger, payments, audit history) is preserved — you can restore it any time.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await companyApi.deactivateCompany();
      onCompanyChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not deactivate this company');
    } finally {
      setBusy(false);
    }
  }

  function startDeleteConfirm() {
    if (!window.confirm('Delete this company permanently?')) return;
    setError(null);
    setShowDeleteConfirm(true);
  }

  function cancelDeleteConfirm() {
    setShowDeleteConfirm(false);
    setTypedName('');
    setError(null);
  }

  async function handleDelete() {
    if (typedName !== companyName) return;
    setError(null);
    setBusy(true);
    try {
      await companyApi.deleteCompanyPermanently(typedName);
      onCompanyChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Could not delete this company');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Danger Zone</p>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {canDeactivate && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Deactivate Company</p>
            <p className="text-xs text-slate-500">Hides this company and preserves all its data. Restore any time.</p>
          </div>
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={busy}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Deactivate Company
          </button>
        </div>
      )}

      {canDelete && (
        <div className="mt-4 border-t border-red-200 pt-4">
          <p className="text-sm font-medium text-slate-900">Delete Company Permanently</p>
          <p className="text-xs text-slate-500">
            Permanently deletes every invoice, customer, payment, and ledger entry this company owns. This cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={startDeleteConfirm}
              disabled={busy}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete Company Permanently
            </button>
          ) : (
            <div className="mt-2 space-y-2">
              <label className="block text-sm text-slate-700">
                Type <span className="font-mono font-semibold">{companyName}</span> to confirm.
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={companyName}
                  autoFocus
                  className="mt-1 w-full rounded-md border border-red-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelDeleteConfirm}
                  disabled={busy}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy || typedName !== companyName}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'Deleting…' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
