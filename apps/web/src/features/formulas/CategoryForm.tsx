import type { EmbroideryCategory } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import * as categoriesApi from './api';

interface Props {
  category?: EmbroideryCategory; // present when editing
  onSaved: (category: EmbroideryCategory) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  description: string;
  defaultRate: string;
  formulaType: string;
  formulaConfigJson: string;
}

function toFormState(category?: EmbroideryCategory): FormState {
  return {
    name: category?.name ?? '',
    description: category?.description ?? '',
    defaultRate: category?.defaultRate ?? '',
    formulaType: category?.formulaType ?? 'fixed',
    formulaConfigJson: JSON.stringify(category?.formulaConfig ?? {}, null, 2),
  };
}

export function CategoryForm({ category, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(category));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let formulaConfig: Record<string, unknown>;
    try {
      const parsed: unknown = form.formulaConfigJson.trim() ? JSON.parse(form.formulaConfigJson) : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      formulaConfig = parsed as Record<string, unknown>;
    } catch {
      setError('Formula config must be valid JSON (an object, e.g. {"unit": "piece"}).');
      return;
    }

    setSaving(true);
    try {
      const patch: categoriesApi.CategoryPatch = {
        name: form.name,
        description: form.description || undefined,
        defaultRate: form.defaultRate || undefined,
        formulaType: form.formulaType || undefined,
        formulaConfig,
      };
      const saved = category
        ? await categoriesApi.updateCategory(category.id, patch)
        : await categoriesApi.createCategory({ name: form.name, ...patch });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{category ? 'Edit category' : 'New category'}</h3>
      <div>
        <label htmlFor="cat-name" className="block text-xs font-medium text-slate-500">
          Name
        </label>
        <input
          id="cat-name"
          required
          placeholder="e.g. Daman Lace"
          value={form.name}
          onChange={(e) => field('name', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="cat-description" className="block text-xs font-medium text-slate-500">
          Description
        </label>
        <textarea
          id="cat-description"
          rows={2}
          value={form.description}
          onChange={(e) => field('description', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cat-rate" className="block text-xs font-medium text-slate-500">
            Default rate
          </label>
          <input
            id="cat-rate"
            inputMode="decimal"
            placeholder="0.00"
            value={form.defaultRate}
            onChange={(e) => field('defaultRate', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="cat-formula-type" className="block text-xs font-medium text-slate-500">
            Formula type
          </label>
          <input
            id="cat-formula-type"
            list="formula-type-suggestions"
            value={form.formulaType}
            onChange={(e) => field('formulaType', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
          {/* Suggestions only — any label is accepted, nothing is hard-coded. */}
          <datalist id="formula-type-suggestions">
            <option value="fixed" />
            <option value="per_unit" />
            <option value="tiered" />
          </datalist>
        </div>
      </div>
      <div>
        <label htmlFor="cat-formula-config" className="block text-xs font-medium text-slate-500">
          Formula config (JSON)
        </label>
        <textarea
          id="cat-formula-config"
          rows={4}
          spellCheck={false}
          value={form.formulaConfigJson}
          onChange={(e) => field('formulaConfigJson', e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-500 focus:outline-none"
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
