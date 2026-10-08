import { Decimal } from 'decimal.js';

/**
 * Business rule: this many suits make up one "set" on an invoice. Kept
 * as the single named constant everywhere Sets is computed — a future
 * change to the business rule (e.g. 84 -> 96) is a one-line edit here,
 * never a search for a scattered literal 84.
 */
export const SUITS_PER_SET = 84;

/**
 * Sets = generalQuantity / SUITS_PER_SET, formatted for display: a
 * whole-number result prints as a plain integer ("1", "6"), a
 * fractional result prints with up to 2 decimal places and no trailing
 * zeros ("1.5", never "1.50") — never silently rounded to the nearest
 * whole set when the quantity isn't an exact multiple of
 * SUITS_PER_SET. Returns null for an empty/invalid/non-positive
 * general quantity, so a caller can tell "no value" apart from a real
 * "0" and skip printing the row entirely.
 *
 * Deliberately not stored anywhere — General Quantity is the
 * authoritative, saved invoice field; Sets is always derived fresh
 * from it (here, and again by buildInvoiceViewModel for print), so
 * there's nothing to keep in sync if SUITS_PER_SET ever changes.
 */
/**
 * Trims a stored numeric(12,2) value like "504.00" down to "504" for
 * display — a suit count is conventionally a whole number, so the
 * trailing ".00" a DB numeric column always carries is just noise on a
 * printed invoice ("Quantity: 504 Suits", not "504.00 Suits"). The
 * stored/authoritative value itself (Invoice.generalQuantity) is
 * untouched — this is a display-only transform, same convention as
 * calculateSets's own no-trailing-zeros formatting. Returns null
 * straight through for an empty/invalid value.
 */
export function formatQuantity(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const qty = new Decimal(value);
    if (!qty.isFinite()) return value;
    return qty.toString();
  } catch {
    return value;
  }
}

export function calculateSets(generalQuantity: string | null | undefined): string | null {
  if (!generalQuantity) return null;
  let qty: Decimal;
  try {
    qty = new Decimal(generalQuantity);
  } catch {
    return null;
  }
  if (!qty.isFinite() || qty.lessThanOrEqualTo(0)) return null;
  return qty.dividedBy(SUITS_PER_SET).toDecimalPlaces(2).toString();
}
