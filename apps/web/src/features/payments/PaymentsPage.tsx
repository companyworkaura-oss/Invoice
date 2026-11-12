import type { Payment, Permission } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { EmptyState, ErrorState, InlineErrorBanner, LoadingState, SuccessBanner, UpdatingIndicator } from '../../lib/AsyncState';
import { deriveListViewState } from '../../lib/list-view-state';
import { useAsyncList } from '../../lib/use-async-list';
import * as paymentsApi from './api';
import { PaymentForm } from './PaymentForm';

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank', cheque: 'Cheque', other: 'Other' };

interface Props {
  permissions: Permission[];
  /** Pre-filters the list to one customer's payments — e.g. when arriving here from an invoice's "View payments" link. */
  initialCustomerId?: string;
}

const DELETE_CONFIRM = 'Delete this payment? The related ledger entry and balances will be updated. This action cannot be undone.';

export function PaymentsPage({ permissions, initialCustomerId }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState(initialCustomerId ?? '');

  const canDelete = permissions.includes('payment.delete');

  // initialCustomerId arrives fresh each time the invoices tab sends us here
  // (e.g. a different invoice's "View payments" link) without remounting
  // this page, so pick it up whenever it actually changes. F10: this must
  // also sync back to "no filter" when initialCustomerId becomes
  // undefined (App clears it on every company switch and logout/login
  // transition) — a one-way "set it if truthy, otherwise leave whatever
  // was there" used to let a previous company's customerFilter value
  // survive inside this component's own state even after the parent's
  // value was cleared, since nothing ever told this effect to clear it
  // too.
  //
  // Adjusted during render rather than in a useEffect — same
  // React-recommended "reset state when a prop changes" pattern as
  // App.tsx's company-change reset: a *state* variable (never a ref —
  // reading one during render is unreliable) tracks the last-seen prop
  // value, and setState is called conditionally, right here, so this
  // settles within the same render the prop changes in instead of an
  // extra commit-then-effect round trip.
  const [lastSeenInitialCustomerId, setLastSeenInitialCustomerId] = useState(initialCustomerId);
  if (lastSeenInitialCustomerId !== initialCustomerId) {
    setLastSeenInitialCustomerId(initialCustomerId);
    setCustomerFilter(initialCustomerId ?? '');
  }

  const {
    data: payments,
    isFetching,
    error,
    retry,
  } = useAsyncList(
    () => paymentsApi.listPayments(customerFilter ? { customerId: customerFilter } : {}),
    [customerFilter],
    'Could not load payments.',
  );

  function refresh() {
    retry();
  }

  const viewState = deriveListViewState(payments, error, Boolean(customerFilter));

  async function handleDelete(payment: Payment) {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setActionError(null);
    setBusyId(payment.id);
    try {
      await paymentsApi.deletePayment(payment.id);
      refresh();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.body.error : 'Could not delete this payment');
    } finally {
      setBusyId(null);
    }
  }

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

      {successMessage && <div className="mt-3"><SuccessBanner message={successMessage} onDismiss={() => setSuccessMessage(null)} /></div>}

      {showForm && (
        <div className="mt-3">
          <PaymentForm
            onRecorded={() => {
              setShowForm(false);
              setSuccessMessage('Payment recorded.');
              refresh();
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      {customerFilter && (
        <p className="mt-2 text-sm text-slate-500">
          Showing payments for one customer.{' '}
          <button type="button" onClick={() => setCustomerFilter('')} className="underline hover:text-slate-900">
            Show all payments
          </button>
        </p>
      )}

      <div className="mt-3">
        {viewState.kind === 'loading' && <LoadingState label="Loading payments…" />}
        {viewState.kind === 'error' && <ErrorState message={viewState.message} onRetry={retry} />}

        {(viewState.kind === 'empty' || viewState.kind === 'no-match' || viewState.kind === 'ready') && (
          <>
            {isFetching && <UpdatingIndicator />}
            {!isFetching && error && <InlineErrorBanner message={error} onRetry={retry} />}

            {viewState.kind === 'no-match' ? (
              <EmptyState message="No payments recorded for this customer." actionLabel="Show all payments" onAction={() => setCustomerFilter('')} />
            ) : viewState.kind === 'empty' ? (
              <EmptyState message="No payments recorded yet." actionLabel="New payment" onAction={() => setShowForm(true)} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-1 pr-2 font-medium">Date</th>
                    <th className="py-1 pr-2 font-medium">Customer</th>
                    <th className="py-1 pr-2 font-medium">Method</th>
                    <th className="py-1 pr-2 font-medium">Reference</th>
                    <th className="py-1 text-right font-medium">Amount</th>
                    {canDelete && <th className="py-1 pl-2 font-medium" />}
                  </tr>
                </thead>
                <tbody>
                  {viewState.items.map((p) => {
                    const busy = busyId === p.id;
                    return (
                      <tr key={p.id} className="border-b border-slate-100">
                        <td className="py-1 pr-2">{p.date}</td>
                        <td className="py-1 pr-2">{p.customerName}</td>
                        <td className="py-1 pr-2 text-slate-500">{METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}</td>
                        <td className="py-1 pr-2 text-slate-500">{p.reference ?? '—'}</td>
                        <td className="py-1 text-right">{p.amount}</td>
                        {canDelete && (
                          <td className="py-1 pl-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDelete(p)}
                              disabled={busy}
                              className="text-xs text-red-600 underline disabled:opacity-50"
                            >
                              {busy ? 'Deleting…' : 'Delete'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
