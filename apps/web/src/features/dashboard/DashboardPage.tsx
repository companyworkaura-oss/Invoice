import type { DashboardRange, DashboardSummary } from '@invoice/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, InlineErrorBanner, LoadingState, UpdatingIndicator } from '../../lib/AsyncState';
import { useAsyncData } from '../../lib/use-async-list';
import { MoneyText, PageHeader, PrimaryButton, SecondaryButton, SectionHeading, StatusBadge } from '../../lib/ui';
import { INVOICE_PAYMENT_STATUS_TONE } from '../../lib/ui-tokens';
import { getLastInvoiceMode } from '../invoices/last-invoice-mode';
import { useDocumentTitle } from '../../lib/use-document-title';
import { formatDashboardPeriodLabel } from './period-label';
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

/**
 * UI/UX-07: Dashboard as the main operational starting point —
 * primary/secondary actions (Create invoice / Record payment),
 * clickable invoices and customers, one shared money formatter, a
 * visible period label distinguishing period-scoped metrics from
 * current-balance ones, and authoritative payment-status badges.
 */
export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>('today');
  const [customFrom, setCustomFrom] = useState(todayLocal);
  const [customTo, setCustomTo] = useState(todayLocal);
  // UI/UX-02: read once per mount, not reactively — matches
  // InvoicesPage's own EntryModeButton convention. "Create invoice"
  // is one button, not a second competing choice screen.
  const [lastMode] = useState(getLastInvoiceMode);

  const customRangeInvalid = range === 'custom' && customFrom > customTo;
  // While a custom "From"/"To" pair is invalid (From after To), keep
  // fetching whatever the last *valid* pair was — same as the plain
  // "don't fetch yet" skip this replaced, just expressed as "the fetch
  // deps don't change" rather than an early return, so useAsyncData
  // still has something consistent to call. Adjusted during render
  // (not an effect) — the same "derive stable value when a prop/value
  // changes" pattern this app already uses elsewhere (App.tsx's
  // company-switch reset, PaymentsPage's initialCustomerId sync).
  const [lastValidCustomRange, setLastValidCustomRange] = useState({ from: customFrom, to: customTo });
  if (range === 'custom' && !customRangeInvalid && (lastValidCustomRange.from !== customFrom || lastValidCustomRange.to !== customTo)) {
    setLastValidCustomRange({ from: customFrom, to: customTo });
  }

  const {
    data,
    isFetching,
    error,
    retry,
  } = useAsyncData<DashboardSummary>(
    () =>
      dashboardApi.getDashboard({
        range,
        from: range === 'custom' ? lastValidCustomRange.from : undefined,
        to: range === 'custom' ? lastValidCustomRange.to : undefined,
      }),
    [range, lastValidCustomRange.from, lastValidCustomRange.to],
    'Could not load the dashboard.',
  );

  function openCreateInvoice() {
    navigate(lastMode === 'quick' ? '/invoices/quick' : '/invoices/new');
  }

  function openRecordPayment() {
    navigate('/payments?new=1');
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Create an invoice, record a payment, or pick up where you left off."
        action={
          <>
            <PrimaryButton onClick={openCreateInvoice}>Create invoice</PrimaryButton>
            <SecondaryButton onClick={openRecordPayment}>Record payment</SecondaryButton>
          </>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(['today', 'month', 'custom'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              range === r
                ? 'border-slate-900 bg-slate-900 text-white focus-visible:outline-slate-900'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 focus-visible:outline-slate-400'
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
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
          {customRangeInvalid && <p className="text-xs text-red-600">"From" must be on or before "To".</p>}
        </div>
      )}

      <div className="mt-4">
        {data === null ? (
          error ? (
            <ErrorState message={error} onRetry={retry} />
          ) : (
            <LoadingState label="Loading dashboard…" />
          )
        ) : (
          <>
            {isFetching && <UpdatingIndicator />}
            {!isFetching && error && <InlineErrorBanner message={error} onRetry={retry} />}
            <DashboardBody data={data} onCreateInvoice={openCreateInvoice} />
          </>
        )}
      </div>
    </div>
  );
}

