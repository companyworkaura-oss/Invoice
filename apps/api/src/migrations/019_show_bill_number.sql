-- Show Bill Number: a customer-facing print/PDF visibility toggle for
-- Bill Number, the same tier and pattern as show_item_amount
-- (migration 018) — controls only whether "Bill #: ..." appears on a
-- printed/PDF/WhatsApp invoice. The stored bill_number column itself
-- is completely untouched: it's never cleared, and stays visible,
-- editable, and searchable inside the app regardless of this flag.
-- Defaults to true so every existing invoice keeps showing Bill
-- Number on print exactly as it always has.
ALTER TABLE invoices ADD COLUMN show_bill_number boolean NOT NULL DEFAULT true;
