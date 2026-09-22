import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  Decimal,
  EXAMPLE_FORMULAS,
  FormulaEvaluationError,
  FormulaSyntaxError,
  FormulaValidationError,
  evaluateFormula,
  requiredVariables,
  roundMoney,
  validateFormula,
} from '../src/modules/formulas/engine/index.js';

function amount(expression: string, inputs: Record<string, string | number>): string {
  return roundMoney(evaluateFormula(expression, inputs));
}

// --- One test per example formula from the brief -------------------------

test('HS/HP: stitches / 1000 * rate', () => {
  assert.equal(amount(EXAMPLE_FORMULAS.hsHp.expression, { stitches: 12000, rate: '1.20' }), '14.40');
  assert.equal(amount(EXAMPLE_FORMULAS.hsHp.expression, { stitches: 0, rate: '5.00' }), '0.00');
});

test('Daman: stitches / 1000 * rate * 2.77', () => {
  assert.equal(amount(EXAMPLE_FORMULAS.daman.expression, { stitches: 10000, rate: 2 }), '55.40');
});

test('Patti: stitches / 1000 * rate * 21', () => {
  assert.equal(amount(EXAMPLE_FORMULAS.patti.expression, { stitches: 5000, rate: 3 }), '315.00');
});

test('Bazu: stitches / 1000 * rate * multiplier / divisor (28 / 14)', () => {
  assert.equal(amount(EXAMPLE_FORMULAS.bazu.expression, { stitches: 7000, rate: 5 }), '70.00');
});

test('Dupatta: stitches / 1000 * rate * multiplier / divisor (28 / 4)', () => {
  assert.equal(amount(EXAMPLE_FORMULAS.dupatta.expression, { stitches: 4000, rate: '2.50' }), '70.00');
});

test('a formula built directly from the multiplier/divisor input variables, not literals', () => {
  // (stitches / 1000) * rate * multiplier / divisor
  const expression = '(stitches / 1000) * rate * multiplier / divisor';
  assert.equal(
    amount(expression, { stitches: 7000, rate: 5, multiplier: 28, divisor: 14 }),
    '70.00',
  );
});

test('a formula using the factor input variable', () => {
  const expression = 'stitches / 1000 * rate * factor';
  assert.equal(amount(expression, { stitches: 10000, rate: 2, factor: '2.77' }), '55.40');
});

// --- Decimal safety --------------------------------------------------------

test('is decimal-safe where native floats would drift', () => {
  // 0.1 + 0.2 famously isn't 0.3 in IEEE-754 float arithmetic.
  const result = evaluateFormula('factor + multiplier', { factor: '0.1', multiplier: '0.2' });
  assert.equal(result.toString(), '0.3');
});

test('roundMoney rounds half-up on an exact decimal boundary', () => {
  assert.equal(roundMoney(new Decimal('1.005')), '1.01');
  assert.equal(roundMoney(new Decimal('1.004')), '1.00');
});

test('is deterministic: the same expression and inputs always produce the same result', () => {
  const expression = 'stitches / 1000 * rate * multiplier / divisor';
  const inputs = { stitches: 12345, rate: '1.23', multiplier: 7, divisor: 3 };
  const first = evaluateFormula(expression, inputs).toString();
  for (let i = 0; i < 20; i++) {
    assert.equal(evaluateFormula(expression, inputs).toString(), first);
  }
});

// --- Grammar: precedence, parentheses, unary minus -------------------------

test('respects standard operator precedence and parentheses', () => {
  assert.equal(evaluateFormula('2 + 3 * 4', {}).toString(), '14');
  assert.equal(evaluateFormula('(2 + 3) * 4', {}).toString(), '20');
  assert.equal(evaluateFormula('stitches / 1000 / 2', { stitches: 4000 }).toString(), '2');
});

test('supports unary minus', () => {
  assert.equal(evaluateFormula('-rate + stitches', { rate: 5, stitches: 12 }).toString(), '7');
});

// --- Input validation --------------------------------------------------------

test('rejects a missing required input', () => {
  assert.throws(() => evaluateFormula('stitches / 1000 * rate', { stitches: 1000 }), FormulaValidationError);
});

test('rejects a non-numeric input', () => {
  assert.throws(
    () => evaluateFormula('stitches / 1000 * rate', { stitches: 1000, rate: 'free' }),
    FormulaValidationError,
  );
});

test('rejects a negative input', () => {
  assert.throws(
    () => evaluateFormula('stitches / 1000 * rate', { stitches: -1, rate: 1 }),
    FormulaValidationError,
  );
});

test('rejects division by zero', () => {
  assert.throws(
    () => evaluateFormula('stitches / 1000 * rate / divisor', { stitches: 1000, rate: 1, divisor: 0 }),
    FormulaEvaluationError,
  );
});

// --- Syntax / safety --------------------------------------------------------

test('rejects an unknown variable name', () => {
  assert.throws(() => evaluateFormula('unknownThing * rate', { rate: 1 }), FormulaValidationError);
});

test('rejects malformed syntax', () => {
  assert.throws(() => evaluateFormula('stitches / * rate', {}), FormulaSyntaxError);
  assert.throws(() => evaluateFormula('(stitches / 1000', {}), FormulaSyntaxError);
  assert.throws(() => evaluateFormula('stitches ) / 1000', {}), FormulaSyntaxError);
  assert.throws(() => evaluateFormula('', {}), FormulaValidationError);
});

test('does not evaluate arbitrary JavaScript embedded in a formula string', () => {
  // If this were ever passed to eval() or new Function(), it would run;
  // here it must fail as an ordinary unknown-variable/syntax error.
  assert.throws(() => evaluateFormula('process.exit(1)', {}));
  assert.throws(() => evaluateFormula('require("fs")', {}));
  assert.throws(() => evaluateFormula('stitches; console.log(1)', { stitches: 1 }));
});

test('the engine source never calls eval() or the Function constructor', () => {
  const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules', 'formulas', 'engine');
  for (const file of readdirSync(engineDir)) {
    if (!file.endsWith('.ts')) continue;
    // Strip comments first so a doc comment that merely *mentions* eval()
    // (as this file's own docstrings do) can't produce a false positive.
    const withoutComments = readFileSync(path.join(engineDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(!/\beval\s*\(/.test(withoutComments), `${file} must not call eval()`);
    assert.ok(!/new\s+Function\s*\(/.test(withoutComments), `${file} must not use the Function constructor`);
  }
});

// --- Extensibility -----------------------------------------------------------

test('requiredVariables reports exactly the variables a formula references', () => {
  assert.deepEqual(requiredVariables('stitches / 1000 * rate'), ['rate', 'stitches']);
  assert.deepEqual(requiredVariables('stitches / 1000 * rate * multiplier / divisor'), [
    'divisor',
    'multiplier',
    'rate',
    'stitches',
  ]);
  assert.deepEqual(requiredVariables('42'), []);
});

test('validateFormula accepts a brand new formula shape with no code changes', () => {
  // Nothing in the engine special-cases this expression — proving new
  // formula "types" are just new expression strings, added as data.
  const result = validateFormula('(stitches * quantity) / 1000 * rate + factor');
  assert.deepEqual(result.variables, ['factor', 'quantity', 'rate', 'stitches']);
  assert.equal(
    evaluateFormula('(stitches * quantity) / 1000 * rate + factor', {
      stitches: 2000,
      quantity: 3,
      rate: 1,
      factor: 5,
    }).toString(),
    '11',
  );
});
