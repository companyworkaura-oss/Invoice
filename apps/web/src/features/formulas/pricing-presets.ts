import { Decimal, parseFormula, type Expr } from '@invoice/shared';

/**
 * UI/UX-08: a thin, UI-only translation layer between business-
 * friendly "pricing method" fields and this app's existing,
 * unmodified formula engine (`@invoice/shared`'s formula-engine). It
 * never introduces a second calculation rule — building a preset just
 * produces the exact same kind of `{ expression: string }`
 * formulaConfig a category has always stored (see
 * example-formulas.ts's HS/HP/Daman/Patti/Bazu/Dupatta, which this
 * mirrors exactly: a literal multiplier/divisor baked into the
 * expression string, not a second runtime config shape), and
 * detecting a preset from existing data parses that expression with
 * the engine's own `parseFormula` — the same parser invoices use —
 * rather than a hand-rolled regex that could disagree with it.
 */

export type PricingMethodId = 'stitch-rate' | 'stitch-rate-multiplier' | 'stitch-rate-multiplier-divisor' | 'custom';

export interface PricingMethodOption {
  id: PricingMethodId;
  label: string;
  /** Business-language description of the calculation, shown as helper text next to the picker. */
  helperText: string;
}

export const PRICING_METHODS: readonly PricingMethodOption[] = [
  { id: 'stitch-rate', label: 'Standard stitch rate', helperText: '(Stitches ÷ 1,000) × Default rate' },
  {
    id: 'stitch-rate-multiplier',
    label: 'Stitch rate with multiplier',
    helperText: '(Stitches ÷ 1,000) × Default rate × Multiplier',
  },
  {
    id: 'stitch-rate-multiplier-divisor',
    label: 'Stitch rate with multiplier and divisor',
    helperText: '(Stitches ÷ 1,000) × Default rate × Multiplier ÷ Divisor',
  },
  { id: 'custom', label: 'Advanced / Custom formula', helperText: 'Write the formula expression directly.' },
];

export interface PricingMethodFields {
  multiplier: string;
  divisor: string;
}

/**
 * Builds the exact `formulaConfig` a category with this pricing
 * method will save — never called for `'custom'` (the caller keeps
 * whatever raw config the Advanced section holds, untouched, for
 * that one). Numbers are embedded as-typed (trimmed only), the same
 * literal-in-expression shape every existing example formula already
 * uses.
 */
export function buildFormulaConfigForMethod(
  method: Exclude<PricingMethodId, 'custom'>,
  fields: PricingMethodFields,
): { expression: string } {
  switch (method) {
    case 'stitch-rate':
      return { expression: 'stitches / 1000 * rate' };
    case 'stitch-rate-multiplier':
      return { expression: `stitches / 1000 * rate * ${fields.multiplier.trim()}` };
    case 'stitch-rate-multiplier-divisor':
      return { expression: `stitches / 1000 * rate * ${fields.multiplier.trim()} / ${fields.divisor.trim()}` };
  }
}

export interface DetectedPricingMethod {
  method: PricingMethodId;
  multiplier?: string;
  divisor?: string;
}

const MULTIPLIER_VARIABLE_NAMES = new Set(['multiplier', 'factor']);
const DIVISOR_VARIABLE_NAMES = new Set(['divisor']);

/**
 * A node is either a bare numeric literal (what this module's own
 * builder produces) or a reference to one of the engine's named
 * constant-style variables backed by a fixed value already present in
 * `formulaConfig` (an older/hand-written category might use
 * `stitches / 1000 * rate * multiplier` with `{ multiplier: 2.77 }`
 * rather than baking the number into the expression itself — both are
 * equally valid to the engine, so detection accepts either).
 */
function literalOrFixedVariableValue(node: Expr, formulaConfig: Record<string, unknown>, variableNames: Set<string>): string | undefined {
  if (node.kind === 'num') return node.value;
  if (node.kind === 'var' && variableNames.has(node.name)) {
    const value = formulaConfig[node.name];
    if (typeof value === 'number' || typeof value === 'string') return String(value);
  }
  return undefined;
}

function isStitchesOver1000TimesRate(node: Expr): boolean {
  return (
    node.kind === 'binary' &&
    node.op === '*' &&
    node.right.kind === 'var' &&
    node.right.name === 'rate' &&
    node.left.kind === 'binary' &&
    node.left.op === '/' &&
    node.left.left.kind === 'var' &&
    node.left.left.name === 'stitches' &&
    node.left.right.kind === 'num' &&
    node.left.right.value === '1000'
  );
}

