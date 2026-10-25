-- F03: separating "preview" (GET, read-only) from "send" (POST, the
-- only path allowed to actually call out to WhatsApp Business Cloud
-- API) needs a durable way to make a repeated POST — a double-click,
-- a retried request — a no-op rather than a second real send. Each
-- row is one send *attempt* for one invoice, keyed by the client-
-- supplied idempotency key: the UNIQUE constraint is what makes a
-- second INSERT with the same (company, invoice, key) fail instead of
-- quietly succeeding, which is what the send path relies on to detect
-- "someone already claimed this" versus "this key is new, go ahead".
-- `result` is filled in once the real send (or lack of one, e.g.
-- click-to-chat mode) completes, so a replay can return the exact
-- same payload without redoing any external call.
CREATE TABLE whatsapp_send_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL,
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_id, idempotency_key)
);

CREATE INDEX whatsapp_send_requests_invoice_idx ON whatsapp_send_requests (invoice_id);
