import type { CustomerLedger } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { PaymentForm } from '../payments/PaymentForm';
import * as ledgerApi from './api';

interface Props {
  customerId: string;
}

export function CustomerLedgerPanel({ customerId }: Props) {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  function refresh() {
    ledgerApi.getLedger(customerId).then(setLedger).catch(() => setLedger(null));
  }

  useEffect(refresh, [customerId]);

  if (!ledger) {
    return <p className="mt-4 text-sm text-slate-400">Loading ledger…</p>;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Ledger</p>
        <p className="text-sm font-semibold text-slate-900">Balance: {ledger.balance}</p>
      </div>

      {ledger.entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No ledger activity yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">Notes</th>
              <th className="py-1 pr-2 text-right font-medium">Debit</th>
              <th className="py-1 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100">
                <td className="py-1 pr-2">{entry.date}</td>
                <td className="py-1 pr-2 text-slate-500">{entry.type}</td>
                <td className="py-1 pr-2 text-slate-500">{entry.notes ?? '—'}</td>
                <td className="py-1 pr-2 text-right">{entry.debit !== '0.00' ? entry.debit : ''}</td>
                <td className="py-1 text-right">{entry.credit !== '0.00' ? entry.credit : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
