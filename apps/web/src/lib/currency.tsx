import type { ReactNode } from 'react';
import { CurrencyContext } from './use-currency';

export function CurrencyProvider({ currencyCode, children }: { currencyCode: string; children: ReactNode }) {
  return <CurrencyContext.Provider value={currencyCode}>{children}</CurrencyContext.Provider>;
}
