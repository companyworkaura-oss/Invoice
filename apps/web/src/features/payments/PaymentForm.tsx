import type { Customer, Payment, PaymentMethod } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as paymentsApi from './api';

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  /** Fixed when recording from a customer or invoice page; omitted (and picked from a list) on the Payments page. */
  customerId?: string;
  /** Pre-fills the amount — still editable, so partial payments stay easy. */
  suggestedAmount?: string;
  /**
   * UI/UX-01: what `suggestedAmount` actually represents, shown right
   * under the Amount field whenever a suggestion is pre-filled — e.g.
   * "Customer's full outstanding account balance (all unpaid
   * invoices), not just this invoice." Callers that pre-fill an
   * amount must say what it is; this is never shown if
   * `suggestedAmount` isn't set.
   */
  suggestedAmountLabel?: string;
  /** Defaults to "Record a payment" — e.g. InvoiceDetails uses "Record customer payment" to make clear this isn't scoped to one invoice. */
  title?: string;
  /** Optional context shown under the title — e.g. the oldest-debt-first allocation note on InvoiceDetails. */
  helperText?: string;
  onRecorded: (payment: Payment) => void;
  onCancel?: () => void;
}

export function PaymentForm({
  customerId,
  suggestedAmount,
  suggestedAmountLabel,
  title = 'Record a payment',
  helperText,
  onRecorded,
  onCancel,
}: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(customerId ?? '');
  const [amount, setAmount] = useState(suggestedAmount ?? '');
  const [date, setDate] = useState(todayLocal);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customerId) return; // fixed customer — no need to fetch a list to pick from
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
  }, [customerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payment = await paymentsApi.createPayment({
        customerId: customerId ?? selectedCustomerId,
        amount,
        date,
        paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      onRecorded(payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {helperText && <p className="mt-0.5 text-xs text-slate-500">{helperText}</p>}
      </div>

      {!customerId && (
        <div>
          <label htmlFor="pay-customer" className="block text-xs font-medium text-slate-500">
            Customer
          </label>
          <select
            id="pay-customer"
            required
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">Select…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pay-amount" className="block text-xs font-medium text-slate-500">
            Amount
          </label>
          <input
            id="pay-amount"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
          {suggestedAmount !== undefined && suggestedAmountLabel && (
            <p className="mt-1 text-xs text-slate-500">{suggestedAmountLabel}</p>
          )}
        </div>
        <div>
          <label htmlFor="pay-date" className="block text-xs font-medium text-slate-500">
            Date
          </label>
          <input
            id="pay-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pay-method" className="block text-xs font-medium text-slate-500">
            Payment method
          </label>
          <select
            id="pay-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pay-reference" className="block text-xs font-medium text-slate-500">
            Reference
          </label>
          <input
            id="pay-reference"
            placeholder="Cheque no., transaction id…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="pay-notes" className="block text-xs font-medium text-slate-500">
          Notes
        </label>
        <textarea
          id="pay-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Recording…' : 'Record payment'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
