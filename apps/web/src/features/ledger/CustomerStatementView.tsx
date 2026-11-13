import type { CompanyProfile, Customer, CustomerStatement, LedgerEntryType } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { downloadPdf } from '../../lib/downloadPdf';
import { MoneyText, PrimaryButton, SecondaryButton, SectionHeading } from '../../lib/ui';
import * as companyApi from '../company/api';
import * as ledgerApi from './api';
import { StatementPrintDocument } from './StatementPrintDocument';

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
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    companyApi.fetchProfile().then(setCompany).catch(() => setCompany(null));
  }, []);

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

  function handlePrint() {
    // Same document.title convention InvoiceTemplateView uses — Chrome/Edge
    // suggest it as the default filename for "Save as PDF" from the print
    // dialog. The actual printed page is StatementPrintDocument below,
    // never this on-screen view — see its own comment for why.
    const previousTitle = document.title;
    document.title = statementFilename(customer.name).replace(/\.pdf$/, '');
    window.print();
    document.title = previousTitle;
  }

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const pdfUrl = ledgerApi.statementPdfUrl(customer.id, {
        from: from || undefined,
        to: to || undefined,
        type: type || undefined,
      });
      await downloadPdf(pdfUrl, statementFilename(customer.name));
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
          <button type="button" onClick={onBack} className="text-sm font-medium text-slate-600 underline hover:text-slate-900">
            ← Back
          </button>
          <SectionHeading className="mt-1">Statement — {customer.name}</SectionHeading>
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
          <SecondaryButton onClick={handlePrint}>Print</SecondaryButton>
          <PrimaryButton onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download PDF'}
          </PrimaryButton>
        </div>
      </div>

      {from && to && from > to && (
        <p className="mt-2 text-sm text-red-600 print:hidden">"From" must be on or before "To".</p>
      )}
      {loadError && <p role="alert" className="mt-2 text-sm text-red-600 print:hidden">{loadError}</p>}
      {downloadError && <p role="alert" className="mt-1 text-sm text-red-600 print:hidden">{downloadError}</p>}

      {!statement ? (
        <p className="mt-4 text-sm text-slate-400 print:hidden">Loading…</p>
      ) : (
        <div className="mt-4 print:hidden">
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Opening Balance" value={statement.openingBalance} />
            <SummaryCard label="Invoice Total" value={statement.invoiceTotal} />
            <SummaryCard label="Payments" value={statement.payments} />
            <SummaryCard label="Closing Balance" value={statement.closingBalance} emphasize />
          </div>

          {statement.entries.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">No transactions in this period.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-2 font-semibold">Date</th>
                  <th className="py-2 pr-2 font-semibold">Reference</th>
                  <th className="py-2 pr-2 font-semibold">Description</th>
                  <th className="py-2 pr-2 text-right font-semibold">Debit</th>
                  <th className="py-2 pr-2 text-right font-semibold">Credit</th>
                  <th className="py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 text-slate-500">{e.date}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{e.reference ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{e.description ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-right">{e.debit !== '0.00' ? <MoneyText value={e.debit} showCurrency={false} /> : ''}</td>
                    <td className="py-1.5 pr-2 text-right">{e.credit !== '0.00' ? <MoneyText value={e.credit} showCurrency={false} /> : ''}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900"><MoneyText value={e.runningBalance} showCurrency={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Invisible on screen, the only thing visible on paper — see StatementPrintDocument's own comment. */}
      {statement && company && <StatementPrintDocument company={company} customer={customer} statement={statement} />}
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
