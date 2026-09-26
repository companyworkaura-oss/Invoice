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
 * A plain URL, not a fetch() call: driving this download through
 * fetch()+blob()+createObjectURL was hitting the browser with a
 * confirmed-valid PDF response (right Content-Type/Content-Length,
 * correct byte count in server logs) yet ending up with an empty blob
 * client-side. A direct browser download — an <a href> pointed straight
 * at this same-origin URL — sidesteps fetch/Blob entirely and lets the
 * browser handle the binary response itself. Cookies go along
 * automatically since it's a normal same-origin navigation, no
 * credentials option needed. See CustomerStatementView.tsx's
 * handleDownload.
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
