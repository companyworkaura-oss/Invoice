import type { CustomerLedger, LedgerEntry } from '@invoice/shared';
import { api } from '../../lib/api';

export const getLedger = (customerId: string) => api<CustomerLedger>(`/customers/${customerId}/ledger`);

// Payments are recorded through features/payments (POST /api/payments),
// which creates the payment record and this same ledger credit in one
// transaction — see apps/api's payment.service.ts.

export const recordAdjustment = (
  customerId: string,
  input: { debit?: string; credit?: string; date?: string; notes?: string },
) =>
  api<LedgerEntry>(`/customers/${customerId}/ledger/adjustments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
