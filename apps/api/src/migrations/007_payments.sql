-- Phase 12: customer payments. A payment is its own record (method,
-- reference, notes) — the ledger credit it produces (see ledger_entries,
-- type='PAYMENT', reference_id = this row's id) is a consequence of it,
-- posted in the same transaction, never a substitute for it.

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  date           date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bank', 'cheque', 'other')),
  reference      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_company_customer_idx ON payments (company_id, customer_id, created_at DESC);
CREATE INDEX payments_company_idx ON payments (company_id, created_at DESC);
