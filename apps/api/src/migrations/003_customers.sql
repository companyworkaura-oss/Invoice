-- Phase 4: customers.

CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(trim(name)) > 0),
  business_name    text,
  phone            text,
  whatsapp         text,
  address          text,
  -- Starting balance only; the current balance is derived from ledger
  -- entries once the ledger module exists, never stored redundantly here.
  opening_balance  numeric(14,2) NOT NULL DEFAULT 0,
  notes            text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_company_idx ON customers (company_id);
-- Powers both the default (status-filtered) list and name search, newest first.
CREATE INDEX customers_company_status_idx ON customers (company_id, status, created_at DESC);
CREATE INDEX customers_company_name_idx ON customers (company_id, lower(name));
