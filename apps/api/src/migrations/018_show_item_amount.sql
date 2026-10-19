-- Show Item Amount: a third customer-facing display toggle, the same
-- tier and pattern as show_unit_amount/show_item_quantity (migration
-- 015) — controls whether the per-item Amount/Total column is shown
-- on a printed/PDF invoice. Display-only: the underlying line amount
-- is always calculated and stored on every item regardless of this
-- flag. Defaults to true so every existing invoice keeps showing the
-- Amount column exactly as it always has.
ALTER TABLE invoices ADD COLUMN show_item_amount boolean NOT NULL DEFAULT true;
