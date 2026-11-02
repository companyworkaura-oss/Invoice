export type InvoiceEntryMode = 'quick' | 'standard';

const STORAGE_KEY = 'invoices:lastEntryMode';

/**
 * UI/UX-02: "Quick Invoice" and "New invoice" used to have equal
 * visual weight with no indication of which one a given business
 * actually uses day to day. Remembering the last-chosen mode (plain
 * localStorage, not a new preference system) lets the entry buttons
 * give that one slightly more visual weight next time, without
 * removing or hiding either option. Wrapped in try/catch — a private
 * window, blocked storage, or an unavailable `localStorage` (this
 * runs in a browser, but defensively) must never crash the page over
 * a cosmetic default; it just falls back to `fallback`.
 */
export function getLastInvoiceMode(fallback: InvoiceEntryMode = 'standard'): InvoiceEntryMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'quick' || stored === 'standard' ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function setLastInvoiceMode(mode: InvoiceEntryMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Non-fatal — see this module's doc comment.
  }
}
