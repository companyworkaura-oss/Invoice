import type { Customer, InvoiceArchivedFilter, InvoiceListEntry, InvoicePaymentStatus, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as invoicesApi from './api';

export type InvoiceRowAction = 'print' | 'pdf' | 'whatsapp' | 'duplicate';

interface Props {
  onSelect: (invoice: InvoiceListEntry) => void;
  onAction: (action: InvoiceRowAction, invoice: InvoiceListEntry) => void;
  permissions: Permission[];
  refreshToken: number;
}

const PAYMENT_STATUSES: InvoicePaymentStatus[] = ['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'];

const STATUS_STYLE: Record<InvoicePaymentStatus, string> = {
  PAID: 'bg-green-50 text-green-700',
  PARTIAL: 'bg-amber-50 text-amber-700',
  UNPAID: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const ARCHIVED_TABS: { value: InvoiceArchivedFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

/**
 * Mirrors the backend's deleteInvoice safety rule exactly (invoice.service.ts):
 * only a draft with nothing paid against it can be permanently deleted. `paid`
 * here is the same FIFO-allocated per-invoice amount the backend's own check
 * uses, so this never has to guess — a button hidden by this is a delete the
 * server would have rejected anyway.
 */
function canHardDelete(invoice: InvoiceListEntry): boolean {
  return invoice.status === 'draft' && invoice.paid === '0.00';
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function InvoiceList({ onSelect, onAction, permissions, refreshToken }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 300);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus | ''>('');
  const [archived, setArchived] = useState<InvoiceArchivedFilter>('active');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceListEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canArchive = permissions.includes('invoice.archive');
  const canDelete = permissions.includes('invoice.delete');

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
        archived,
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
  }, [search, customerId, from, to, paymentStatus, archived, refreshToken, localRefresh]);

  async function handleArchive(invoice: InvoiceListEntry) {
    if (!window.confirm('Archive this invoice? It will be hidden from the normal invoice list but all accounting records will remain.')) {
      return;
    }
    setActionError(null);
    setBusyId(invoice.id);
    try {
      await invoicesApi.archiveInvoice(invoice.id);
      setLocalRefresh((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.body.error : 'Could not archive this invoice');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnarchive(invoice: InvoiceListEntry) {
    if (!window.confirm('Restore this invoice to the active invoice list?')) return;
    setActionError(null);
    setBusyId(invoice.id);
    try {
      await invoicesApi.unarchiveInvoice(invoice.id);
      setLocalRefresh((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.body.error : 'Could not restore this invoice');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(invoice: InvoiceListEntry) {
    if (!window.confirm('Delete this invoice permanently? This action cannot be undone.')) return;
    setActionError(null);
    setBusyId(invoice.id);
    try {
      await invoicesApi.deleteInvoice(invoice.id);
      setLocalRefresh((t) => t + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? (err.body.details?.status ?? err.body.details?.payments ?? err.body.error) : 'Could not delete this invoice',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200">
        {ARCHIVED_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setArchived(t.value)}
            className={`-mb-px border-b-2 px-2 pb-2 text-sm font-medium ${
              archived === t.value ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
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
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

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
              {invoices.map((inv) => {
                const isArchived = Boolean(inv.archivedAt);
                const busy = busyId === inv.id;
                return (
                  <tr key={inv.id} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-medium text-slate-900">
                      {inv.invoiceNumber}
                      {isArchived && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          Archived
                        </span>
                      )}
                    </td>
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
                        <button type="button" onClick={() => onAction('pdf', inv)} className="text-slate-600 underline hover:text-slate-900">
                          PDF
                        </button>
                        {!isArchived && (
                          <>
                            <button type="button" onClick={() => onAction('print', inv)} className="text-slate-600 underline hover:text-slate-900">
                              Print
                            </button>
                            <button type="button" onClick={() => onAction('whatsapp', inv)} className="text-green-700 underline hover:text-green-900">
                              WhatsApp
                            </button>
                            <button type="button" onClick={() => onAction('duplicate', inv)} className="text-slate-600 underline hover:text-slate-900">
                              Duplicate
                            </button>
                            {canArchive && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleArchive(inv)}
                                className="text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
                              >
                                Archive
                              </button>
                            )}
                          </>
                        )}
                        {isArchived && canArchive && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleUnarchive(inv)}
                            className="text-blue-700 underline hover:text-blue-900 disabled:opacity-50"
                          >
                            Restore
                          </button>
                        )}
                        {canDelete && canHardDelete(inv) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDelete(inv)}
                            className="text-red-600 underline hover:text-red-800 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
