import type { Customer, DiscountType, InvoiceWithItems, PaymentMethod } from '@invoice/shared';
import { Decimal, calculateSets, formatNumber, roundMoney } from '@invoice/shared';
import { useMemo, useState, useEffect } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as paymentsApi from '../payments/api';
import * as invoicesApi from './api';
import { previewDiscount, sumAmounts } from './preview';

/**
 * A faster, single-purpose UI for the common case (one customer, a
 * handful of items, done). It is a thin frontend layer only — every
 * calculation, save, and the resulting invoice record go through the
 * exact same apis/services as CreateInvoiceForm: createInvoice (same
 * ledger debit, same invoice numbering), updateInvoice when editing,
 * and createPayment (same ledger credit) when "Paid" is checked on
 * create. Nothing here has its own accounting logic, its own totals
 * math, or its own storage — a saved Quick Invoice is a normal invoice
 * row from the moment it's created, and shows up everywhere a normal
 * invoice does (list, ledger, PDF, audit).
 *
 * Unlike CreateInvoiceForm, a Quick Invoice item never goes through a
 * category or the formula engine — each row is just
 * description/quantity/unit price, with lineAmount = quantity *
 * unitPrice. The server (createManualInvoiceItem in
 * apps/api's invoice.service.ts) recalculates that multiplication
 * itself from the saved unitPrice; this preview is never what gets saved.
 *
 * Edit mode (invoice prop present): InvoicesPage routes here — instead
 * of CreateInvoiceForm — only when invoice.invoiceMode === 'quick', so
 * this never has to guess which editor an invoice belongs in. Saving an
 * edit always sends manual (no-categoryId) items, so the server
 * recomputes invoiceMode as 'quick' again — reopening it keeps landing
 * back here, never in the Normal Invoice form.
 */

interface Props {
  /** Present in edit mode: prefills the form from this draft and saves via PATCH instead of POST. The customer can't be changed; there's no "Paid" convenience in edit mode (use the existing "Record a payment" action instead). */
  invoice?: InvoiceWithItems;
  onSaved: (invoice: InvoiceWithItems) => void;
  onCancel: () => void;
}

interface QuickItemRow {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

interface FieldErrors {
  customerId?: string;
  discountValue?: string;
  items?: Record<number, { description?: string; quantity?: string; unitPrice?: string }>;
}

let nextRowKey = 0;
const newRow = (): QuickItemRow => ({
  key: nextRowKey++,
  description: '',
  quantity: '1',
  unitPrice: '',
});

/**
 * A saved manual item's quantity/unitPrice come back from a numeric(12,2)
 * column padded to 2 decimals (e.g. "787871.00") — formatNumber trims
 * that to a clean editable value ("787871") without changing what the
 * number actually is. calculatedUnitAmount is where a manual item's
 * unit price lives (see createManualInvoiceItem) — never `rate`, which
 * is a category-item-only field this form never touches.
 */
function itemRowFromInvoice(item: InvoiceWithItems['items'][number]): QuickItemRow {
  return {
    key: nextRowKey++,
    description: item.description ?? '',
    quantity: formatNumber(item.quantity),
    unitPrice: formatNumber(item.calculatedUnitAmount),
  };
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** quantity * unitPrice, or null while either field isn't a valid positive number yet — never a separate calculation path from what the server redoes on save. */
function previewLineAmount(quantity: string, unitPrice: string): string | null {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  if (!quantity || !Number.isFinite(qty) || qty <= 0) return null;
  if (!unitPrice || !Number.isFinite(price) || price < 0) return null;
  return roundMoney(new Decimal(quantity).times(unitPrice));
}

export function QuickInvoiceForm({ invoice, onSaved, onCancel }: Props) {
  const editing = Boolean(invoice);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? '');
  const [lotNumber, setLotNumber] = useState(invoice?.lotNumber ?? '');
  const [customerLotNumber, setCustomerLotNumber] = useState(invoice?.customerLotNumber ?? '');
  const [billNumber, setBillNumber] = useState(invoice?.billNumber ?? '');
  const [generalQuantity, setGeneralQuantity] = useState(invoice?.generalQuantity ? formatNumber(invoice.generalQuantity) : '');
  const [paid, setPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [items, setItems] = useState<QuickItemRow[]>(() => (invoice ? invoice.items.map(itemRowFromInvoice) : [newRow()]));
  const [discountType, setDiscountType] = useState<DiscountType | ''>(invoice?.discountType ?? '');
  const [discountValue, setDiscountValue] = useState(invoice?.discountType ? formatNumber(invoice.discountValue) : '');
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
  }, []);

