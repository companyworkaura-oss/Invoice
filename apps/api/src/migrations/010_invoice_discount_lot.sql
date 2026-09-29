-- Invoice discount + lot number. Both are stored on `invoices` directly,
-- same tier as lot/discount being invoice-level facts (not per-item).
--
-- discount_amount is a computed snapshot, not derivable columns joined
-- later: it's recalculated server-side every time an invoice is created
-- or edited (see invoice.service.ts's calculateDiscount), then stored so
-- a read never has to re-derive it — same convention as invoice_items'
-- calculated_unit_amount/calculated_total. grand_total itself is never
-- stored, exactly like the existing totalAmount (sum of item totals):
-- it's cheap to derive as subtotal - discount_amount on every read, and
-- storing it would just be one more place it could drift from the items
-- it's supposed to summarize.
ALTER TABLE invoices
  ADD COLUMN lot_number text NULL,
  ADD COLUMN discount_type text NULL CHECK (discount_type IN ('percentage', 'fixed')),
  ADD COLUMN discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  ADD COLUMN discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
