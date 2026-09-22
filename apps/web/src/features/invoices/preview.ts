import type { EmbroideryCategory } from '@invoice/shared';
import { Decimal, FormulaError, evaluateFormula, roundMoney } from '@invoice/shared';

export interface ItemPreview {
  /** The line's total (per-unit amount × quantity), or null while it can't be computed yet. */
  amount: string | null;
  /** Only set for a real problem (e.g. a badly configured formula) — never for fields simply not filled in yet. */
  error: string | null;
}

/**
 * Client-side preview only, using the exact same formula engine the
 * server does (they both import it from @invoice/shared) — but this is
 * never what gets saved. The backend recalculates authoritatively from
 * scratch when the invoice is created; this function exists purely so
 * the form can show a live estimate while someone is filling it in.
 */
export function previewItemAmount(
  category: EmbroideryCategory | undefined,
  stitches: string,
  rateOverride: string,
  quantity: string,
): ItemPreview {
  if (!category) return { amount: null, error: null };

  const expression = category.formulaConfig.expression;
  if (typeof expression !== 'string' || !expression.trim()) {
    return { amount: null, error: 'This category has no formula set up yet' };
  }

  const stitchesNum = Number(stitches);
  const quantityNum = Number(quantity);
  if (!stitches || !Number.isFinite(stitchesNum) || stitchesNum <= 0) return { amount: null, error: null };
  if (!quantity || !Number.isFinite(quantityNum) || quantityNum <= 0) return { amount: null, error: null };

  const rate = rateOverride || category.defaultRate;

  // Same convention the server uses: formula_config.expression is the
  // formula text; any other numeric/string entry in formula_config is a
  // fixed input value for it (e.g. a baked-in multiplier).
  const baseInputs: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(category.formulaConfig)) {
    if (key === 'expression') continue;
    if (typeof value === 'number' || typeof value === 'string') baseInputs[key] = value;
  }

  try {
    const unit = roundMoney(evaluateFormula(expression, { ...baseInputs, stitches: stitchesNum, rate, quantity }));
    return { amount: roundMoney(new Decimal(unit).times(quantityNum)), error: null };
  } catch (err) {
    return { amount: null, error: err instanceof FormulaError ? err.message : 'Could not calculate' };
  }
}

export function sumAmounts(amounts: (string | null)[]): string {
  return roundMoney(amounts.reduce((sum, a) => (a ? sum.plus(new Decimal(a)) : sum), new Decimal(0)));
}
