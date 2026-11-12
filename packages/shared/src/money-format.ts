import { formatNumber } from './number-format.js';

/**
 * UI/UX-05: display-only money formatting — adds thousands grouping
 * and an optional currency code prefix on top of formatNumber's
 * existing trim behavior, without changing it. formatNumber already
 * decides how many decimals a value keeps (it trims insignificant
 * trailing zeros, e.g. "49500.00" -> "49500", "12500.50" stays
 * "12500.50") — that rule is untouched here; this only adds the comma
 * grouping and the "PKR " prefix on top: "49500" -> "49,500",
 * "12500.50" -> "12,500.50", and with a currency code, "PKR 49,500".
 *
 * Never used for anything that feeds back into a calculation or gets
 * sent to the server — purely a presentation layer over the same
 * string formatNumber would already produce.
 */
export function formatMoney(value: string, currencyCode?: string): string {
  const trimmed = formatNumber(value);
  const grouped = addThousandsSeparators(trimmed);
  return currencyCode ? `${currencyCode} ${grouped}` : grouped;
}

function addThousandsSeparators(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, decimalPart] = unsigned.split('.');
  if (!/^\d+$/.test(integerPart)) return value; // not a plain number (blank/invalid) — leave untouched
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = decimalPart !== undefined ? `${groupedInteger}.${decimalPart}` : groupedInteger;
  return negative ? `-${result}` : result;
}
