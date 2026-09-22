import type { Customer, EmbroideryCategory, InvoiceWithItems } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from '../customers/api';
import * as categoriesApi from '../formulas/api';
import * as invoicesApi from './api';

interface Props {
  onCreated: (invoice: InvoiceWithItems) => void;
  onCancel: () => void;
}

interface ItemRow {
  categoryId: string;
  description: string;
  stitches: string;
  rate: string; // blank = use the category's default rate
}

const emptyItem: ItemRow = { categoryId: '', description: '', stitches: '', rate: '' };

export function CreateInvoiceForm({ onCreated, onCancel }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<EmbroideryCategory[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ ...emptyItem }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customersApi.listCustomers({ status: 'active' }).then(setCustomers).catch(() => setCustomers([]));
    categoriesApi.listCategories('active').then(setCategories).catch(() => setCategories([]));
  }, []);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addItem() {
    setItems((rows) => [...rows, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const invoice = await invoicesApi.createInvoice({
        customerId,
        invoiceDate: invoiceDate || undefined,
        quantity,
        notes: notes || undefined,
        items: items.map((row) => ({
          categoryId: row.categoryId,
          description: row.description || undefined,
          stitches: Number(row.stitches),
          rate: row.rate || undefined,
        })),
      });
      onCreated(invoice);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">New invoice</h3>
      <p className="text-xs text-slate-500">
        Amounts are calculated by the server from each category&apos;s formula when you save — nothing shown here
        until then is final.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="inv-customer" className="block text-xs font-medium text-slate-500">
            Customer
          </label>
          <select
            id="inv-customer"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="" disabled>
              Select a customer…
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inv-date" className="block text-xs font-medium text-slate-500">
            Invoice date
          </label>
          <input
            id="inv-date"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="inv-quantity" className="block text-xs font-medium text-slate-500">
          Quantity (pieces this invoice covers)
        </label>
        <input
          id="inv-quantity"
          required
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="mt-1 w-32 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500">Items</p>
        <div className="mt-1 space-y-2">
          {items.map((row, index) => (
            <div key={index} className="grid grid-cols-12 items-start gap-2 rounded-md border border-slate-100 p-2">
              <select
                required
                value={row.categoryId}
                onChange={(e) => updateItem(index, { categoryId: e.target.value })}
                className="col-span-4 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              >
                <option value="" disabled>
                  Category…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Description (optional)"
                value={row.description}
                onChange={(e) => updateItem(index, { description: e.target.value })}
                className="col-span-3 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              />
              <input
                required
                inputMode="numeric"
                placeholder="Stitches"
                value={row.stitches}
                onChange={(e) => updateItem(index, { stitches: e.target.value })}
                className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              />
              <input
                inputMode="decimal"
                placeholder="Rate override"
                value={row.rate}
                onChange={(e) => updateItem(index, { rate: e.target.value })}
                className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={items.length === 1}
                className="col-span-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addItem}
          className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Add item
        </button>
      </div>

      <div>
        <label htmlFor="inv-notes" className="block text-xs font-medium text-slate-500">
          Notes
        </label>
        <textarea
          id="inv-notes"
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
          {saving ? 'Saving…' : 'Create invoice'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
