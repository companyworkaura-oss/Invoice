/**
 * Audit log (Phase 18). One fixed action list, defined here so both
 * apps/api (writer) and apps/web (reader) agree on the exact strings —
 * INVOICE_EDITED, INVOICE_CANCELLED, and PAYMENT_EDITED are included
 * for a future phase: no route in this app can edit or cancel an
 * invoice or edit a payment yet (see memory.md), so nothing posts those
 * three today.
 */
export const AUDIT_ACTIONS = [
  'INVOICE_CREATED',
  'INVOICE_EDITED',
  'INVOICE_CANCELLED',
  'INVOICE_ARCHIVED',
  'INVOICE_UNARCHIVED',
  'INVOICE_DELETED',
  'PAYMENT_CREATED',
  'PAYMENT_EDITED',
  'FORMULA_CHANGED',
  'RATE_CHANGED',
  'COMPANY_SETTINGS_CHANGED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ['invoice', 'payment', 'formula', 'company'] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Returned by GET /api/audit-logs — owner/admin only (audit.view permission). */
export interface AuditLogEntry {
  id: string;
  companyId: string;
  userId: string | null;
  /** Null if the acting user's own row was ever hard-deleted (no route does this today). */
  userName: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  /** Free-form, action-specific context (e.g. old/new rate) — never used for authorization or balance math. */
  metadata: Record<string, unknown>;
  createdAt: string;
}
