import { FormulaSyntaxError } from './errors.js';

export type Token =
  | { type: 'number'; value: string; pos: number }
  | { type: 'identifier'; name: string; pos: number }
  | { type: 'op'; op: '+' | '-' | '*' | '/'; pos: number }
  | { type: 'lparen'; pos: number }
  | { type: 'rparen'; pos: number };

const OPERATORS = new Set(['+', '-', '*', '/']);

/**
 * Turns a formula string into tokens. This is the only place raw
 * characters are inspected — everything downstream works on tokens, so
 * there is never a code path that hands the input string to eval() or
 * the Function constructor.
 */
export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', pos: i });
      i++;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'op', op: ch as '+' | '-' | '*' | '/', pos: i });
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = i;
      let sawDot = false;
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        if (expression[i] === '.') {
          if (sawDot) throw new FormulaSyntaxError(`Malformed number at position ${start}`, start);
          sawDot = true;
        }
        i++;
      }
      const value = expression.slice(start, i);
      if (value === '.' || value === '') throw new FormulaSyntaxError(`Malformed number at position ${start}`, start);
      tokens.push({ type: 'number', value, pos: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) i++;
      tokens.push({ type: 'identifier', name: expression.slice(start, i), pos: start });
      continue;
    }

    throw new FormulaSyntaxError(`Unexpected character "${ch}" at position ${i}`, i);
  }

  return tokens;
}
