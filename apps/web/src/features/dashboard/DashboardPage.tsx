import type { DashboardRange, DashboardSummary } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as dashboardApi from './api';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const RANGE_LABEL: Record<DashboardRange, string> = {
  today: 'Today',
  month: 'This Month',
  custom: 'Custom Range',
};

export function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [customFrom, setCustomFrom] = useState(todayLocal);
  const [customTo, setCustomTo] = useState(todayLocal);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (range === 'custom' && customFrom > customTo) return; // wait for a valid range before fetching
    let cancelled = false;
    dashboardApi
      .getDashboard({ range, from: range === 'custom' ? customFrom : undefined, to: range === 'custom' ? customTo : undefined })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.body.error : 'Could not load the dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, customFrom, customTo]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Dashboard</h2>
        <div className="flex items-center gap-2">
          {(['today', 'month', 'custom'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md border px-3 py-1 text-sm ${
                range === r
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          {customFrom > customTo && <p className="text-xs text-red-600">"From" must be on or before "To".</p>}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {loading && !data ? (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      ) : data ? (
        <DashboardBody data={data} />
      ) : null}
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardSummary }) {
  const { cards } = data;
  return (
    <div className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label={`${RANGE_LABEL[data.period.range]}'s Invoice Amount`} value={cards.invoiceAmount} />
        <Card label="Payments Received" value={cards.paymentsReceived} />
        <Card label="Total Receivable" value={cards.totalReceivable} />
        <Card label="Unpaid/Partial Invoices" value={String(cards.unpaidOrPartialInvoiceCount)} />
      </div>

      <Section title="Recent Invoices">
        {data.recentInvoices.length === 0 ? (
          <EmptyRow>No invoices in this period.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Invoice #</th>
                <th className="py-1 pr-2 font-medium">Customer</th>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{inv.invoiceNumber}</td>
                  <td className="py-1 pr-2 text-slate-600">{inv.customerName}</td>
                  <td className="py-1 pr-2 text-slate-500">{inv.invoiceDate}</td>
                  <td className="py-1 pr-2 text-slate-500 capitalize">{inv.status}</td>
                  <td className="py-1 text-right tabular-nums">{inv.totalAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Recent Payments">
        {data.recentPayments.length === 0 ? (
          <EmptyRow>No payments in this period.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Customer</th>
                <th className="py-1 pr-2 font-medium">Method</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPayments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-500">{p.date}</td>
                  <td className="py-1 pr-2 text-slate-600">{p.customerName}</td>
                  <td className="py-1 pr-2 text-slate-500 capitalize">{p.paymentMethod}</td>
                  <td className="py-1 text-right tabular-nums">{p.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Customers With Outstanding Balance">
        {data.customersWithOutstandingBalance.length === 0 ? (
          <EmptyRow>No customers currently owe a balance.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Customer</th>
                <th className="py-1 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.customersWithOutstandingBalance.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 text-slate-600">{c.name}</td>
                  <td className="py-1 text-right font-medium tabular-nums text-slate-900">{c.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}