  const lineAmounts = useMemo(() => items.map((row) => previewLineAmount(row.quantity, row.unitPrice)), [items]);
  const subtotal = useMemo(() => sumAmounts(lineAmounts), [lineAmounts]);
  const discountPreview = useMemo(
    () => previewDiscount(subtotal, discountType, discountValue),
    [subtotal, discountType, discountValue],
  );
  const grandTotal = discountPreview.grandTotal;
  // Live preview only, same SUITS_PER_SET business rule the server/print
  // view uses — General Quantity itself is the saved, authoritative
  // field; Sets is never stored.
  const setsPreview = useMemo(() => calculateSets(generalQuantity), [generalQuantity]);

  function updateItem(index: number, patch: Partial<QuickItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addItem(focusAfter = false) {
    setItems((rows) => [...rows, newRow()]);
    if (focusAfter) {
      requestAnimationFrame(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>('[data-quick-item-description]');
        inputs[inputs.length - 1]?.focus();
      });
    }
  }

  function removeItem(index: number) {
    setItems((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  function handleUnitPriceKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Enter' && index === items.length - 1) {
      e.preventDefault();
      addItem(true);
    }
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!editing && !customerId) next.customerId = 'Choose a customer';
    if (discountPreview.error) next.discountValue = discountPreview.error;

    const itemErrors: Record<number, { description?: string; quantity?: string; unitPrice?: string }> = {};
    items.forEach((row, index) => {
      const rowErrors: { description?: string; quantity?: string; unitPrice?: string } = {};
      if (!row.description.trim()) rowErrors.description = 'Enter an item description';
      if (!row.quantity || Number(row.quantity) <= 0) rowErrors.quantity = 'Enter a quantity greater than zero';
      if (!row.unitPrice || Number(row.unitPrice) < 0) rowErrors.unitPrice = 'Enter a unit price';
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
      const sharedFields = {
        lotNumber: lotNumber || undefined,
        customerLotNumber: customerLotNumber || undefined,
        billNumber: billNumber || undefined,
        generalQuantity: generalQuantity || undefined,
        notes: notes || undefined,
        discountType: discountType || undefined,
        discountValue: discountType ? discountValue || '0' : undefined,
        // Never categoryId: a manual item is exactly what keeps this
        // invoice's invoiceMode 'quick' on the server (see
        // invoiceModeFromItems in invoice.service.ts) — reopening it
        // after this save lands back in this editor, never
        // CreateInvoiceForm.
        items: items.map((row) => ({
          description: row.description.trim(),
          quantity: row.quantity || undefined,
          unitPrice: row.unitPrice,
        })),
      };

      if (editing && invoice) {
        // Same updateInvoice call CreateInvoiceForm's edit mode makes —
        // the customer can't be reassigned here either. No payment is
        // ever created from an edit; "Record a payment" in
        // InvoiceDetails is the one place that happens.
        const saved = await invoicesApi.updateInvoice(invoice.id, sharedFields);
        onSaved(saved);
        return;
      }

      // Same createInvoice call CreateInvoiceForm makes — same ledger
      // debit, same invoice numbering — just with manual
      // (no-category) items: the server recalculates lineAmount =
      // quantity * unitPrice itself (createManualInvoiceItem) rather
      // than trusting any total from here.
      const saved = await invoicesApi.createInvoice({ ...sharedFields, customerId, invoiceDate: todayLocal() });

      // "Paid" is a convenience: it records a payment immediately after
      // saving, through the exact same createPayment call (and ledger
      // credit) the Payments page and customer ledger panel use — never
      // a special "quick invoice payment" path.
      if (paid) {
        await paymentsApi.createPayment({
          customerId,
          amount: saved.grandTotal,
          date: saved.invoiceDate,
          paymentMethod,
        });
        // `saved`'s amountPaid/currentBalance were computed at the
        // moment of creation, before the payment above existed — refetch
        // so the template view that opens next (and anything printed or
        // downloaded from it) shows the real, ledger-derived figures.
        onSaved(await invoicesApi.getInvoice(saved.id));
        return;
      }

      onSaved(saved);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.body.error : 'Something went wrong saving this invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 p-4 md:p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Customer" error={errors.customerId}>
          {editing ? (
            <input
              disabled
              value={invoice?.customerName ?? ''}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-500"
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

        {!editing && (
          <Field label="Payment Status">
            <div className="flex gap-2">
              <ToggleButton active={!paid} onClick={() => setPaid(false)}>
                Unpaid
              </ToggleButton>
              <ToggleButton active={paid} onClick={() => setPaid(true)}>
                Paid
              </ToggleButton>
            </div>
          </Field>
        )}

        {!editing && paid && (
          <Field label="Payment Method">
            <div className="flex gap-2">
              <ToggleButton active={paymentMethod === 'cash'} onClick={() => setPaymentMethod('cash')}>
                Cash
              </ToggleButton>
              <ToggleButton active={paymentMethod === 'bank'} onClick={() => setPaymentMethod('bank')}>
                Bank
              </ToggleButton>
            </div>
          </Field>
        )}
      </div>

      {/* Invoice Details: Bill Number, General Quantity (+ derived Sets) — same fields CreateInvoiceForm shows, no category/formula controls here */}
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
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-right text-sm text-slate-500"
            />
          </Field>
        </div>
      </div>

      {/* Items — each its own card on mobile, a table on wider screens */}
      <div className="mt-6 space-y-3">
        {items.map((row, index) => {
          const amount = lineAmounts[index];
          const rowErrors = errors.items?.[index];
          return (
            <div key={row.key} className="rounded-md border border-slate-200 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                <Field label="Item / Description" error={rowErrors?.description}>
                  <input
                    data-quick-item-description
                    type="text"
                    value={row.description}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                    className={inputClass(Boolean(rowErrors?.description))}
                  />
                </Field>

                <Field label="Quantity" error={rowErrors?.quantity}>
                  <input
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    className={`${inputClass(Boolean(rowErrors?.quantity))} text-right`}
                  />
                </Field>

                <Field label="Unit Price" error={rowErrors?.unitPrice}>
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={row.unitPrice}
                    onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                    onKeyDown={(e) => handleUnitPriceKeyDown(e, index)}
                    className={`${inputClass(Boolean(rowErrors?.unitPrice))} text-right`}
                  />
                </Field>

                <Field label="Amount">
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={amount ? formatNumber(amount) : ''}
                    placeholder="0.00"
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-right text-sm text-slate-700"
                  />
                </Field>
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length === 1}
                  aria-label="Remove item"
                  className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => addItem()}
        className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        + Add Item
      </button>

      {/* Discount */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
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

      <div className="mt-4">
        <Field label="Notes">
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass(false)}
          />
        </Field>
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
          <SummaryRow label="Grand Total" value={grandTotal} emphasize />
        </dl>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save Invoice'}
        </button>
      </div>
    </form>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full rounded-md border px-2 py-2 text-sm focus:outline-none ${
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

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
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
