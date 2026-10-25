-- F09: a customer-accessible, expiring share link for one invoice's
-- PDF — the WhatsApp message's PDF link used to point straight at the
-- authenticated /api/invoices/:id/pdf route, which a customer's phone
-- (no company login) could never open. Same shape as `sessions`
-- (migration 001): only a salted hash of the actual token is ever
-- stored, so a leaked database row still can't be used to forge a
-- link, and a row expires on its own via expires_at. Tied to exactly
-- one invoice_id — the token alone identifies the invoice; the public
-- route takes no separate invoice id a caller could swap out.
CREATE TABLE invoice_pdf_share_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_pdf_share_tokens_invoice_idx ON invoice_pdf_share_tokens (invoice_id);
CREATE INDEX invoice_pdf_share_tokens_expires_idx ON invoice_pdf_share_tokens (expires_at);
