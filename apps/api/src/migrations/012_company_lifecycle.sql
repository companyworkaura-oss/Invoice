-- Phase 27: company deactivate/reactivate + safe permanent delete.
--
-- status is deliberately a plain column on companies (not folded into
-- anything else) — 'active' is the only status that may be the current
-- tenant of a session (see requireAuth/login/switchCompany), so a
-- deactivated company is simply excluded wherever "my active companies"
-- is computed, while every row it owns (invoices, customers, ledger,
-- payments, audit log, ...) is left completely untouched. Restoring is
-- just flipping the column back.
ALTER TABLE companies
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  ADD COLUMN deactivated_at timestamptz;

-- Permanent company deletion relies on every company-owned table's
-- existing ON DELETE CASCADE back to companies.id (company_members,
-- sessions, customers, embroidery_categories, invoice_counters,
-- invoices -> invoice_items, ledger_entries, payments, audit_logs —
-- all already CASCADE as of their own migrations) to remove the whole
-- tenant in one DELETE FROM companies statement, inside one
-- transaction. That same cascade would also sweep away any
-- COMPANY_DELETED row written to audit_logs before the delete, which
-- is exactly the "don't rely on an audit row that will be deleted in
-- the same cascade" problem — so the deletion record lives here
-- instead, a table with no foreign key back to companies at all (only
-- a plain uuid column), so it survives the company it describes.
CREATE TABLE company_deletion_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  company_name         text NOT NULL,
  deleted_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_user_email text NOT NULL,
  member_count         integer NOT NULL,
  customer_count       integer NOT NULL,
  invoice_count        integer NOT NULL,
  payment_count        integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
