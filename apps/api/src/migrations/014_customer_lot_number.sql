-- Customer Lot Number (Phase 29): a second, customer-provided lot
-- number, separate from the existing lot_number column — which keeps
-- its exact name, data, and meaning and becomes the INTERNAL lot
-- number (factory/business-internal, never shown on customer-facing
-- print/PDF). No historical data is touched or reinterpreted: every
-- existing lot_number value stays exactly where it is, meaning exactly
-- what it always meant.
ALTER TABLE invoices ADD COLUMN customer_lot_number text NULL;
