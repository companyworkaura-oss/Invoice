-- Phase 31 bug fix: editing a Quick Invoice was reopening it in the
-- Normal Invoice form (Category/Stitches/formula controls), because the
-- edit screen had no reliable way to tell the two apart — it always
-- rendered CreateInvoiceForm regardless of how the invoice was created.
--
-- invoice_mode is the smallest clean discriminator: 'standard' for a
-- category/formula invoice (CreateInvoiceForm), 'quick' for a manual
-- description/quantity/unit-price invoice (QuickInvoiceForm) — set once
-- server-side when the invoice is created or edited (see
-- invoice.service.ts), from the same "does this item have a
-- categoryId" signal createInvoiceItem already uses to pick
-- createInvoiceItem vs createManualInvoiceItem. Never client-supplied,
-- so the frontend can't lie about which editor an invoice should reopen in.
--
-- Backfill: an existing invoice is 'quick' only if it has at least one
-- item and every one of them is a manual item (category_id IS NULL) —
-- the exact same condition createInvoice/updateInvoice will compute
-- going forward. Everything else (including an invoice with zero items,
-- which shouldn't exist but is handled safely) defaults to 'standard'.
ALTER TABLE invoices
  ADD COLUMN invoice_mode text NOT NULL DEFAULT 'standard' CHECK (invoice_mode IN ('standard', 'quick'));

UPDATE invoices i
   SET invoice_mode = 'quick'
 WHERE EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id)
   AND NOT EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id AND it.category_id IS NOT NULL);
