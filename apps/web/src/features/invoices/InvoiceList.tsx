import type { Customer, InvoiceArchivedFilter, InvoiceListEntry, InvoicePaymentStatus, Permission } from '@invoice/shared';
import { formatNumber } from '@invoice/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as invoicesApi from './api';

export type InvoiceRowAction = 'print' | 'pdf' | 'whatsapp' | 'duplicate';

interface Props {
  onSelect: (invoice: InvoiceListEntry) => void;
  onAction: (action: InvoiceRowAction, invoice: InvoiceListEntry) => void;
  onViewPayments: (customerId: string) => void;
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
 * uses, so this never has to guess — returning null here means the server
 * would accept the delete; any other return value is the exact reason it
 * would reject it, worded the same way the backend itself would.
 */
function hardDeleteBlockReason(invoice: InvoiceListEntry): string | null {
  if (invoice.status !== 'draft') {
    return 'Only draft invoices can be permanently deleted. Cancel or archive an issued invoice instead.';
  }
  if (invoice.paid !== '0.00') {
    return 'This invoice has a payment applied to it and cannot be permanently deleted — archive it instead to preserve accounting history.';
  }
  return null;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface RowMenuItem {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** The "⋮" overflow menu for a row's less-frequently-used actions. Purely presentational — every action/permission/disabled-reason it renders is decided by the caller, nothing here changes what's allowed. */
function RowActionsMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-expanded={open}
        className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 min-w-[150px] rounded-md border border-slate-200 bg-white py-1 text-xs shadow-md">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent ${item.className ?? 'text-slate-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function InvoiceList({ onSelect, onAction, onViewPayments, permissions, refreshToken }: Props) {
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
        <div className="min-w-[180px] flex-[2_1_260px]">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoices…"
            title="Search by invoice #, bill #, customer, lot #, gate pass #"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <p className="mt-0.5 text-[11px] text-slate-400">Search by invoice #, bill #, customer, lot #, gate pass #</p>
        </div>
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="flex-1 basis-[150px] rounded-md border border-slate-300 px-2 py-1 text-sm"
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
          className="flex-1 basis-[130px] rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="shrink-0 text-xs font-medium text-slate-500">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block w-[130px] rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="shrink-0 text-xs font-medium text-slate-500">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block w-[130px] rounded-md border border-slate-300 px-2 py-1 text-sm"
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2 font-medium">Invoice No</th>
                <th className="py-1.5 pr-2 font-medium">Bill #</th>
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="hidden py-1.5 pr-2 font-medium xl:table-cell">Internal Lot #</th>
                <th className="hidden py-1.5 pr-2 font-medium xl:table-cell">Customer Lot #</th>
                <th className="py-1.5 pr-2 font-medium">Customer</th>
                <th className="py-1.5 pr-2 text-right font-medium">Grand Total</th>
                <th className="hidden py-1.5 pr-2 text-right font-medium lg:table-cell">Paid</th>
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
                    <td className="py-1.5 pr-2 text-slate-500">{inv.billNumber ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{inv.invoiceDate}</td>
                    <td className="hidden py-1.5 pr-2 text-slate-500 xl:table-cell">{inv.lotNumber ?? '—'}</td>
                    <td className="hidden py-1.5 pr-2 text-slate-500 xl:table-cell">{inv.customerLotNumber ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{inv.customerName}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumber(inv.grandTotal)}</td>
                    <td className="hidden py-1.5 pr-2 text-right tabular-nums lg:table-cell">{formatNumber(inv.paid)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-slate-900">{formatNumber(inv.balance)}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[inv.paymentStatus]}`}>
                        {inv.paymentStatus}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2 text-xs">
                        <button type="button" onClick={() => onSelect(inv)} className="text-slate-600 underline hover:text-slate-900">
                          View
                        </button>
                        <RowActionsMenu
                          items={(() => {
                            const blockReason = hardDeleteBlockReason(inv);
                            const menuItems: RowMenuItem[] = [
                              { key: 'pdf', label: 'PDF', onClick: () => onAction('pdf', inv) },
                            ];
                            if (!isArchived) {
                              menuItems.push(
                                { key: 'print', label: 'Print', onClick: () => onAction('print', inv) },
                                { key: 'whatsapp', label: 'WhatsApp', onClick: () => onAction('whatsapp', inv), className: 'text-green-700' },
                                { key: 'duplicate', label: 'Duplicate', onClick: () => onAction('duplicate', inv) },
                              );
                              if (canArchive) {
                                menuItems.push({
                                  key: 'archive',
                                  label: 'Archive',
                                  onClick: () => handleArchive(inv),
                                  disabled: busy,
                                  className: 'text-amber-700',
                                });
                              }
                            }
                            if (isArchived && canArchive) {
                              menuItems.push({
                                key: 'restore',
                                label: 'Restore',
                                onClick: () => handleUnarchive(inv),
                                disabled: busy,
                                className: 'text-blue-700',
                              });
                            }
                            if (canDelete) {
                              menuItems.push({
                                key: 'delete',
                                label: blockReason ? 'Delete (disabled)' : 'Delete',
                                onClick: () => handleDelete(inv),
                                disabled: busy || blockReason !== null,
                                title: blockReason ?? undefined,
                                className: 'text-red-600',
                              });
                              if (blockReason !== null && inv.paid !== '0.00') {
                                menuItems.push({
                                  key: 'view-payments',
                                  label: 'View payments',
                                  onClick: () => onViewPayments(inv.customerId),
                                });
                              }
                            }
                            return menuItems;
                          })()}
                        />
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
