/**
 * Reference formulas from the product brief. These are EXAMPLES, not
 * hard-coded business rules: nothing in the engine or in invoice logic
 * looks up a category by these names or branches on them. A company
 * configures its own categories with their own expressions (Phase 5,
 * embroidery_categories.formula_config); this list exists so the engine
 * has concrete, realistic formulas to be exercised against in tests and
 * so a new company has something to start from.
 */
export const EXAMPLE_FORMULAS = {
  hsHp: { label: 'HS/HP', expression: 'stitches / 1000 * rate' },
  daman: { label: 'Daman', expression: 'stitches / 1000 * rate * 2.77' },
  patti: { label: 'Patti', expression: 'stitches / 1000 * rate * 21' },
  bazu: { label: 'Bazu', expression: 'stitches / 1000 * rate * 28 / 14' },
  dupatta: { label: 'Dupatta', expression: 'stitches / 1000 * rate * 28 / 4' },
} as const satisfies Record<string, { label: string; expression: string }>;
