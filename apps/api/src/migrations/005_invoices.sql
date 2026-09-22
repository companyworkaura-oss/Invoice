-- Phase 6/7: invoices, invoice items, and a per-company invoice number
-- sequence. Every calculation an item stores is a snapshot taken at
-- creation time, so a later change to a category's rate or formula
-- never changes an already-saved invoice.

-- One row per company. next_number is incremented atomically (a plain
-- UPDATE takes a row lock) so concurrent invoice creations for the same
-- company can never be handed the same number.
CREATE TABLE invoice_counters (
  company_id  uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  next_number integer NOT NULL DEFAULT 1
);

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id),
  invoice_number text NOT NULL,
  invoice_date   date NOT NULL DEFAULT CURRENT_DATE,
  -- Garment/piece count the invoice covers; each line item's total is
  -- this multiplied by that item's per-unit calculated amount.
  quantity       numeric(12,2) NOT NULL CHECK (quantity > 0),
  notes          text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_number)
);

CREATE INDEX invoices_company_idx ON invoices (company_id, created_at DESC);
CREATE INDEX invoices_company_customer_idx ON invoices (company_id, customer_id);

CREATE TABLE invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- Kept for traceability only; every field the invoice actually needs
  -- to redisplay correctly is snapshotted below, not read through here.
  category_id uuid REFERENCES embroidery_categories(id) ON DELETE SET NULL,

  -- --- Snapshots: fixed forever at the moment this item was created ---
  category_name       text NOT NULL,
  rate                numeric(12,2) NOT NULL,
  formula_type         text NOT NULL,
  formula_config       jsonb NOT NULL,
  calculation_inputs    jsonb NOT NULL,
  calculated_unit_amount numeric(14,2) NOT NULL,
  calculated_total       numeric(14,2) NOT NULL,
  -- ---------------------------------------------------------------------

  description text,
  stitches    integer NOT NULL CHECK (stitches > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id);
