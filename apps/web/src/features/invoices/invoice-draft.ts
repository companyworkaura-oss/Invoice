/**
 * UI/UX-03 (Parts 4/5/9/10): recoverable localStorage drafts for a
 * Standard or Quick Invoice still being entered. Scoped to
 * `<userId>:<companyId>:<mode>` so a draft from one company or one
 * mode never surfaces under another — switching companies (which
 * remounts the whole Invoices tree via App.tsx's `key={company.id}`)
 * or switching invoice mode naturally reads a different key, with
 * nothing to clear by hand. This is a client-side convenience only:
 * resuming a draft just repopulates form fields the user already
 * typed, and the actual save still goes through the normal
 * createInvoice/updateInvoice call with the server's own session,
 * tenant isolation, and permission checks — a draft's contents (even
 * a tampered one) are never trusted as authorization for anything.
 */

export type InvoiceDraftMode = 'standard' | 'quick';

export interface InvoiceDraftEnvelope<T> {
  version: 1;
  savedAt: string;
  data: T;
}

const DRAFT_VERSION = 1;

function draftKey(userId: string, companyId: string, mode: InvoiceDraftMode): string {
  return `invoice-draft:${userId}:${companyId}:${mode}`;
}

/** Never throws — a private window, blocked storage, or corrupted JSON all just mean "no draft available", never a crash. */
export function loadInvoiceDraft<T>(userId: string, companyId: string, mode: InvoiceDraftMode): InvoiceDraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, companyId, mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InvoiceDraftEnvelope<T>>;
    if (parsed.version !== DRAFT_VERSION || typeof parsed.savedAt !== 'string' || !parsed.data) return null;
    return parsed as InvoiceDraftEnvelope<T>;
  } catch {
    return null;
  }
}

export function saveInvoiceDraft<T>(userId: string, companyId: string, mode: InvoiceDraftMode, data: T): void {
  try {
    const envelope: InvoiceDraftEnvelope<T> = { version: DRAFT_VERSION, savedAt: new Date().toISOString(), data };
    localStorage.setItem(draftKey(userId, companyId, mode), JSON.stringify(envelope));
  } catch {
    // Non-fatal — see this module's doc comment.
  }
}

export function clearInvoiceDraft(userId: string, companyId: string, mode: InvoiceDraftMode): void {
  try {
    localStorage.removeItem(draftKey(userId, companyId, mode));
  } catch {
    // Non-fatal.
  }
}
