-- Phase 8: customer ledger. A customer's balance is never stored — it is
-- always SUM(debit) - SUM(credit) over this table, generated fresh on
-- every read. Rows are append-only: nothing here is ever updated to
-- "correct" a historical balance; a correction is its own new
-- ADJUSTMENT row.

CREATE TABLE ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id),
  type         text NOT NULL CHECK (type IN ('OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'ADJUSTMENT')),
  -- e.g. the invoice's id for an INVOICE entry; NULL for entries with no
  -- originating record (opening balances, free-form adjustments).
  reference_id uuid,
  debit        numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- Exactly one side of every entry is non-zero: it is a debit or a
  -- credit, never both, and never neither.
  CHECK ((debit > 0)::int + (credit > 0)::int = 1),
  date         date NOT NULL DEFAULT CURRENT_DATE,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_company_customer_idx ON ledger_entries (company_id, customer_id, created_at);
CREATE INDEX ledger_entries_reference_idx ON ledger_entries (reference_id);
