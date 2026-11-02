import type { InvoiceArchivedFilter, InvoicePaymentStatus } from '@invoice/shared';

/**
 * UI/UX-03 Part 3: the invoice list's filters live entirely in the
 * URL's query string — this is the one place that translates between
 * "what's actually in the URLSearchParams" and the plain filter
 * values the rest of InvoiceList.tsx works with, kept as pure
 * functions so the translation itself (not just "does clicking a
 * filter update the DOM") can be tested directly.
 */
export interface InvoiceListFilters {
  search: string;
  customerId: string;
  from: string;
  to: string;
  paymentStatus: InvoicePaymentStatus | '';
  archived: InvoiceArchivedFilter;
}

export const DEFAULT_ARCHIVED_FILTER: InvoiceArchivedFilter = 'active';

export function parseInvoiceListFilters(params: URLSearchParams): InvoiceListFilters {
  return {
    search: params.get('search') ?? '',
    customerId: params.get('customerId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    paymentStatus: (params.get('status') as InvoicePaymentStatus | null) ?? '',
    archived: (params.get('view') as InvoiceArchivedFilter | null) ?? DEFAULT_ARCHIVED_FILTER,
  };
}

/**
 * Applies a partial change to an existing URLSearchParams, returning
 * a brand-new instance (never mutates `prev`) — an empty/default
 * value deletes its key instead of writing e.g. `?view=active`, so
 * the URL only ever carries filters that actually narrow something.
 */
export function withInvoiceListFilterPatch(prev: URLSearchParams, patch: Record<string, string>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
