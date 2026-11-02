import type { Customer, DiscountType, EmbroideryCategory, InvoiceWithItems } from '@invoice/shared';
import { calculateSets, formatNumber } from '@invoice/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useCurrentIdentity } from '../../lib/use-current-identity';
import { useDirtyFormGuard } from '../../lib/use-dirty-form-guard';
import * as customersApi from '../customers/api';
import * as categoriesApi from '../formulas/api';
import * as ledgerApi from '../ledger/api';
import * as invoicesApi from './api';
import { CollapsibleSection } from './CollapsibleSection';
import { buildCreateInvoicePayload, isStandardDraftMeaningful, type StandardInvoiceDraftData } from './create-invoice-payload';
import { clearInvoiceDraft, loadInvoiceDraft, saveInvoiceDraft } from './invoice-draft';
import { DraftRecoveryBanner } from './DraftRecoveryBanner';
import { previewDiscount, previewItemAmount, sumAmounts } from './preview';

const DRAFT_SAVE_DEBOUNCE_MS = 500;

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
    quantity: formatNumber(item.quantity),
    stitches: String(item.stitches),
    rate: formatNumber(item.rate),
  };
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The current form state, shaped for draft storage/dirty comparison — `key` (a React-only identity, never meaningful content) is stripped from every item row. */
function currentDraftData(form: {
  customerId: string;
  invoiceDate: string;
  lotNumber: string;
  customerLotNumber: string;
  billNumber: string;
  gatePassNumber: string;
  generalQuantity: string;
  showUnitAmount: boolean;
  showItemQuantity: boolean;
  showItemAmount: boolean;
  showBillNumber: boolean;
  discountType: DiscountType | '';
  discountValue: string;
  items: ItemRow[];
}): StandardInvoiceDraftData {
  return { ...form, items: form.items.map(({ key: _key, ...rest }) => rest) };
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
  const [generalQuantity, setGeneralQuantity] = useState(invoice?.generalQuantity ? formatNumber(invoice.generalQuantity) : '');
  const [showUnitAmount, setShowUnitAmount] = useState(invoice?.showUnitAmount ?? true);
  const [showItemQuantity, setShowItemQuantity] = useState(invoice?.showItemQuantity ?? true);
  const [showItemAmount, setShowItemAmount] = useState(invoice?.showItemAmount ?? true);
  const [showBillNumber, setShowBillNumber] = useState(invoice?.showBillNumber ?? true);
  const [discountType, setDiscountType] = useState<DiscountType | ''>(invoice?.discountType ?? '');
  const [discountValue, setDiscountValue] = useState(invoice?.discountType ? formatNumber(invoice.discountValue) : '');
  const [items, setItems] = useState<ItemRow[]>(() => (invoice ? invoice.items.map(itemRowFromInvoice) : [newRow()]));
  const [previousBalance, setPreviousBalance] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // UI/UX-03 Part 4: scoped to this exact user/company — see
  // invoice-draft.ts. `editing` never reads or writes a draft at all:
  // an existing invoice already persists server-side the moment it's
  // saved, so there's nothing client-side to recover.
  const identity = useCurrentIdentity();
  const [draftChecked, setDraftChecked] = useState(editing);
  const [pendingDraft, setPendingDraft] = useState<{ savedAt: string; data: StandardInvoiceDraftData } | null>(null);
  // Captured once, at mount, from whatever the form's initial values
  // already were (blank when creating, the invoice's own values when
  // editing) — compared against the live, current values below to
  // decide `isDirty`. Resuming a draft after this snapshot is taken
  // correctly ends up "dirty": there is now unsaved work to protect,
  // even though the user didn't type any of it themselves just now.
  const [pristineSnapshot] = useState(() =>
    JSON.stringify(currentDraftData({ customerId, invoiceDate, lotNumber, customerLotNumber, billNumber, gatePassNumber, generalQuantity, showUnitAmount, showItemQuantity, showItemAmount, showBillNumber, discountType, discountValue, items })),
  );

  useEffect(() => {
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
    categoriesApi.listCategories('active').then(setCategories).catch(() => setCategories([]));
  }, []);

  // One-time check for a recoverable draft, as soon as we know who's
  // asking — never auto-applied; see DraftRecoveryBanner.
  useEffect(() => {
    if (editing || !identity || draftChecked) return;
    const envelope = loadInvoiceDraft<StandardInvoiceDraftData>(identity.userId, identity.companyId, 'standard');
    if (envelope && isStandardDraftMeaningful(envelope.data)) {
      setPendingDraft({ savedAt: envelope.savedAt, data: envelope.data });
    }
    setDraftChecked(true);
  }, [editing, identity, draftChecked]);

  // Auto-save, debounced — skipped entirely while a recovered draft
  // is still awaiting a Resume/Discard decision, so it's never
  // silently overwritten with the (still blank) live form before the
  // user has chosen.
  useEffect(() => {
    if (editing || !identity || !draftChecked || pendingDraft) return;
    const data = currentDraftData({ customerId, invoiceDate, lotNumber, customerLotNumber, billNumber, gatePassNumber, generalQuantity, showUnitAmount, showItemQuantity, showItemAmount, showBillNumber, discountType, discountValue, items });
    const timer = setTimeout(() => {
      if (isStandardDraftMeaningful(data)) {
        saveInvoiceDraft(identity.userId, identity.companyId, 'standard', data);
      } else {
        clearInvoiceDraft(identity.userId, identity.companyId, 'standard');
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editing,
    identity,
    draftChecked,
    pendingDraft,
    customerId,
    invoiceDate,
    lotNumber,
    customerLotNumber,
    billNumber,
    gatePassNumber,
    generalQuantity,
    showUnitAmount,
    showItemQuantity,
    showItemAmount,
    showBillNumber,
    discountType,
    discountValue,
    items,
  ]);

  function resumeDraft() {
    if (!pendingDraft) return;
    const d = pendingDraft.data;
    setCustomerId(d.customerId);
    setInvoiceDate(d.invoiceDate);
    setLotNumber(d.lotNumber);
    setCustomerLotNumber(d.customerLotNumber);
    setBillNumber(d.billNumber);
    setGatePassNumber(d.gatePassNumber);
    setGeneralQuantity(d.generalQuantity);
    setShowUnitAmount(d.showUnitAmount);
    setShowItemQuantity(d.showItemQuantity);
    setShowItemAmount(d.showItemAmount);
    setShowBillNumber(d.showBillNumber);
    setDiscountType(d.discountType);
    setDiscountValue(d.discountValue);
    setItems(d.items.length > 0 ? d.items.map((item) => ({ ...item, key: nextRowKey++ })) : [newRow()]);
    setPendingDraft(null);
  }

  function discardDraft() {
    if (identity) clearInvoiceDraft(identity.userId, identity.companyId, 'standard');
    setPendingDraft(null);
  }

  // UI/UX-03 Part 7: untouched (still equal to the pristine snapshot)
  // or still waiting on a draft decision never warns; editing *or*
  // resuming a draft does.
  const isDirty =
    !pendingDraft &&
    JSON.stringify(
      currentDraftData({ customerId, invoiceDate, lotNumber, customerLotNumber, billNumber, gatePassNumber, generalQuantity, showUnitAmount, showItemQuantity, showItemAmount, showBillNumber, discountType, discountValue, items }),
    ) !== pristineSnapshot;
  const { confirmLeaveIfDirty } = useDirtyFormGuard(isDirty, 'You have unsaved invoice changes. Leave without saving?');

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

  // UI/UX-02: "Job details" opens by default whenever editing a draft
  // that already has one of these fields saved — a user editing an
  // invoice that already carries a lot number shouldn't have to find
  // and click to reveal it. A brand-new invoice starts collapsed, so
  // the billing workflow (customer, items, totals) is what a user
  // scrolls into first.
  const jobDetailsHasValue = Boolean(lotNumber || customerLotNumber || billNumber || gatePassNumber || generalQuantity);

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
      const payload = buildCreateInvoicePayload({
        invoiceDate,
        lotNumber,
        customerLotNumber,
        billNumber,
        gatePassNumber,
        generalQuantity,
        showUnitAmount,
        showItemQuantity,
        showItemAmount,
        showBillNumber,
        discountType,
        discountValue,
        items,
      });
      const saved = invoice
        ? await invoicesApi.updateInvoice(invoice.id, payload)
        : await invoicesApi.createInvoice({ ...payload, customerId });
      // UI/UX-03 Part 6: a successful save clears this user/company's
      // Standard Invoice draft — there's nothing left to recover.
      if (!editing && identity) clearInvoiceDraft(identity.userId, identity.companyId, 'standard');
      onSaved(saved);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.body.error : 'Something went wrong saving this invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-slate-200 p-4 md:p-6">
      {pendingDraft && <DraftRecoveryBanner savedAt={pendingDraft.savedAt} onResume={resumeDraft} onDiscard={discardDraft} />}

      {/*
        UI/UX-02 — Section 1: Customer. Kept deliberately small (just
        customer/date/the auto-generated invoice number) so Work Items
        below is the next thing a user reaches, on mobile especially —
        Internal/Customer Lot Number used to sit right here; they now
        live in the Job Details section below Work Items instead.
      */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </div>

      {/* UI/UX-02 — Section 2: Work Items, the main visual focus, immediately after Customer. */}
      <div className="mt-4 overflow-x-auto">
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
                      title="Pre-filled from the category's default rate — editable per invoice item"
                      value={row.rate}
                      onChange={(e) => updateItem(index, { rate: e.target.value })}
                      onKeyDown={(e) => handleRateKeyDown(e, index)}
                      className={`${inputClass(false)} text-right`}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
                    {preview.amount ? formatNumber(preview.amount) : preview.error ? <span className="text-red-600">—</span> : '—'}
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

      {/* UI/UX-02 — Section 3: Discount & Totals, directly below Work Items. */}
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

      {/*
        UI/UX-02 — Section 4: Job Details, visually secondary and
        collapsible — same fields that used to sit above Work Items.
        Nothing here is deleted or renamed; CollapsibleSection never
        unmounts its children, so toggling this open/closed can never
        clear anything typed into it.
      */}
      <CollapsibleSection
        title="Job details"
        summary="Lot numbers, bill number, gate pass, general quantity"
        defaultOpen={jobDetailsHasValue}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </CollapsibleSection>

      {/*
        UI/UX-02 — Section 5: Print options — display-only toggles,
        kept visually separate from every accounting input above.
      */}
      <CollapsibleSection title="Print options" summary="Bill number, item quantity, unit amount, item amount">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={showBillNumber} onChange={(e) => setShowBillNumber(e.target.checked)} />
            Show Bill Number
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={showItemQuantity} onChange={(e) => setShowItemQuantity(e.target.checked)} />
            Show item quantity
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={showUnitAmount} onChange={(e) => setShowUnitAmount(e.target.checked)} />
            Show unit amount
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={showItemAmount} onChange={(e) => setShowItemAmount(e.target.checked)} />
            Show item amount
          </label>
        </div>
      </CollapsibleSection>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      {/* UI/UX-02: one prominent primary action ("Create invoice"); Cancel stays visually lighter (outline only). */}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            // UI/UX-03 Part 7/8: never leave unsaved work behind
            // without asking, and never let Cancel be clicked while a
            // save is already in flight (avoids any doubt over
            // whether the invoice ended up saved or not).
            if (confirmLeaveIfDirty()) onCancel();
          }}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create invoice'}
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
      <dd className={emphasize ? 'font-semibold text-slate-900' : 'text-slate-700'}>{formatNumber(value)}</dd>
    </div>
  );
}
