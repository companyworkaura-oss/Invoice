import type { Customer, DiscountType, EmbroideryCategory, InvoiceWithItems } from '@invoice/shared';
import { calculateSets } from '@invoice/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as categoriesApi from '../formulas/api';
import * as ledgerApi from '../ledger/api';
import * as invoicesApi from './api';
import { previewDiscount, previewItemAmount, sumAmounts } from './preview';

interface Props {
  /** Present in edit mode: prefills the form from this draft and saves via PATCH instead of POST. The customer can't be changed. */
  invoice?: InvoiceWithItems;
  onSaved: (invoice: InvoiceWithItems) => void;
  onCancel: () => void;
}

interface ItemRow {
  key: number; // stable React key, independent of array position
  categoryId: string;
  description: string;
  quantity: string; // this row's own quantity, e.g. BAZU=12, FRONT=8 — independent of every other row
  stitches: string;
  rate: string; // blank = use the category's default rate
}

interface FieldErrors {
  customerId?: string;
  discountValue?: string;
  items?: Record<number, { categoryId?: string; quantity?: string; stitches?: string }>;
}

let nextRowKey = 0;
const newRow = (): ItemRow => ({ key: nextRowKey++, categoryId: '', description: '', quantity: '1', stitches: '', rate: '' });

function itemRowFromInvoice(item: InvoiceWithItems['items'][number]): ItemRow {
  return {
    key: nextRowKey++,
    categoryId: item.categoryId ?? '',
    description: item.description ?? '',
    quantity: item.quantity,
    stitches: String(item.stitches),
    rate: item.rate,
  };
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CreateInvoiceForm({ invoice, onSaved, onCancel }: Props) {
  const editing = Boolean(invoice);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<EmbroideryCategory[]>([]);
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? '');
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? todayLocal());
  const [lotNumber, setLotNumber] = useState(invoice?.lotNumber ?? '');
  const [customerLotNumber, setCustomerLotNumber] = useState(invoice?.customerLotNumber ?? '');
  const [billNumber, setBillNumber] = useState(invoice?.billNumber ?? '');
  const [gatePassNumber, setGatePassNumber] = useState(invoice?.gatePassNumber ?? '');
  const [generalQuantity, setGeneralQuantity] = useState(invoice?.generalQuantity ?? '');
  const [showUnitAmount, setShowUnitAmount] = useState(invoice?.showUnitAmount ?? true);
  const [showItemQuantity, setShowItemQuantity] = useState(invoice?.showItemQuantity ?? true);
  const [discountType, setDiscountType] = useState<DiscountType | ''>(invoice?.discountType ?? '');
  const [discountValue, setDiscountValue] = useState(invoice?.discountType ? invoice.discountValue : '');
  const [items, setItems] = useState<ItemRow[]>(() => (invoice ? invoice.items.map(itemRowFromInvoice) : [newRow()]));
  const [previousBalance, setPreviousBalance] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
    categoriesApi.listCategories('active').then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    // Editing: the "previous balance" is the customer's balance immediately
    // before *this* invoice was originally posted — already computed
    // server-side and saved on the invoice itself, since a live ledger
    // fetch here would double-count this invoice's own (still-posted)
    // debit. Creating: nothing exists yet, so the customer's current
    // balance *is* the previous balance for the invoice about to be made.
    if (editing) return;
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
  }, [customerId, editing]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Live preview only, same SUITS_PER_SET business rule the server/print
  // view uses (see @invoice/shared's calculateSets) — General Quantity
  // itself is the saved, authoritative field; Sets is never stored.
  const setsPreview = useMemo(() => calculateSets(generalQuantity), [generalQuantity]);

  // Live preview only — the same formula engine as the server, run
  // client-side purely for feedback. The server recalculates everything
  // from scratch when the invoice is actually saved.
  const previews = useMemo(
    () => items.map((row) => previewItemAmount(categoryById.get(row.categoryId), row.stitches, row.rate, row.quantity)),
    [items, categoryById],
  );
  const subtotal = useMemo(() => sumAmounts(previews.map((p) => p.amount)), [previews]);
  const discountPreview = useMemo(
    () => previewDiscount(subtotal, discountType, discountValue),
    [subtotal, discountType, discountValue],
  );
  const grandTotal = discountPreview.grandTotal;
  const effectivePreviousBalance = editing ? (invoice?.previousBalance ?? '0.00') : (previousBalance ?? '0.00');
  const totalReceivable = useMemo(
    () => sumAmounts([effectivePreviousBalance, grandTotal]),
    [effectivePreviousBalance, grandTotal],
  );
  // Nothing has been paid toward an invoice that doesn't exist yet; a
  // draft being edited may already have a payment applied to it.
  const amountPaid = editing ? (invoice?.amountPaid ?? '0.00') : '0.00';
  const currentBalance = sumAmounts([totalReceivable, `-${amountPaid}`]);

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
    if (discountPreview.error) next.discountValue = discountPreview.error;

    const itemErrors: Record<number, { categoryId?: string; quantity?: string; stitches?: string }> = {};
    items.forEach((row, index) => {
      const rowErrors: { categoryId?: string; quantity?: string; stitches?: string } = {};
      if (!row.categoryId) rowErrors.categoryId = 'Pick a category';
      if (!row.quantity || Number(row.quantity) <= 0) rowErrors.quantity = 'Enter a quantity greater than zero';
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
      const payload = {
        invoiceDate,
        lotNumber: lotNumber || undefined,
        customerLotNumber: customerLotNumber || undefined,
        billNumber: billNumber || undefined,
        gatePassNumber: gatePassNumber || undefined,
        generalQuantity: generalQuantity || undefined,
        showUnitAmount,
        showItemQuantity,
        discountType: discountType || undefined,
        discountValue: discountType ? discountValue || '0' : undefined,
        items: items.map((row) => ({
          categoryId: row.categoryId,
          description: row.description || undefined,
          quantity: row.quantity || undefined,
          stitches: Number(row.stitches),
          rate: row.rate || undefined,
        })),
      };
      const saved = invoice
        ? await invoicesApi.updateInvoice(invoice.id, payload)
        : await invoicesApi.createInvoice({ ...payload, customerId });
      onSaved(saved);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.body.error : 'Something went wrong saving this invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 p-4 md:p-6">
      {/* Header: customer / date / number / internal lot / customer lot */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Customer" error={errors.customerId}>
          {editing ? (
            <input
              disabled
              value={invoice?.customerName ?? ''}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-500"
            />
          ) : (
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
          )}
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
            value={editing ? invoice?.invoiceNumber : 'Assigned when saved'}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-400"
          />
        </Field>

        <Field label="Internal Lot Number">
          <input
            type="text"
            value={lotNumber}
            onChange={(e) => setLotNumber(e.target.value)}
            placeholder="e.g. 79"
            className={inputClass(false)}
          />
        </Field>

        <Field label="Customer Lot Number">
          <input
            type="text"
            value={customerLotNumber}
            onChange={(e) => setCustomerLotNumber(e.target.value)}
            placeholder="e.g. CUST-458"
            className={inputClass(false)}
          />
        </Field>
      </div>

      {/* Invoice Details: Bill Number, Gate Pass Number, General Quantity (+ derived Sets), and the two print display toggles */}
      <div className="mt-4 rounded-md border border-slate-200 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Details</p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Bill Number">
            <input
              type="text"
              value={billNumber}
              onChange={(e) => setBillNumber(e.target.value)}
              placeholder="e.g. 4587"
              className={inputClass(false)}
            />
          </Field>

          <Field label="Gate Pass Number">
            <input
              type="text"
              value={gatePassNumber}
              onChange={(e) => setGatePassNumber(e.target.value)}
              placeholder="e.g. GP-4587"
              className={inputClass(false)}
            />
          </Field>

          <Field label="General Quantity">
            <input
              inputMode="decimal"
              value={generalQuantity}
              onChange={(e) => setGeneralQuantity(e.target.value)}
              placeholder="e.g. 504"
              className={`${inputClass(false)} text-right`}
            />
          </Field>

          <Field label="Sets">
            <input
              disabled
              value={setsPreview ?? '—'}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-sm text-slate-500"
            />
          </Field>
        </div>

        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">Invoice Display</p>
          <div className="mt-1 flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showItemQuantity}
                onChange={(e) => setShowItemQuantity(e.target.checked)}
              />
              Show item quantity
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showUnitAmount}
                onChange={(e) => setShowUnitAmount(e.target.checked)}
              />
              Show unit amount
            </label>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="w-1/4 py-1.5 pr-2 font-medium">Category</th>
              <th className="w-1/4 py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 text-right font-medium">Quantity</th>
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
                        // A category change always replaces the rate with
                        // the newly selected category's default (or clears
                        // it if the selection was cleared) — never keep a
                        // rate left over from the previous category, even
                        // if it was manually edited. Manual edits are only
                        // preserved between category changes, not across
                        // them (see updateItem's Rate <input> onChange).
                        updateItem(index, {
                          categoryId: e.target.value,
                          rate: cat?.defaultRate ?? '',
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
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                      className={`${inputClass(Boolean(rowErrors?.quantity))} text-right`}
                    />
                    {rowErrors?.quantity && <p className="mt-0.5 text-xs text-red-600">{rowErrors.quantity}</p>}
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

      {/* Discount */}
      <div className="mt-6 flex flex-wrap items-end justify-end gap-3">
        <Field label="Discount Type">
          <select
            value={discountType}
            onChange={(e) => {
              const next = e.target.value as DiscountType | '';
              setDiscountType(next);
              if (!next) setDiscountValue('');
            }}
            className={inputClass(false)}
          >
            <option value="">None</option>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed Amount</option>
          </select>
        </Field>
        {discountType && (
          <Field label="Discount" error={errors.discountValue}>
            <input
              inputMode="decimal"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === 'percentage' ? 'e.g. 10' : 'e.g. 500.00'}
              className={`${inputClass(Boolean(errors.discountValue))} text-right`}
            />
          </Field>
        )}
      </div>

      {/* Summary */}
      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <SummaryRow label="Subtotal" value={subtotal} />
          {discountType && (
            <SummaryRow
              label={discountType === 'percentage' ? `Discount (${discountValue || '0'}%)` : 'Discount'}
              value={`-${discountPreview.discountAmount}`}
            />
          )}
          <SummaryRow label="Grand Total" value={grandTotal} />
          <SummaryRow label="Previous Balance" value={effectivePreviousBalance} />
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
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save invoice'}
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
