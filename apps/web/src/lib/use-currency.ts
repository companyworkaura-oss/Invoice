import { createContext, useContext } from 'react';

/**
 * UI/UX-05: the active company's currency code (e.g. "PKR"), provided
 * once near the top of the authenticated app (App.tsx, via
 * CurrencyProvider in currency.tsx, from `me.company.defaultCurrency`)
 * so `MoneyText` (ui.tsx) can read it without every intermediate
 * component having to accept and forward a `currencyCode` prop.
 * Display-only — never read by anything that calculates or saves a
 * value. Split into its own plain module (no JSX) so this file only
 * exports the hook, not a component — keeps Fast Refresh happy.
 */
export const CurrencyContext = createContext<string>('');

export function useCurrency(): string {
  return useContext(CurrencyContext);
}
