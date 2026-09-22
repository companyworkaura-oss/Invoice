import type { InvoiceListEntry } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as invoicesApi from './api';

interface Props {
  onSelect: (invoice: InvoiceListEntry) => void;
  refreshToken: number;
}

export function InvoiceList({ onSelect, refreshToken }: Props) {
  const [invoices, setInvoices] = useState<InvoiceListEntry[] | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    invoicesApi
      .listInvoices({ status: status || undefined })
      .then(setInvoices)
      .catch(() => setInvoices([]));
  }, [status, refreshToken]);

  return (
    <div>
      <div className="flex justify-end">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {invoices === null ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No invoices yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {invoices.map((inv) => (
            <li key={inv.id}>
              <button
                type="button"
                onClick={() => onSelect(inv)}
                className="flex w-full items-center justify-between py-2 text-left hover:bg-slate-50"
              >
                <span>
                  <span className="block text-sm font-medium text-slate-900">{inv.invoiceNumber}</span>
                  <span className="block text-xs text-slate-500">
                    {inv.customerName} · {inv.invoiceDate} · {inv.status}
                  </span>
                </span>
                <span className="text-sm font-medium text-slate-900">{inv.totalAmount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
