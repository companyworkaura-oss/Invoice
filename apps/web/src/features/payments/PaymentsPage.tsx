import type { Payment } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as paymentsApi from './api';
import { PaymentForm } from './PaymentForm';

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank', cheque: 'Cheque', other: 'Other' };

export function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  function refresh() {
    paymentsApi.listPayments().then(setPayments).catch(() => setPayments([]));
  }

  useEffect(refresh, []);

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
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{p.date}</td>
                  <td className="py-1 pr-2">{p.customerName}</td>
                  <td className="py-1 pr-2 text-slate-500">{METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}</td>
                  <td className="py-1 pr-2 text-slate-500">{p.reference ?? '—'}</td>
                  <td className="py-1 text-right">{p.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
