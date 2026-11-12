import type { Customer } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { buildFormPatch } from '../../lib/form-patch';
import { FormField, PrimaryButton, SecondaryButton, SectionHeading } from '../../lib/ui';
import { FIELD_INPUT_CLASS } from '../../lib/ui-tokens';
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
  // F12: the snapshot `form` started from — the one thing that tells
  // "this field is still blank because nobody touched it" (omit, leave
  // unchanged server-side) apart from "this field used to have a
  // value and the user just cleared it" (send null, so the server
  // actually clears it). Only meaningful in edit mode — a brand-new
  // customer has no "original" to diff against, so create keeps its
  // own simpler blank-means-omit rule below.
  const [original] = useState<FormState>(() => toFormState(customer));
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
      const { openingBalance: _formOpeningBalance, ...editableForm } = form;
      const { openingBalance: _originalOpeningBalance, ...editableOriginal } = original;
      const saved = customer
        ? await customersApi.updateCustomer(
            customer.id,
            buildFormPatch<customersApi.CustomerPatch>(editableForm, editableOriginal),
          )
        : await customersApi.createCustomer({
            name: form.name,
            businessName: form.businessName || undefined,
            phone: form.phone || undefined,
            whatsapp: form.whatsapp || undefined,
            address: form.address || undefined,
            openingBalance: form.openingBalance || undefined,
            notes: form.notes || undefined,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-slate-200 p-4 sm:p-5">
      <SectionHeading>{customer ? 'Edit customer' : 'New customer'}</SectionHeading>

      <FormField label="Name" htmlFor="cust-name">
        <input
          id="cust-name"
          required
          value={form.name}
          onChange={(e) => field('name', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <FormField label="Business name" htmlFor="cust-business" optional>
        <input
          id="cust-business"
          value={form.businessName}
          onChange={(e) => field('businessName', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Phone" htmlFor="cust-phone" optional>
          <input
            id="cust-phone"
            value={form.phone}
            onChange={(e) => field('phone', e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>

        <FormField label="WhatsApp" htmlFor="cust-whatsapp" optional>
          <input
            id="cust-whatsapp"
            value={form.whatsapp}
            onChange={(e) => field('whatsapp', e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>
      </div>

      <FormField label="Address" htmlFor="cust-address" optional>
        <textarea
          id="cust-address"
          rows={2}
          value={form.address}
          onChange={(e) => field('address', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <FormField
        label="Opening balance"
        htmlFor="cust-balance"
        optional
        helperText={customer ? 'Set once, when the customer was created — not editable afterward.' : undefined}
      >
        <input
          id="cust-balance"
          inputMode="decimal"
          placeholder="0.00"
          disabled={Boolean(customer)}
          value={form.openingBalance}
          onChange={(e) => field('openingBalance', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <FormField label="Notes" htmlFor="cust-notes" optional>
        <textarea
          id="cust-notes"
          rows={2}
          value={form.notes}
          onChange={(e) => field('notes', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    </form>
  );
}
