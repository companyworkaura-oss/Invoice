import type { EmbroideryCategory } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { FormField, PrimaryButton, SecondaryButton, SectionHeading } from '../../lib/ui';
import { FIELD_INPUT_CLASS } from '../../lib/ui-tokens';
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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-slate-200 p-4 sm:p-5">
      <SectionHeading>{category ? 'Edit category' : 'New category'}</SectionHeading>

      <FormField label="Name" htmlFor="cat-name">
        <input
          id="cat-name"
          required
          placeholder="e.g. Daman Lace"
          value={form.name}
          onChange={(e) => field('name', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <FormField label="Description" htmlFor="cat-description" optional>
        <textarea
          id="cat-description"
          rows={2}
          value={form.description}
          onChange={(e) => field('description', e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Default rate"
          htmlFor="cat-rate"
          optional
          helperText="Starting point only — can be overridden per invoice item."
        >
          <input
            id="cat-rate"
            inputMode="decimal"
            placeholder="0.00"
            value={form.defaultRate}
            onChange={(e) => field('defaultRate', e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        </FormField>

        <FormField label="Formula type" htmlFor="cat-formula-type">
          <input
            id="cat-formula-type"
            list="formula-type-suggestions"
            value={form.formulaType}
            onChange={(e) => field('formulaType', e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
          {/* Suggestions only — any label is accepted, nothing is hard-coded. */}
          <datalist id="formula-type-suggestions">
            <option value="fixed" />
            <option value="per_unit" />
            <option value="tiered" />
          </datalist>
        </FormField>
      </div>

      <FormField label="Formula config (JSON)" htmlFor="cat-formula-config">
        <textarea
          id="cat-formula-config"
          rows={4}
          spellCheck={false}
          value={form.formulaConfigJson}
          onChange={(e) => field('formulaConfigJson', e.target.value)}
          className={`${FIELD_INPUT_CLASS} font-mono text-xs`}
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