function DashboardBody({ data, onCreateInvoice }: { data: DashboardSummary; onCreateInvoice: () => void }) {
  const { cards } = data;
  const periodLabel = formatDashboardPeriodLabel(data.period);

  return (
    <div className="space-y-6">
      {/*
        UI/UX-07 Part 5: two clearly separate metric groups — "this
        period" (scoped to the date range selected above, with that
        range's human-readable label right in the heading) versus
        "right now" (a current, account-wide balance that has no
        period — paying off an old invoice today still clears it
        regardless of which period is selected above). Never labeled
        in a way that implies they cover the same timeframe.
      */}
      <div>
        <SectionHeading className="text-sm uppercase tracking-wide text-slate-500">
          This period — {periodLabel}
        </SectionHeading>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card label="Invoiced this period" value={cards.invoiceAmount} />
          <Card label="Payments received this period" value={cards.paymentsReceived} />
        </div>
      </div>

      <div>
        <SectionHeading className="text-sm uppercase tracking-wide text-slate-500">Right now (all time)</SectionHeading>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card label="Outstanding customer receivables" value={cards.totalReceivable} />
          <Card label="Unpaid / partial invoices" value={String(cards.unpaidOrPartialInvoiceCount)} money={false} />
        </div>
      </div>

      <RecentInvoicesSection invoices={data.recentInvoices} onCreateInvoice={onCreateInvoice} />

      <Section title="Recent Payments">
        {data.recentPayments.length === 0 ? (
          <EmptyState message="No payments in this period." />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-2 font-semibold">Date</th>
                <th className="py-2 pr-2 font-semibold">Customer</th>
                <th className="py-2 pr-2 font-semibold">Method</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPayments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-500">{p.date}</td>
                  <td className="py-1.5 pr-2">
                    <CustomerLink customerId={p.customerId} name={p.customerName} />
                  </td>
                  <td className="py-1.5 pr-2 text-slate-500 capitalize">{p.paymentMethod}</td>
                  <td className="py-1.5 text-right"><MoneyText value={p.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>

      <Section title="Customers With Outstanding Balance">
        {data.customersWithOutstandingBalance.length === 0 ? (
          <EmptyState message="No customers currently owe a balance." />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-2 font-semibold">Customer</th>
                <th className="py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.customersWithOutstandingBalance.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2">
                    <CustomerLink customerId={c.id} name={c.name} />
                  </td>
                  <td className="py-1.5 text-right font-medium text-slate-900"><MoneyText value={c.balance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * UI/UX-07 Parts 2/3/7/8: the one section the report specifically
 * calls out — invoice number and customer name are real links (not
 * local-state-only navigation), payment status uses the exact same
 * authoritative badge InvoiceList/InvoiceDetails show, and mobile
 * gets stacked cards (Customer / Invoice / Total / Status / Date /
 * View details, in that order) instead of a squeezed desktop table.
 */
function RecentInvoicesSection({
  invoices,
  onCreateInvoice,
}: {
  invoices: DashboardSummary['recentInvoices'];
  onCreateInvoice: () => void;
}) {
  return (
    <div>
      <SectionHeading className="text-sm uppercase tracking-wide text-slate-500">Recent Invoices</SectionHeading>
      <div className="mt-2">
        {invoices.length === 0 ? (
          <EmptyState message="No invoices in this period." actionLabel="Create invoice" onAction={onCreateInvoice} />
        ) : (
          <>
            {/* Desktop/tablet: a compact table. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-2 font-semibold">Invoice</th>
                    <th className="py-2 pr-2 font-semibold">Customer</th>
                    <th className="py-2 pr-2 text-right font-semibold">Total</th>
                    <th className="py-2 pr-2 font-semibold">Payment status</th>
                    <th className="py-2 pr-2 font-semibold">Date</th>
                    <th className="py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-medium text-slate-900">
                        <Link to={`/invoices/${inv.id}`} className="hover:underline">
                          {inv.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2">
                        <CustomerLink customerId={inv.customerId} name={inv.customerName} />
                      </td>
                      <td className="py-1.5 pr-2 text-right"><MoneyText value={inv.totalAmount} /></td>
                      <td className="py-1.5 pr-2">
                        <StatusBadge label={inv.paymentStatus} tone={INVOICE_PAYMENT_STATUS_TONE[inv.paymentStatus]} />
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500">{inv.invoiceDate}</td>
                      <td className="py-1.5 text-right">
                        <Link to={`/invoices/${inv.id}`} className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards — Customer, Invoice number, Total, Payment status, Date, View details, in that order; nothing wraps awkwardly. */}
            <div className="space-y-2 sm:hidden">
              {invoices.map((inv) => (
                <div key={inv.id} className="rounded-md border border-slate-200 p-3">
                  <CustomerLink customerId={inv.customerId} name={inv.customerName} className="block text-sm font-semibold" />
                  <Link to={`/invoices/${inv.id}`} className="mt-0.5 block text-sm text-slate-600 hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      <MoneyText value={inv.totalAmount} />
                    </span>
                    <StatusBadge label={inv.paymentStatus} tone={INVOICE_PAYMENT_STATUS_TONE[inv.paymentStatus]} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{inv.invoiceDate}</span>
                    <Link to={`/invoices/${inv.id}`} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
                      View details →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** UI/UX-07 Part 3: every customer name on the dashboard links to the existing customer statement/account screen — the one that already exists (see CustomersPage's `openCustomerId`), not a new CRM module. */
function CustomerLink({ customerId, name, className = '' }: { customerId: string; name: string; className?: string }) {
  return (
    <Link to={`/customers?openCustomerId=${customerId}`} className={`text-slate-700 hover:text-slate-900 hover:underline ${className}`}>
      {name}
    </Link>
  );
}

function Card({ label, value, money = true }: { label: string; value: string; money?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {money ? <MoneyText value={value} /> : value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionHeading className="text-sm uppercase tracking-wide text-slate-500">{title}</SectionHeading>
      <div className="mt-2">{children}</div>
    </div>
  );
}
