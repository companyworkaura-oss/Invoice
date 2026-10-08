-- Phase 30: optional display toggles for the Unit Amount / Item
-- Quantity columns on customer-facing print/PDF/WhatsApp (display-only
-- — never touches unit amount, line amount, subtotal, discount, grand
-- total, or the ledger, all of which are computed exactly as before
-- regardless of these flags); General Quantity (a separate,
-- invoice-level metadata field — the overall suit count for the whole
-- job/invoice, distinct from each item's own quantity on
-- invoice_items.quantity, which is untouched); and Bill Number (a
-- second, business-assigned number, distinct from the system-generated
-- invoice_number).
--
-- show_unit_amount/show_item_quantity default true so every existing
-- invoice prints exactly as it already does today — nothing changes
-- for a row that predates these columns, and an old saved invoice
-- keeps its own saved true/true forever even if some future global UI
-- default changes.
--
-- Number of Sets is deliberately NOT stored here: it's derived from
-- general_quantity on every read (see packages/shared's
-- calculateSets/SUITS_PER_SET), so there's nothing to keep in sync if
-- the suits-per-set business rule ever changes.
ALTER TABLE invoices
  ADD COLUMN bill_number text NULL,
  ADD COLUMN general_quantity numeric(12,2) NULL CHECK (general_quantity IS NULL OR general_quantity > 0),
  ADD COLUMN show_unit_amount boolean NOT NULL DEFAULT true,
  ADD COLUMN show_item_quantity boolean NOT NULL DEFAULT true;
