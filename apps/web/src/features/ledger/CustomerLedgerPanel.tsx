import type { CustomerLedger, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { MoneyText } from '../../lib/ui';
import { PaymentForm } from '../payments/PaymentForm';
import * as paymentsApi from '../payments/api';
import * as ledgerApi from './api';

interface Props {
  customerId: string;
  permissions: Permission[];
}

const DELETE_CONFIRM = 'Delete this payment? The related ledger entry and balances will be updated. This action cannot be undone.';

export function CustomerLedgerPanel({ customerId, permissions }: Props) {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canDelete = permissions.includes('payment.delete');

  function refresh() {
    ledgerApi.getLedger(customerId).then(setLedger).catch(() => setLedger(null));
  }

  useEffect(refresh, [customerId]);

  async function handleDeletePayment(paymentId: string) {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setActionError(null);
    setBusyId(paymentId);
    try {
      await paymentsApi.deletePayment(paymentId);
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.body.error : 'Could not delete this payment');
    } finally {
      setBusyId(null);
    }
  }

  if (!ledger) {
    return <p className="mt-4 text-sm text-slate-400">Loading ledger…</p>;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Ledger</p>
        <p className="text-sm font-semibold text-slate-900">
          Balance: <MoneyText value={ledger.balance} />
        </p>
      </div>

      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      {ledger.entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No ledger activity yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2 font-semibold">Date</th>
              <th className="py-2 pr-2 font-semibold">Type</th>
              <th className="py-2 pr-2 font-semibold">Notes</th>
              <th className="py-2 pr-2 text-right font-semibold">Debit</th>
              <th className="py-2 text-right font-semibold">Credit</th>
              {canDelete && <th className="py-2 pl-2 font-semibold" />}
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => {
              const busy = busyId === entry.referenceId;
              const canDeleteThis = canDelete && entry.type === 'PAYMENT' && entry.referenceId;
              return (
                <tr key={entry.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">{entry.date}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{entry.type}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{entry.notes ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{entry.debit !== '0.00' ? <MoneyText value={entry.debit} showCurrency={false} /> : ''}</td>
                  <td className="py-1.5 text-right">{entry.credit !== '0.00' ? <MoneyText value={entry.credit} showCurrency={false} /> : ''}</td>
                  {canDelete && (
                    <td className="py-1.5 pl-2 text-right">
                      {canDeleteThis && (
                        <button
                          type="button"
                          onClick={() => handleDeletePayment(entry.referenceId as string)}
                          disabled={busy}
                          className="text-xs text-red-600 underline disabled:opacity-50"
                        >
                          {busy ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <div className="mt-3">
        {showPaymentForm ? (
          <PaymentForm
            customerId={customerId}
            onRecorded={() => {
              setShowPaymentForm(false);
              refresh();
            }}
            onCancel={() => setShowPaymentForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowPaymentForm(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Record a payment
          </button>
        )}
      </div>
    </div>
  );
}
