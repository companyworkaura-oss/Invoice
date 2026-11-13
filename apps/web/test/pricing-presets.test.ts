import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFormula, roundMoney } from '@invoice/shared';
import {
  buildFormulaConfigForMethod,
  detectPricingMethod,
  validatePricingFields,
} from '../src/features/formulas/pricing-presets.js';

// UI/UX-08: these pure functions are the entire translation layer
// between business-friendly pricing fields and the existing,
// unmodified formula engine — every test here either builds a config
// and feeds it straight into evaluateFormula (the exact function
// invoice creation uses), or detects a preset from one of this app's
// own real example formulas (example-formulas.ts).

test('1. Standard stitch-rate preset builds the plain expression, matching HS/HP exactly', () => {
  const config = buildFormulaConfigForMethod('stitch-rate', { multiplier: '', divisor: '' });
  assert.equal(config.expression, 'stitches / 1000 * rate');
  const result = evaluateFormula(config.expression, { stitches: 10000, rate: '1.70' });
  assert.equal(roundMoney(result), '17.00');
});

test('2. Multiplier preset builds an expression matching Daman exactly', () => {
  const config = buildFormulaConfigForMethod('stitch-rate-multiplier', { multiplier: '2.77', divisor: '' });
  assert.equal(config.expression, 'stitches / 1000 * rate * 2.77');
  const result = evaluateFormula(config.expression, { stitches: 10000, rate: '1.70' });
  // Acceptance scenario: Daman, rate 1.70, multiplier 2.77, 10,000 stitches.
  assert.equal(roundMoney(result), '47.09');
});

test('3. Multiplier + divisor preset builds an expression matching Bazu exactly', () => {
  const config = buildFormulaConfigForMethod('stitch-rate-multiplier-divisor', { multiplier: '28', divisor: '14' });
  assert.equal(config.expression, 'stitches / 1000 * rate * 28 / 14');
  const result = evaluateFormula(config.expression, { stitches: 10000, rate: '1.70' });
  assert.equal(roundMoney(result), '34.00');
});

test('4. example-preview calculation matches what evaluateFormula alone would produce — no second calculation rule', () => {
  const fields = { multiplier: '2', divisor: '' };
  const config = buildFormulaConfigForMethod('stitch-rate-multiplier', fields);
  const sampleStitches = 10000;
  const defaultRate = '1.70';
  const preview = roundMoney(evaluateFormula(config.expression, { stitches: sampleStitches, rate: defaultRate }));
  // The report's own worked example: 10,000 stitches, rate 1.70, multiplier 2 → 34.
  assert.equal(preview, '34.00');
});

test('5. divisor of zero fails validation before anything is ever saved', () => {
  const errors = validatePricingFields('stitch-rate-multiplier-divisor', { defaultRate: '1.70', multiplier: '28', divisor: '0' });
  assert.equal(errors.divisor, 'Must not be zero');
});

test('5b. a non-numeric divisor is also rejected', () => {
  const errors = validatePricingFields('stitch-rate-multiplier-divisor', { defaultRate: '1.70', multiplier: '28', divisor: 'abc' });
  assert.equal(errors.divisor, 'Must be a valid number');
});

test('6. existing compatible categories (the product brief examples) each map to the correct preset', () => {
  assert.deepEqual(detectPricingMethod({ expression: 'stitches / 1000 * rate' }), { method: 'stitch-rate' });
  assert.deepEqual(detectPricingMethod({ expression: 'stitches / 1000 * rate * 2.77' }), {
    method: 'stitch-rate-multiplier',
    multiplier: '2.77',
  });
  assert.deepEqual(detectPricingMethod({ expression: 'stitches / 1000 * rate * 21' }), {
    method: 'stitch-rate-multiplier',
    multiplier: '21',
  });
  assert.deepEqual(detectPricingMethod({ expression: 'stitches / 1000 * rate * 28 / 14' }), {
    method: 'stitch-rate-multiplier-divisor',
    multiplier: '28',
    divisor: '14',
  });
  assert.deepEqual(detectPricingMethod({ expression: 'stitches / 1000 * rate * 28 / 4' }), {
    method: 'stitch-rate-multiplier-divisor',
    multiplier: '28',
    divisor: '4',
  });
});

test('6b. a legacy category using named multiplier/divisor variables (rather than baked literals) still maps correctly', () => {
  assert.deepEqual(
    detectPricingMethod({ expression: 'stitches / 1000 * rate * multiplier', multiplier: 2.77 }),
    { method: 'stitch-rate-multiplier', multiplier: '2.77' },
  );
  assert.deepEqual(
    detectPricingMethod({ expression: 'stitches / 1000 * rate * factor / divisor', factor: 28, divisor: 14 }),
    { method: 'stitch-rate-multiplier-divisor', multiplier: '28', divisor: '14' },
  );
});

test('7. a genuinely custom/advanced formula is preserved as "custom", never corrupted or forced into a preset', () => {
  assert.deepEqual(detectPricingMethod({ expression: '(stitches / 1000 * rate) + 5' }), { method: 'custom' });
  assert.deepEqual(detectPricingMethod({ expression: 'stitches * rate' }), { method: 'custom' });
  assert.deepEqual(detectPricingMethod({}), { method: 'custom' });
  assert.deepEqual(detectPricingMethod({ expression: 'not a valid formula (' }), { method: 'custom' });
});

test('8/9. a normal user never writes JSON — buildFormulaConfigForMethod produces a complete, valid formulaConfig from plain fields alone', () => {
  const config = buildFormulaConfigForMethod('stitch-rate-multiplier-divisor', { multiplier: '28', divisor: '4' });
  assert.deepEqual(config, { expression: 'stitches / 1000 * rate * 28 / 4' });
  // Round-trips cleanly back through the same detector.
  assert.deepEqual(detectPricingMethod(config), { method: 'stitch-rate-multiplier-divisor', multiplier: '28', divisor: '4' });
});

test('validatePricingFields: a missing default rate is rejected for every friendly preset', () => {
  assert.equal(validatePricingFields('stitch-rate', { defaultRate: '', multiplier: '', divisor: '' }).defaultRate, 'Enter a default rate');
  assert.equal(
    validatePricingFields('stitch-rate-multiplier', { defaultRate: '-1', multiplier: '2', divisor: '' }).defaultRate,
    'Must not be negative',
  );
});

test('validatePricingFields: custom mode has no friendly-field requirements of its own', () => {
  assert.deepEqual(validatePricingFields('custom', { defaultRate: '', multiplier: '', divisor: '' }), {});
});

test('validatePricingFields: a complete, valid multiplier+divisor submission has no errors', () => {
  assert.deepEqual(
    validatePricingFields('stitch-rate-multiplier-divisor', { defaultRate: '1.70', multiplier: '28', divisor: '14' }),
    {},
  );
});
