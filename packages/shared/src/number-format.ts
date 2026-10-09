import { Decimal } from 'decimal.js';

/**
 * Trims a stored numeric string's insignificant trailing zeros for
 * display/editing — "787871.00" -> "787871", "504.50" -> "504.5",
 * "1.25" -> "1.25". Never rounds and never changes the underlying
 * numeric value: this is formatting only, meant for prefilling an
 * editable input (or a read-only display) from a value a Postgres
 * numeric(12,2) column always hands back padded to 2 decimal places.
 * Returns the original string unchanged for an empty/invalid/
 * non-finite value, so a blank or in-progress input is never mangled.
 */
export function formatNumber(value: string): string {
  if (!value) return value;
  try {
    const n = new Decimal(value);
    if (!n.isFinite()) return value;
    return n.toString();
  } catch {
    return value;
  }
}
