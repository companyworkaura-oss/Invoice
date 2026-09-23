import type { Customer, InvoiceListEntry, InvoicePaymentStatus } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as customersApi from '../customers/api';
import * as invoicesApi from './api';

export type InvoiceRowAction = 'print' | 'pdf' | 'whatsapp' | 'duplicate';

interface Props {
  onSelect: (invoice: InvoiceListEntry) => void;
  onAction: (action: InvoiceRowAction, invoice: InvoiceListEntry) => void;
  refreshToken: number;
}

const PAYMENT_STATUSES: InvoicePaymentStatus[] = ['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'];

const STATUS_STYLE: Record<InvoicePaymentStatus, string> = {
  PAID: 'bg-green-50 text-green-700',
  PARTIAL: 'bg-amber-50 text-amber-700',
  UNPAID: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function InvoiceList({ onSelect, onAction, refreshToken }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus | ''>('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceListEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    customersApi.listCustomers({ status: 'all' }).then(setCustomers).catch(() => setCustomers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoicesApi
      .listInvoices({
        search: search || undefined,
        customerId: customerId || undefined,
        from: from || undefined,
        to: to || undefined,
        paymentStatus: paymentStatus || undefined,
      })
      .then((result) => {
        if (cancelled) return;
        setInvoices(result);
        setLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setInvoices([]);
        setLoadError('Could not load invoices.');
      });
    return () => {
      cancelled = true;
    };
  }, [search, customerId, from, to, paymentStatus, refreshToken]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search invoice # or customer…"
          className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={paymentStatus}
          onChange={(e) => setPaymentStatus(e.target.value as InvoicePaymentStatus | '')}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="text-xs font-medium text-slate-500">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}

      {invoices === null ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No invoices match these filters.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2 font-medium">Invoice No</th>
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="py-1.5 pr-2 font-medium">Customer</th>
                <th className="py-1.5 pr-2 text-right font-medium">Current Bill</th>
                <th className="py-1.5 pr-2 text-right font-medium">Paid</th>
                <th className="py-1.5 pr-2 text-right font-medium">Balance</th>
                <th className="py-1.5 pr-2 font-medium">Status</th>
                <th className="py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-slate-900">{inv.invoiceNumber}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{inv.invoiceDate}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{inv.customerName}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{inv.totalAmount}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{inv.paid}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-slate-900">{inv.balance}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[inv.paymentStatus]}`}>
                      {inv.paymentStatus}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                      <button type="button" onClick={() => onSelect(inv)} className="text-slate-600 underline hover:text-slate-900">
                        View
                      </button>
                      <button type="button" onClick={() => onAction('print', inv)} className="text-slate-600 underline hover:text-slate-900">
                        Print
                      </button>
                      <button type="button" onClick={() => onAction('pdf', inv)} className="text-slate-600 underline hover:text-slate-900">
                        PDF
                      </button>
                      <button type="button" onClick={() => onAction('whatsapp', inv)} className="text-green-700 underline hover:text-green-900">
                        WhatsApp
                      </button>
                      <button type="button" onClick={() => onAction('duplicate', inv)} className="text-slate-600 underline hover:text-slate-900">
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
