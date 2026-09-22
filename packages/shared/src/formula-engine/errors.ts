/** Base class for every error the formula engine raises. */
export class FormulaError extends Error {}

/** The expression text itself is malformed (bad characters, unbalanced parens, ...). */
export class FormulaSyntaxError extends FormulaError {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
  }
}

/** The expression is syntactically fine but references something not allowed, e.g. an unknown variable. */
export class FormulaValidationError extends FormulaError {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** The expression and inputs were both valid, but evaluating them failed (e.g. division by zero). */
export class FormulaEvaluationError extends FormulaError {}
