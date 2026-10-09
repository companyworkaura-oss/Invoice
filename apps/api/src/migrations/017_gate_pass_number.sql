-- Gate Pass Number: a manual, free-text field — the gate pass number
-- that came with the client's material. Entered by the user, never
-- auto-assigned or validated beyond basic length (letters, digits,
-- slashes, dashes all allowed). Shown on customer-facing print/PDF/
-- WhatsApp, same tier as bill_number (migration 015) — pure metadata,
-- never used in any calculation.
ALTER TABLE invoices ADD COLUMN gate_pass_number text NULL;
