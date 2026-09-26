import type { CustomerLedger, CustomerStatement, LedgerEntry, LedgerEntryType } from '@invoice/shared';
import { api } from '../../lib/api';

export const getLedger = (customerId: string) => api<CustomerLedger>(`/customers/${customerId}/ledger`);

export interface StatementParams {
  from?: string;
  to?: string;
  type?: LedgerEntryType;
}

function statementQuery(params: StatementParams): string {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.type) query.set('type', params.type);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export const getStatement = (customerId: string, params: StatementParams = {}) =>
  api<CustomerStatement>(`/customers/${customerId}/ledger/statement${statementQuery(params)}`);

/**
 * A same-origin URL, not a fetch call — actually downloading it goes
 * through the shared downloadPdf() helper (see lib/downloadPdf.ts), the
 * same one the invoice PDF download uses. Same-origin (proxied by Vite
 * in dev, same process when SERVE_FRONTEND=true) so the session cookie
 * rides along with fetch's default same-origin credentials.
 */
export const statementPdfUrl = (customerId: string, params: StatementParams = {}) =>
  `/api/customers/${customerId}/ledger/statement/pdf${statementQuery(params)}`;

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
