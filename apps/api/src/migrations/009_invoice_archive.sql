-- Phase 21: invoice archive/unarchive + safe hard delete. Archiving is
-- visibility only, never an accounting reversal — archived_at is a plain
-- nullable timestamp on invoices, deliberately not folded into the
-- existing `status` enum (draft/issued/cancelled), so an invoice's
-- workflow state and its list-visibility are two independent facts. No
-- other table changes: ledger_entries, payments, and invoice_items are
-- untouched by archiving, and dashboard/statement totals (all computed
-- from ledger_entries or invoice_items directly, never from `status` or
-- this new column) keep counting an archived invoice exactly as before.

ALTER TABLE invoices
  ADD COLUMN archived_at timestamptz NULL,
  ADD COLUMN archived_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Serves both "give me the active list" (archived_at IS NULL, the
-- default filter) and "give me the archived list" (IS NOT NULL) without
-- a full table scan.
CREATE INDEX invoices_company_archived_idx ON invoices (company_id, archived_at);
