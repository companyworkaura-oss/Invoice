-- Phase 3: company profile fields, used later to auto-fill invoices.

ALTER TABLE companies RENAME COLUMN currency_code TO default_currency;

ALTER TABLE companies
  ADD COLUMN factory_name             text,
  ADD COLUMN owner_name               text,
  ADD COLUMN logo_url                 text,
  ADD COLUMN phone                    text,
  ADD COLUMN whatsapp                 text,
  ADD COLUMN email                    text,
  ADD COLUMN address                  text,
  ADD COLUMN tax_number               text,
  ADD COLUMN invoice_prefix           text NOT NULL DEFAULT 'INV',
  ADD COLUMN default_invoice_template text NOT NULL DEFAULT 'default',
  ADD COLUMN invoice_terms            text;
