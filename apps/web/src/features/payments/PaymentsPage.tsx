import type { Payment, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as paymentsApi from './api';
import { PaymentForm } from './PaymentForm';

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank', cheque: 'Cheque', other: 'Other' };

interface Props {
  permissions: Permission[];
}

const DELETE_CONFIRM = 'Delete this payment? The related ledger entry and balances will be updated. This action cannot be undone.';

export function PaymentsPage({ permissions }: Props) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canDelete = permissions.includes('payment.delete');

  function refresh() {
    paymentsApi.listPayments().then(setPayments).catch(() => setPayments([]));
  }

  useEffect(refresh, []);

  async function handleDelete(payment: Payment) {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setActionError(null);
    setBusyId(payment.id);
    try {
      await paymentsApi.deletePayment(payment.id);
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.body.error : 'Could not delete this payment');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Payments</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            New payment
          </button>
        )}
      </div>

      {showForm && (
        <div className="mt-3">
          <PaymentForm
            onRecorded={() => {
              setShowForm(false);
              refresh();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <div className="mt-3">
        {payments === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-slate-400">No payments recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Customer</th>
                <th className="py-1 pr-2 font-medium">Method</th>
                <th className="py-1 pr-2 font-medium">Reference</th>
                <th className="py-1 text-right font-medium">Amount</th>
                {canDelete && <th className="py-1 pl-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const busy = busyId === p.id;
                return (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{p.date}</td>
                    <td className="py-1 pr-2">{p.customerName}</td>
                    <td className="py-1 pr-2 text-slate-500">{METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}</td>
                    <td className="py-1 pr-2 text-slate-500">{p.reference ?? '—'}</td>
                    <td className="py-1 text-right">{p.amount}</td>
                    {canDelete && (
                      <td className="py-1 pl-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={busy}
                          className="text-xs text-red-600 underline disabled:opacity-50"
                        >
                          {busy ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
