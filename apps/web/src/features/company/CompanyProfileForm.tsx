import type { CompanyProfile } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { INVOICE_TEMPLATES } from '../invoices/templates/registry';
import * as companyApi from './api';

interface Props {
  profile: CompanyProfile;
  canEdit: boolean;
  onSaved: (profile: CompanyProfile) => void;
}

type FormState = Record<string, string>;

const FIELDS: {
  key: keyof companyApi.ProfilePatch;
  label: string;
  type?: string;
  textarea?: boolean;
  options?: { value: string; label: string }[];
}[] = [
  { key: 'name', label: 'Company name' },
  { key: 'factoryName', label: 'Factory name' },
  { key: 'ownerName', label: 'Owner name' },
  { key: 'phone', label: 'Phone' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: 'Address', textarea: true },
  { key: 'taxNumber', label: 'Tax number' },
  { key: 'invoicePrefix', label: 'Invoice prefix' },
  { key: 'defaultCurrency', label: 'Default currency (3-letter code)' },
  {
    key: 'defaultInvoiceTemplate',
    label: 'Default invoice template',
    options: INVOICE_TEMPLATES.map((t) => ({ value: t.id, label: t.label })),
  },
  { key: 'invoiceTerms', label: 'Invoice terms', textarea: true },
];

function toFormState(profile: CompanyProfile): FormState {
  const state: FormState = {};
  for (const { key } of FIELDS) state[key] = (profile[key as keyof CompanyProfile] ?? '') as string;
  return state;
}

export function CompanyProfileForm({ profile, canEdit, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(profile));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // Only send fields that actually have a value. The server treats a
      // present-but-blank optional field (e.g. email: "") as someone
      // trying to set it to that, which fails validation — an untouched
      // blank field should mean "leave it as is", not "clear it".
      const patch: companyApi.ProfilePatch = {};
      for (const [key, value] of Object.entries(form)) {
        if (value.trim() !== '') patch[key as keyof companyApi.ProfilePatch] = value;
      }
      const updated = await companyApi.updateProfile(patch);
      setForm(toFormState(updated));
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      {FIELDS.map(({ key, label, type, textarea, options }) => (
        <div key={key}>
          <label htmlFor={`profile-${key}`} className="block text-xs font-medium text-slate-500">
            {label}
          </label>
          {options ? (
            <select
              id={`profile-${key}`}
              disabled={!canEdit}
              value={form[key] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : textarea ? (
            <textarea
              id={`profile-${key}`}
              disabled={!canEdit}
              rows={2}
              value={form[key] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
            />
          ) : (
            <input
              id={`profile-${key}`}
              type={type ?? 'text'}
              disabled={!canEdit}
              value={form[key] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
            />
          )}
        </div>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-600">Saved.</p>}
      {canEdit && (
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      )}
    </form>
  );
}
