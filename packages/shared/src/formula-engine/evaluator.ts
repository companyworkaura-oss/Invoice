import { Decimal } from 'decimal.js';
import { FormulaEvaluationError } from './errors.js';
import type { Expr, FormulaVariable } from './parser.js';

/**
 * Walks the AST computing the result with decimal.js the whole way —
 * no operand is ever a native JS float, so there is no binary
 * floating-point rounding error in the result. Pure function: same
 * expression and inputs always produce the same output (deterministic).
 */
export function evaluate(expr: Expr, variables: ReadonlyMap<FormulaVariable, Decimal>): Decimal {
  switch (expr.kind) {
    case 'num':
      return new Decimal(expr.value);
    case 'var': {
      const value = variables.get(expr.name);
      // Parsing already rejects unknown names and evaluateFormula() pre-validates
      // that every variable the formula uses has a value, so this is unreachable
      // in normal use — kept as a defensive guard, not a validation path.
      if (!value) throw new FormulaEvaluationError(`Missing value for "${expr.name}"`);
      return value;
    }
    case 'neg':
      return evaluate(expr.expr, variables).negated();
    case 'binary': {
      const left = evaluate(expr.left, variables);
      const right = evaluate(expr.right, variables);
      switch (expr.op) {
        case '+':
          return left.plus(right);
        case '-':
          return left.minus(right);
        case '*':
          return left.times(right);
        case '/':
          if (right.isZero()) throw new FormulaEvaluationError('Division by zero');
          return left.dividedBy(right);
      }
    }
  }
}
