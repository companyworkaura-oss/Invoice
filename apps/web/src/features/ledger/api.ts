import type { CustomerLedger, CustomerStatement, LedgerEntry, LedgerEntryType } from '@invoice/shared';
import { ApiError, api } from '../../lib/api';

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
 * The PDF endpoint returns a binary body, not JSON — same pattern as
 * the invoice PDF download (see features/invoices/api.ts).
 */
export async function fetchStatementPdf(customerId: string, params: StatementParams = {}): Promise<Blob> {
  const res = await fetch(`/api/customers/${customerId}/ledger/statement/pdf${statementQuery(params)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Could not generate the PDF' }));
    throw new ApiError(res.status, body);
  }
  return res.blob();
}

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
