import type { EmbroideryCategory } from '@invoice/shared';
import { evaluateFormula, requiredVariables, roundMoney } from '@invoice/shared';
import { useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { FormField, MoneyText, PrimaryButton, SecondaryButton, SectionHeading } from '../../lib/ui';
import { FIELD_INPUT_CLASS } from '../../lib/ui-tokens';
import { CollapsibleSection } from '../invoices/CollapsibleSection';
import * as categoriesApi from './api';
import {
  buildFormulaConfigForMethod,
  detectPricingMethod,
  formulaTypeLabelForMethod,
  PRICING_METHODS,
  validatePricingFields,
  type PricingMethodId,
} from './pricing-presets';

interface Props {
  category?: EmbroideryCategory; // present when editing
  onSaved: (category: EmbroideryCategory) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  description: string;
  defaultRate: string;
  method: PricingMethodId;
  multiplier: string;
  divisor: string;
  /** Only meaningful when method === 'custom' — the raw formulaConfig JSON, exactly as this form has always let advanced users edit it. */
  customConfigJson: string;
}

const DEFAULT_SAMPLE_STITCHES = '10000';

/**
 * UI/UX-08: a category's pricing is never shown as raw JSON by
 * default — picking one of the three friendly "pricing methods"
 * builds the exact same `{ expression }` formulaConfig shape this
 * app's categories have always used (see pricing-presets.ts), and
 * editing an existing category detects which of those methods (if
 * any) its stored formula already matches, so legacy/seed categories
 * (HS/HP, Daman, Patti, Bazu, Dupatta) open straight into the right
 * friendly fields instead of a JSON blob. A formula that doesn't
 * match any friendly preset is never corrupted or forced into one —
 * it opens in "Advanced / Custom formula" mode instead, showing
 * exactly the JSON it already had.
 */
function toFormState(category?: EmbroideryCategory): FormState {
  // A brand-new category has no stored formula to detect anything
  // from — default straight to the simplest, most common preset
  // (matches HS/HP) rather than running detection against an empty
  // config, which would otherwise read as "custom" and open on a
  // blank JSON textarea for every new category.
  const detected = category ? detectPricingMethod(category.formulaConfig) : { method: 'stitch-rate' as const };
  return {
    name: category?.name ?? '',
    description: category?.description ?? '',
    defaultRate: category?.defaultRate ?? '',
    method: detected.method,
    multiplier: detected.multiplier ?? '',
    divisor: detected.divisor ?? '',
    customConfigJson: JSON.stringify(category?.formulaConfig ?? { expression: '' }, null, 2),
  };
}

export function CategoryForm({ category, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(category));
  const [sampleStitches, setSampleStitches] = useState(DEFAULT_SAMPLE_STITCHES);
  const [fieldErrors, setFieldErrors] = useState<{ defaultRate?: string; multiplier?: string; divisor?: string; customConfigJson?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isCustom = form.method === 'custom';

  // UI/UX-08 Part 3: the live worked example reuses the exact same
  // formula engine invoice creation uses (evaluateFormula) — never a
  // second calculation rule that could disagree with it.
  const preview = useMemo(() => buildPreview(form, sampleStitches), [form, sampleStitches]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let formulaConfig: Record<string, unknown>;
    let formulaType: string;

    if (form.method === 'custom') {
      try {
        const parsed: unknown = form.customConfigJson.trim() ? JSON.parse(form.customConfigJson) : {};
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
        formulaConfig = parsed as Record<string, unknown>;
      } catch {
        setFieldErrors({ customConfigJson: 'Must be valid JSON (an object, e.g. {"expression": "stitches / 1000 * rate"}).' });
        return;
      }
      formulaType = category?.formulaType || formulaTypeLabelForMethod('custom');
      setFieldErrors({});
    } else {
      const errors = validatePricingFields(form.method, { defaultRate: form.defaultRate, multiplier: form.multiplier, divisor: form.divisor });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        return;
      }
      setFieldErrors({});
      formulaConfig = buildFormulaConfigForMethod(form.method, { multiplier: form.multiplier, divisor: form.divisor });
      formulaType = formulaTypeLabelForMethod(form.method);
    }

    setSaving(true);
    try {
      const patch: categoriesApi.CategoryPatch = {
        name: form.name,
        description: form.description || undefined,
        defaultRate: form.defaultRate || undefined,
        formulaType,
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

      <FormField label="Category name" htmlFor="cat-name">
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

      {!isCustom && (
        <FormField
          label="Default rate"
          htmlFor="cat-rate"
          error={fieldErrors.defaultRate}
          helperText={!fieldErrors.defaultRate ? 'Starting point only — can be overridden per invoice item.' : undefined}
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
      )}

      <FormField label="Pricing method" htmlFor="cat-method" helperText={PRICING_METHODS.find((m) => m.id === form.method)?.helperText}>
        <select
          id="cat-method"
          value={form.method}
          onChange={(e) => field('method', e.target.value as PricingMethodId)}
          className={FIELD_INPUT_CLASS}
        >
          {PRICING_METHODS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </FormField>

      {(form.method === 'stitch-rate-multiplier' || form.method === 'stitch-rate-multiplier-divisor') && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Multiplier" htmlFor="cat-multiplier" error={fieldErrors.multiplier}>
            <input
              id="cat-multiplier"
              inputMode="decimal"
              placeholder="e.g. 2.77"
              value={form.multiplier}
              onChange={(e) => field('multiplier', e.target.value)}
              className={FIELD_INPUT_CLASS}
            />
          </FormField>
          {form.method === 'stitch-rate-multiplier-divisor' && (
            <FormField label="Divisor" htmlFor="cat-divisor" error={fieldErrors.divisor}>
              <input
                id="cat-divisor"
                inputMode="decimal"
                placeholder="e.g. 14"
                value={form.divisor}
                onChange={(e) => field('divisor', e.target.value)}
                className={FIELD_INPUT_CLASS}
              />
            </FormField>
          )}
        </div>
      )}

      {!isCustom && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Example calculation</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <FormField label="Sample stitches" htmlFor="cat-sample-stitches">
              <input
                id="cat-sample-stitches"
                inputMode="numeric"
                value={sampleStitches}
                onChange={(e) => setSampleStitches(e.target.value)}
                className={`${FIELD_INPUT_CLASS} w-32`}
              />
            </FormField>
            <div>
              <p className="text-xs font-medium text-slate-500">Calculated amount</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {preview.amount !== null ? <MoneyText value={preview.amount} /> : <span className="text-sm text-slate-400">{preview.message}</span>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/*
        UI/UX-08 Part 6: raw formula/config editing lives only here —
        collapsed by default, never the normal-flow experience, and
        only reachable at all by picking "Advanced / Custom formula"
        above. Saving/editing a category already requires
        formula.manage (enforced server-side; see category.routes.ts)
        exactly as it did before this form changed — this section
        grants no additional access.
      */}
      {isCustom && (
        <CollapsibleSection title="Advanced settings" defaultOpen>
          <p className="text-xs text-amber-700">
            For advanced users. This formula is evaluated directly by the pricing engine — an invalid or unexpected
            expression can cause invoice creation to fail for this category. The business-friendly fields above are
            unavailable while this is selected.
          </p>
          <div className="mt-3">
            <FormField
              label="Custom formula (JSON)"
              htmlFor="cat-custom-config"
              error={fieldErrors.customConfigJson}
              helperText={!fieldErrors.customConfigJson ? 'e.g. {"expression": "stitches / 1000 * rate * 2.77"}' : undefined}
            >
              <textarea
                id="cat-custom-config"
                rows={4}
                spellCheck={false}
                value={form.customConfigJson}
                onChange={(e) => field('customConfigJson', e.target.value)}
                className={`${FIELD_INPUT_CLASS} font-mono text-xs`}
              />
            </FormField>
          </div>

          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Example calculation</p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <FormField label="Sample stitches" htmlFor="cat-sample-stitches-advanced">
                <input
                  id="cat-sample-stitches-advanced"
                  inputMode="numeric"
                  value={sampleStitches}
                  onChange={(e) => setSampleStitches(e.target.value)}
                  className={`${FIELD_INPUT_CLASS} w-32`}
                />
              </FormField>
              <div>
                <p className="text-xs font-medium text-slate-500">Calculated amount</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {preview.amount !== null ? (
                    <MoneyText value={preview.amount} />
                  ) : (
                    <span className="text-sm text-slate-400">{preview.message}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}

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

interface PreviewResult {
  amount: string | null;
  message: string;
}

/**
 * Builds the exact inputs evaluateFormula needs and runs it — the
 * same engine, same function, invoice creation itself calls. Any
 * missing/invalid field just produces a plain-language reason instead
 * of a calculated amount; it never falls back to a different formula.
 */
function buildPreview(form: FormState, sampleStitches: string): PreviewResult {
  if (form.method === 'custom') {
    let parsed: Record<string, unknown>;
    try {
      parsed = form.customConfigJson.trim() ? JSON.parse(form.customConfigJson) : {};
    } catch {
      return { amount: null, message: 'Fix the JSON above to see a sample calculation.' };
    }
    const expression = parsed.expression;
    if (typeof expression !== 'string' || !expression.trim()) {
      return { amount: null, message: 'Add an "expression" to see a sample calculation.' };
    }
    let needed: string[];
    try {
      needed = requiredVariables(expression);
    } catch {
      return { amount: null, message: 'Fix the formula expression to see a sample calculation.' };
    }
    const inputs: Record<string, string | number> = { stitches: sampleStitches, rate: form.defaultRate || '0', quantity: '1' };
    for (const name of needed) {
      if (name in inputs) continue;
      const configValue = parsed[name];
      if (typeof configValue === 'number' || typeof configValue === 'string') {
        inputs[name] = configValue;
      } else {
        return { amount: null, message: `Add a value for "${name}" in the JSON above to see a sample calculation.` };
      }
    }
    try {
      return { amount: roundMoney(evaluateFormula(expression, inputs)), message: '' };
    } catch {
      return { amount: null, message: 'This formula could not be calculated — check the expression above.' };
    }
  }

  const errors = validatePricingFields(form.method, { defaultRate: form.defaultRate, multiplier: form.multiplier, divisor: form.divisor });
  if (Object.keys(errors).length > 0) {
    return { amount: null, message: 'Fill in the fields above to see a sample calculation.' };
  }
  const { expression } = buildFormulaConfigForMethod(form.method, { multiplier: form.multiplier, divisor: form.divisor });
  try {
    return { amount: roundMoney(evaluateFormula(expression, { stitches: sampleStitches, rate: form.defaultRate })), message: '' };
  } catch {
    return { amount: null, message: 'Enter a valid sample stitch count to see a calculation.' };
  }
}
