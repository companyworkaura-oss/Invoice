import type { Customer, CustomerStatement, LedgerEntryType } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as ledgerApi from './api';

interface Props {
  customer: Customer;
  onBack: () => void;
}

const TYPES: LedgerEntryType[] = ['OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'ADJUSTMENT'];
const TYPE_LABEL: Record<LedgerEntryType, string> = {
  OPENING_BALANCE: 'Opening Balance',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  ADJUSTMENT: 'Adjustment',
};

function statementFilename(customerName: string): string {
  const slug = customerName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'customer';
  return `Statement-${slug}.pdf`;
}

export function CustomerStatementView({ customer, onBack }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<LedgerEntryType | ''>('');
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (from && to && from > to) return; // wait for a valid range before fetching
    let cancelled = false;
    ledgerApi
      .getStatement(customer.id, { from: from || undefined, to: to || undefined, type: type || undefined })
      .then((result) => {
        if (cancelled) return;
        setStatement(result);
        setLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Could not load the statement.');
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id, from, to, type]);

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const blob = await ledgerApi.fetchStatementPdf(customer.id, {
        from: from || undefined,
        to: to || undefined,
        type: type || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = statementFilename(customer.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.body.error : 'Could not generate the PDF');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <button type="button" onClick={onBack} className="text-xs text-slate-500 underline">
            Back
          </button>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">Statement — {customer.name}</h3>
        </div>
        <div className="flex flex-wrap items-end gap-2">
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
          <select
            value={type}
            onChange={(e) => setType(e.target.value as LedgerEntryType | '')}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {from && to && from > to && (
        <p className="mt-2 text-sm text-red-600 print:hidden">"From" must be on or before "To".</p>
      )}
      {loadError && <p className="mt-2 text-sm text-red-600 print:hidden">{loadError}</p>}
      {downloadError && <p className="mt-1 text-sm text-red-600 print:hidden">{downloadError}</p>}

      {!statement ? (
        <p className="mt-4 text-sm text-slate-400 print:hidden">Loading…</p>
      ) : (
        <div className="mt-4">
          <p className="hidden text-lg font-semibold text-slate-900 print:block">{customer.name}</p>
          <p className="hidden text-xs text-slate-500 print:block">
            {statement.from ?? 'Beginning'} &ndash; {statement.to ?? 'Now'}
          </p>

          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 print:mt-4">
            <SummaryCard label="Opening Balance" value={statement.openingBalance} />
            <SummaryCard label="Invoice Total" value={statement.invoiceTotal} />
            <SummaryCard label="Payments" value={statement.payments} />
            <SummaryCard label="Closing Balance" value={statement.closingBalance} emphasize />
          </div>

          {statement.entries.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No transactions in this period.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">Date</th>
                  <th className="py-1.5 pr-2 font-medium">Reference</th>
                  <th className="py-1.5 pr-2 font-medium">Description</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Debit</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Credit</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2 text-slate-500">{e.date}</td>
                    <td className="py-1 pr-2 text-slate-600">{e.reference ?? '—'}</td>
                    <td className="py-1 pr-2 text-slate-500">{e.description ?? '—'}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{e.debit !== '0.00' ? e.debit : ''}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{e.credit !== '0.00' ? e.credit : ''}</td>
                    <td className="py-1 text-right tabular-nums font-medium text-slate-900">{e.runningBalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 print:border-slate-300">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${emphasize ? 'text-slate-900' : 'text-slate-700'}`}>{value}</p>
    </div>
  );
}
