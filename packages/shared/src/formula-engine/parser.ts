import { FormulaSyntaxError, FormulaValidationError } from './errors.js';
import { type Token, tokenize } from './tokenizer.js';

/**
 * The only variable names a formula may reference. Anything else fails
 * validation before the formula is ever evaluated — this is the
 * allow-list that keeps formulas data-driven without opening the door
 * to arbitrary code or arbitrary property access.
 */
export const ALLOWED_VARIABLES = ['stitches', 'rate', 'factor', 'multiplier', 'divisor', 'quantity'] as const;
export type FormulaVariable = (typeof ALLOWED_VARIABLES)[number];

const ALLOWED_VARIABLE_SET: ReadonlySet<string> = new Set(ALLOWED_VARIABLES);

export type Expr =
  | { kind: 'num'; value: string }
  | { kind: 'var'; name: FormulaVariable }
  | { kind: 'neg'; expr: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

/**
 * Recursive-descent parser for a small arithmetic grammar:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := '-' factor | primary
 *   primary    := number | identifier | '(' expression ')'
 *
 * Only +, -, *, /, parentheses, numeric literals, and the fixed set of
 * variable names above are recognized. There is no function-call syntax,
 * no assignment, and nothing here is ever passed to eval() or the
 * Function constructor — this parser is the entire "language".
 */
class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new FormulaSyntaxError('Unexpected end of expression', -1);
    this.pos++;
    return token;
  }

  parse(): Expr {
    const expr = this.parseExpression();
    if (this.pos !== this.tokens.length) {
      const trailing = this.tokens[this.pos];
      throw new FormulaSyntaxError(`Unexpected token at position ${trailing.pos}`, trailing.pos);
    }
    return expr;
  }

  private parseExpression(): Expr {
    let left = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (token?.type === 'op' && (token.op === '+' || token.op === '-')) {
        this.advance();
        const right = this.parseTerm();
        left = { kind: 'binary', op: token.op, left, right };
      } else {
        return left;
      }
    }
  }

  private parseTerm(): Expr {
    let left = this.parseFactor();
    for (;;) {
      const token = this.peek();
      if (token?.type === 'op' && (token.op === '*' || token.op === '/')) {
        this.advance();
        const right = this.parseFactor();
        left = { kind: 'binary', op: token.op, left, right };
      } else {
        return left;
      }
    }
  }

  private parseFactor(): Expr {
    const token = this.peek();
    if (token?.type === 'op' && token.op === '-') {
      this.advance();
      return { kind: 'neg', expr: this.parseFactor() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.advance();
    if (token.type === 'number') return { kind: 'num', value: token.value };
    if (token.type === 'identifier') {
      if (!ALLOWED_VARIABLE_SET.has(token.name)) {
        throw new FormulaValidationError(
          `Unknown variable "${token.name}". Allowed variables: ${ALLOWED_VARIABLES.join(', ')}`,
          token.name,
        );
      }
      return { kind: 'var', name: token.name as FormulaVariable };
    }
    if (token.type === 'lparen') {
      const inner = this.parseExpression();
      const close = this.peek();
      if (close?.type !== 'rparen') {
        throw new FormulaSyntaxError('Expected closing ")"', close?.pos ?? token.pos);
      }
      this.advance();
      return inner;
    }
    throw new FormulaSyntaxError(`Unexpected token at position ${token.pos}`, token.pos);
  }
}

/** Parses a formula string into an AST. Throws FormulaSyntaxError or FormulaValidationError. */
export function parseFormula(expression: string): Expr {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new FormulaValidationError('Formula must be a non-empty string');
  }
  return new Parser(tokenize(expression)).parse();
}

/** The set of variable names an already-parsed formula actually uses. */
export function collectVariables(expr: Expr): FormulaVariable[] {
  const found = new Set<FormulaVariable>();
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case 'var':
        found.add(node.name);
        return;
      case 'neg':
        visit(node.expr);
        return;
      case 'binary':
        visit(node.left);
        visit(node.right);
        return;
      case 'num':
        return;
    }
  };
  visit(expr);
  return [...found].sort();
}