/**
 * Figures out which friendly preset (if any) a stored `formulaConfig`
 * matches, purely by parsing its expression — never by guessing from
 * `formulaType` (a free-text label the engine itself never reads) and
 * never by rewriting anything. A formula that doesn't match any
 * preset shape (or fails to parse at all) reports back `'custom'` so
 * the caller falls back to showing it, untouched, in Advanced mode.
 */
export function detectPricingMethod(formulaConfig: Record<string, unknown>): DetectedPricingMethod {
  const expression = formulaConfig.expression;
  if (typeof expression !== 'string' || expression.trim() === '') return { method: 'custom' };

  let ast: Expr;
  try {
    ast = parseFormula(expression);
  } catch {
    return { method: 'custom' };
  }

  if (isStitchesOver1000TimesRate(ast)) {
    return { method: 'stitch-rate' };
  }

  if (ast.kind === 'binary' && ast.op === '*' && isStitchesOver1000TimesRate(ast.left)) {
    const multiplier = literalOrFixedVariableValue(ast.right, formulaConfig, MULTIPLIER_VARIABLE_NAMES);
    if (multiplier !== undefined) return { method: 'stitch-rate-multiplier', multiplier };
  }

  if (
    ast.kind === 'binary' &&
    ast.op === '/' &&
    ast.left.kind === 'binary' &&
    ast.left.op === '*' &&
    isStitchesOver1000TimesRate(ast.left.left)
  ) {
    const multiplier = literalOrFixedVariableValue(ast.left.right, formulaConfig, MULTIPLIER_VARIABLE_NAMES);
    const divisor = literalOrFixedVariableValue(ast.right, formulaConfig, DIVISOR_VARIABLE_NAMES);
    if (multiplier !== undefined && divisor !== undefined) {
      return { method: 'stitch-rate-multiplier-divisor', multiplier, divisor };
    }
  }

  return { method: 'custom' };
}

export interface PricingMethodValidationErrors {
  defaultRate?: string;
  multiplier?: string;
  divisor?: string;
}

/**
 * UI/UX-08 Part 7: field-level validation for the friendly pricing
 * fields, before anything is ever built into a formulaConfig and
 * saved. Default rate must be present and non-negative wherever the
 * chosen method would otherwise have nothing to multiply by;
 * multiplier just needs to be a valid number; divisor must be a valid
 * number and never zero (a `stitches/1000*rate*M/0` formula would
 * fail at invoice-creation time anyway, but surfacing that here, at
 * save time, is far clearer than a cryptic error on the next invoice).
 */
export function validatePricingFields(
  method: PricingMethodId,
  fields: { defaultRate: string; multiplier: string; divisor: string },
): PricingMethodValidationErrors {
  const errors: PricingMethodValidationErrors = {};

  if (method !== 'custom') {
    if (!fields.defaultRate.trim()) {
      errors.defaultRate = 'Enter a default rate';
    } else {
      try {
        if (new Decimal(fields.defaultRate).isNegative()) errors.defaultRate = 'Must not be negative';
      } catch {
        errors.defaultRate = 'Must be a valid number';
      }
    }
  }

  if (method === 'stitch-rate-multiplier' || method === 'stitch-rate-multiplier-divisor') {
    if (!fields.multiplier.trim()) {
      errors.multiplier = 'Enter a multiplier';
    } else if (!isValidDecimal(fields.multiplier)) {
      errors.multiplier = 'Must be a valid number';
    }
  }

  if (method === 'stitch-rate-multiplier-divisor') {
    if (!fields.divisor.trim()) {
      errors.divisor = 'Enter a divisor';
    } else if (!isValidDecimal(fields.divisor)) {
      errors.divisor = 'Must be a valid number';
    } else if (new Decimal(fields.divisor).isZero()) {
      errors.divisor = 'Must not be zero';
    }
  }

  return errors;
}

function isValidDecimal(value: string): boolean {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

/** A short, human label for `formulaType` — purely descriptive metadata the engine never reads; never shown as an editable field in the friendly flow. */
export function formulaTypeLabelForMethod(method: PricingMethodId): string {
  switch (method) {
    case 'stitch-rate':
      return 'Stitch rate';
    case 'stitch-rate-multiplier':
      return 'Stitch rate × multiplier';
    case 'stitch-rate-multiplier-divisor':
      return 'Stitch rate × multiplier ÷ divisor';
    case 'custom':
      return 'Custom';
  }
}
