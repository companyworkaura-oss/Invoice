import type { Customer, EmbroideryCategory, InvoiceWithItems } from '@invoice/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as categoriesApi from '../formulas/api';
import * as ledgerApi from '../ledger/api';
import * as invoicesApi from './api';
import { previewItemAmount, sumAmounts } from './preview';

interface Props {
  onCreated: (invoice: InvoiceWithItems) => void;
  onCancel: () => void;
}

interface ItemRow {
  key: number; // stable React key, independent of array position
  categoryId: string;
  description: string;
  stitches: string;
  rate: string; // blank = use the category's default rate
}

interface FieldErrors {
  customerId?: string;
  quantity?: string;
  items?: Record<number, { categoryId?: string; stitches?: string }>;
}

let nextRowKey = 0;
const newRow = (): ItemRow => ({ key: nextRowKey++, categoryId: '', description: '', stitches: '', rate: '' });

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CreateInvoiceForm({ onCreated, onCancel }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<EmbroideryCategory[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayLocal);
  const [quantity, setQuantity] = useState('1');
  const [items, setItems] = useState<ItemRow[]>([newRow()]);
  const [previousBalance, setPreviousBalance] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
    categoriesApi.listCategories('active').then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    ledgerApi
      .getLedger(customerId)
      .then((ledger) => {
        if (!cancelled) setPreviousBalance(ledger.balance);
      })
      .catch(() => {
        if (!cancelled) setPreviousBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Live preview only — the same formula engine as the server, run
  // client-side purely for feedback. The server recalculates everything
  // from scratch when the invoice is actually saved.
  const previews = useMemo(
    () => items.map((row) => previewItemAmount(categoryById.get(row.categoryId), row.stitches, row.rate, quantity)),
    [items, categoryById, quantity],
  );
  const currentBill = useMemo(() => sumAmounts(previews.map((p) => p.amount)), [previews]);
  const totalReceivable = useMemo(
    () => sumAmounts([previousBalance ?? '0.00', currentBill]),
    [previousBalance, currentBill],
  );
  // Nothing has been paid toward an invoice that doesn't exist yet.
  const amountPaid = '0.00';
  const currentBalance = totalReceivable;

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addItem(focusAfter = false) {
    setItems((rows) => [...rows, newRow()]);
    if (focusAfter) {
      // The new row's category <select> is the natural next stop after
      // Enter in the last row's Rate field — focus it once it mounts.
      requestAnimationFrame(() => {
        const selects = document.querySelectorAll<HTMLSelectElement>('[data-item-category]');
        selects[selects.length - 1]?.focus();
      });
    }
  }

  function removeItem(index: number) {
    setItems((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  function handleRateKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' && index === items.length - 1) {
      e.preventDefault();
      addItem(true);
    }
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!customerId) next.customerId = 'Choose a customer';
    if (!quantity || Number(quantity) <= 0) next.quantity = 'Enter a quantity greater than zero';

    const itemErrors: Record<number, { categoryId?: string; stitches?: string }> = {};
    items.forEach((row, index) => {
      const rowErrors: { categoryId?: string; stitches?: string } = {};
      if (!row.categoryId) rowErrors.categoryId = 'Pick a category';
      const stitches = Number(row.stitches);
      if (!row.stitches || !Number.isInteger(stitches) || stitches <= 0) {
        rowErrors.stitches = 'Whole number greater than zero';
      }
      if (Object.keys(rowErrors).length > 0) itemErrors[index] = rowErrors;
    });
    if (Object.keys(itemErrors).length > 0) next.items = itemErrors;

    return next;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSaving(true);
    try {
      const invoice = await invoicesApi.createInvoice({
        customerId,
        invoiceDate,
        quantity,
        items: items.map((row) => ({
          categoryId: row.categoryId,
          description: row.description || undefined,
          stitches: Number(row.stitches),
          rate: row.rate || undefined,
        })),
      });
      onCreated(invoice);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.body.error : 'Something went wrong saving this invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 p-4 md:p-6">
      {/* Header: customer / date / number / quantity */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Customer" error={errors.customerId}>
          <select
            autoFocus
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass(Boolean(errors.customerId))}
          >
            <option value="">Select…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Invoice date">
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={inputClass(false)}
          />
        </Field>

        <Field label="Invoice number">
          <input
            disabled
            value="Assigned when saved"
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-400"
          />
        </Field>

        <Field label="Quantity" error={errors.quantity}>
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass(Boolean(errors.quantity))}
          />
        </Field>
      </div>

      {/* Items */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="w-1/4 py-1.5 pr-2 font-medium">Category</th>
              <th className="w-1/4 py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 text-right font-medium">Stitches</th>
              <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
              <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
              <th className="w-8 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => {
              const category = categoryById.get(row.categoryId);
              const preview = previews[index];
              const rowErrors = errors.items?.[index];
              return (
                <tr key={row.key} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2">
                    <select
                      data-item-category
                      value={row.categoryId}
                      onChange={(e) => {
                        const cat = categoryById.get(e.target.value);
                        // Pre-fill the rate from the category's default,
                        // but only if the field is still untouched.
                        updateItem(index, {
                          categoryId: e.target.value,
                          rate: row.rate || cat?.defaultRate || '',
                        });
                      }}
                      className={inputClass(Boolean(rowErrors?.categoryId))}
                    >
                      <option value="">Select…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {rowErrors?.categoryId && <p className="mt-0.5 text-xs text-red-600">{rowErrors.categoryId}</p>}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                      className={inputClass(false)}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      inputMode="numeric"
                      value={row.stitches}
                      onChange={(e) => updateItem(index, { stitches: e.target.value })}
                      className={`${inputClass(Boolean(rowErrors?.stitches))} text-right`}
                    />
                    {rowErrors?.stitches && <p className="mt-0.5 text-xs text-red-600">{rowErrors.stitches}</p>}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      inputMode="decimal"
                      placeholder={category?.defaultRate ?? ''}
                      value={row.rate}
                      onChange={(e) => updateItem(index, { rate: e.target.value })}
                      onKeyDown={(e) => handleRateKeyDown(e, index)}
                      className={`${inputClass(false)} text-right`}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
                    {preview.amount ?? (preview.error ? <span className="text-red-600">—</span> : '—')}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={items.length === 1}
                      aria-label="Remove"
                      className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => addItem()}
        className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        + Add Work
      </button>

      {/* Summary */}
      <div className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <SummaryRow label="Current Bill" value={currentBill} />
          <SummaryRow label="Previous Balance" value={previousBalance ?? '0.00'} />
          <SummaryRow label="Total Receivable" value={totalReceivable} />
          <SummaryRow label="Amount Paid" value={amountPaid} />
          <SummaryRow label="Current Balance" value={currentBalance} emphasize />
        </dl>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save invoice'}
        </button>
      </div>
    </form>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none ${
    hasError ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-slate-500'
  }`;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500">
        {label}
        <div className="mt-1">{children}</div>
      </label>
      {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function SummaryRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={emphasize ? 'font-semibold text-slate-900' : 'text-slate-500'}>{label}</dt>
      <dd className={emphasize ? 'font-semibold text-slate-900' : 'text-slate-700'}>{value}</dd>
    </div>
  );
}
