import type { CustomerLedger, LedgerEntry } from '@invoice/shared';
import { api } from '../../lib/api';

export const getLedger = (customerId: string) => api<CustomerLedger>(`/customers/${customerId}/ledger`);

export const recordPayment = (customerId: string, input: { amount: string; date?: string; notes?: string }) =>
  api<LedgerEntry>(`/customers/${customerId}/ledger/payments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const recordAdjustment = (
  customerId: string,
  input: { debit?: string; credit?: string; date?: string; notes?: string },
) =>
  api<LedgerEntry>(`/customers/${customerId}/ledger/adjustments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
