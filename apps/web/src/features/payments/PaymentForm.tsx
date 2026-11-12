import type { Customer, Payment, PaymentMethod } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { EMPTY_LIST, useAsyncList } from '../../lib/use-async-list';
import { FormField, PrimaryButton, SecondaryButton, SectionHeading } from '../../lib/ui';
import { FIELD_INPUT_CLASS } from '../../lib/ui-tokens';
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
  const customersList = useAsyncList(
    () => (customerId ? Promise.resolve<Customer[]>([]) : customersApi.listCustomers({ status: 'active' })),
    [customerId],
    'Could not load customers.',
  );
  const customers = customersList.data ?? EMPTY_LIST;
  const [selectedCustomerId, setSelectedCustomerId] = useState(customerId ?? '');
  const [amount, setAmount] = useState(suggestedAmount ?? '');
  const [date, setDate] = useState(todayLocal);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-slate-200 p-4 sm:p-5">
      <div>
        <SectionHeading>{title}</SectionHeading>
        {helperText && <p className="mt-1 text-sm text-slate-500">{helperText}</p>}
      </div>

      {!customerId && (
        <FormField label="Customer" htmlFor="pay-customer">
          <select
            id="pay-customer"
            required
            disabled={customersList.data === null}
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
            className={FIELD_INPUT_CLASS}
          >
            <option value="">
              {customersList.data === null
                ? customersList.error
                  ? 'Could not load customers'
                  : 'Loading customers…'
                : customers.length === 0
                  ? 'No customers available'
                  : 'Select…'}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {customersList.error && (
            <p className="mt-1 text-xs text-red-600">
              {customersList.error}{' '}
              <button type="button" onClick={customersList.retry} className="underline hover:text-red-900">
                Retry
              </button>
            </p>
          )}
        </FormField>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Amount"
          htmlFor="pay-amount"
          helperText={suggestedAmount !== undefined ? suggestedAmountLabel : undefined}
        >
          <input
            id="pay-amount"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>
        <FormField label="Date" htmlFor="pay-date">
          <input
            id="pay-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Payment method" htmlFor="pay-method">
          <select
            id="pay-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className={FIELD_INPUT_CLASS}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reference" htmlFor="pay-reference" optional>
          <input
            id="pay-reference"
            placeholder="Cheque no., transaction id…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="pay-notes" optional>
        <textarea
          id="pay-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <PrimaryButton
          type="submit"
          disabled={saving || (!customerId && customersList.data === null)}
          title={!customerId && customersList.data === null ? 'Waiting for customers to load' : undefined}
        >
          {saving ? 'Recording…' : 'Record payment'}
        </PrimaryButton>
        {onCancel && <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>}
      </div>
    </form>
  );
}
