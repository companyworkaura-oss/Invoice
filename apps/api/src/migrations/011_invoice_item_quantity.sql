-- Quantity moves from invoice-level to invoice-item-level: each
-- embroidery category/line on an invoice has its own quantity (e.g.
-- BAZU=12, FRONT=8, DUPATTA=15), not one invoice-wide multiplier applied
-- to every item — see invoice.service.ts's createInvoiceItem for how
-- this is now used in the formula engine.

ALTER TABLE invoice_items
  ADD COLUMN quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0);

-- Backfill: an existing item's quantity was never tracked on the item
-- itself, but its calculated_total was already computed as
-- unit_amount * the invoice's (then invoice-level) quantity — so that's
-- the historically accurate value to backfill, not a blanket "1", which
-- would leave an old item's stored quantity inconsistent with the total
-- it was actually billed at.
UPDATE invoice_items ii
   SET quantity = i.quantity
  FROM invoices i
 WHERE ii.invoice_id = i.id;

-- invoices.quantity is now obsolete — kept only so existing rows and any
-- external reader don't break, but the app no longer reads, writes, or
-- displays it (see invoice.service.ts). Give it a default so new rows
-- can omit it entirely instead of the app having to keep inventing a value.
ALTER TABLE invoices
  ALTER COLUMN quantity SET DEFAULT 1;
