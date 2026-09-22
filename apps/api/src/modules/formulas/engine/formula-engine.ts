import { Decimal } from 'decimal.js';
import { FormulaValidationError } from './errors.js';
import { evaluate } from './evaluator.js';
import { type Expr, type FormulaVariable, collectVariables, parseFormula } from './parser.js';

export { Decimal } from 'decimal.js';
export { ALLOWED_VARIABLES, parseFormula, collectVariables } from './parser.js';
export type { FormulaVariable, Expr } from './parser.js';
export { FormulaError, FormulaSyntaxError, FormulaValidationError, FormulaEvaluationError } from './errors.js';

export type FormulaInputs = Partial<Record<FormulaVariable, string | number>>;

/** Formula variables are physical quantities here — negative values are never valid. */
function toNonNegativeDecimal(name: string, raw: string | number): Decimal {
  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new FormulaValidationError(`"${name}" must be a valid number`, name);
  }
  if (!value.isFinite()) throw new FormulaValidationError(`"${name}" must be a finite number`, name);
  if (value.isNegative()) throw new FormulaValidationError(`"${name}" must not be negative`, name);
  return value;
}

/**
 * Which variables a formula needs, so a caller (e.g. a category edit
 * form) can validate or prompt for exactly the right inputs without
 * evaluating anything.
 */
export function requiredVariables(expression: string): FormulaVariable[] {
  return collectVariables(parseFormula(expression));
}

/** Parses (and thereby validates the syntax of) a formula without evaluating it. */
export function validateFormula(expression: string): { variables: FormulaVariable[] } {
  const ast = parseFormula(expression);
  return { variables: collectVariables(ast) };
}

/**
 * Parses `expression`, validates that every variable it references has a
 * matching, well-formed, non-negative input, then evaluates it with
 * decimal.js. Deterministic and side-effect free; never touches eval()
 * or the Function constructor. Returns the full-precision Decimal —
 * round it for display/storage with roundMoney().
 */
export function evaluateFormula(expression: string, inputs: FormulaInputs): Decimal {
  const ast: Expr = parseFormula(expression);
  const needed = collectVariables(ast);

  const variables = new Map<FormulaVariable, Decimal>();
  for (const name of needed) {
    const raw = inputs[name];
    if (raw === undefined || raw === null || raw === '') {
      throw new FormulaValidationError(`Missing required input "${name}"`, name);
    }
    variables.set(name, toNonNegativeDecimal(name, raw));
  }

  return evaluate(ast, variables);
}

/** Rounds a formula result to a fixed number of decimal places, as a decimal string (money-safe). */
export function roundMoney(value: Decimal, decimalPlaces = 2): string {
  return value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP).toFixed(decimalPlaces);
}
