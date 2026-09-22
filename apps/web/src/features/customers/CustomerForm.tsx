import type { Customer } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import * as customersApi from './api';

interface Props {
  customer?: Customer; // present when editing, absent when creating
  onSaved: (customer: Customer) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  businessName: string;
  phone: string;
  whatsapp: string;
  address: string;
  openingBalance: string;
  notes: string;
}

function toFormState(customer?: Customer): FormState {
  return {
    name: customer?.name ?? '',
    businessName: customer?.businessName ?? '',
    phone: customer?.phone ?? '',
    whatsapp: customer?.whatsapp ?? '',
    address: customer?.address ?? '',
    openingBalance: customer?.openingBalance ?? '',
    notes: customer?.notes ?? '',
  };
}

export function CustomerForm({ customer, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(customer));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const patch: customersApi.CustomerPatch = {
        name: form.name,
        businessName: form.businessName || undefined,
        phone: form.phone || undefined,
        whatsapp: form.whatsapp || undefined,
        address: form.address || undefined,
        openingBalance: form.openingBalance || undefined,
        notes: form.notes || undefined,
      };
      const saved = customer
        ? await customersApi.updateCustomer(customer.id, patch)
        : await customersApi.createCustomer({ name: form.name, ...patch });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{customer ? 'Edit customer' : 'New customer'}</h3>
      <div>
        <label htmlFor="cust-name" className="block text-xs font-medium text-slate-500">
          Name
        </label>
        <input
          id="cust-name"
          required
          value={form.name}
          onChange={(e) => field('name', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="cust-business" className="block text-xs font-medium text-slate-500">
          Business name
        </label>
        <input
          id="cust-business"
          value={form.businessName}
          onChange={(e) => field('businessName', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cust-phone" className="block text-xs font-medium text-slate-500">
            Phone
          </label>
          <input
            id="cust-phone"
            value={form.phone}
            onChange={(e) => field('phone', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="cust-whatsapp" className="block text-xs font-medium text-slate-500">
            WhatsApp
          </label>
          <input
            id="cust-whatsapp"
            value={form.whatsapp}
            onChange={(e) => field('whatsapp', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label htmlFor="cust-address" className="block text-xs font-medium text-slate-500">
          Address
        </label>
        <textarea
          id="cust-address"
          rows={2}
          value={form.address}
          onChange={(e) => field('address', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="cust-balance" className="block text-xs font-medium text-slate-500">
          Opening balance
        </label>
        <input
          id="cust-balance"
          inputMode="decimal"
          placeholder="0.00"
          disabled={Boolean(customer)}
          value={form.openingBalance}
          onChange={(e) => field('openingBalance', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
        />
      </div>
      <div>
        <label htmlFor="cust-notes" className="block text-xs font-medium text-slate-500">
          Notes
        </label>
        <textarea
          id="cust-notes"
          rows={2}
          value={form.notes}
          onChange={(e) => field('notes', e.target.value)}
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
          {saving ? 'Saving…' : 'Save'}
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
