-- F11: Quick Invoice's "create, then mark Paid" used to be two (or
-- three, with a refetch) separate client-driven requests with nothing
-- tying them together server-side. A dropped response after the
-- invoice was created but before the client learned the save
-- succeeded, followed by a naive retry, could re-POST the whole save
-- and create a second, duplicate invoice. This table is the same
-- claim/finalize pattern whatsapp_send_requests (migration 021) uses:
-- each row is one create-and-pay *attempt*, keyed by a client-supplied
-- idempotency key. The UNIQUE constraint makes a second INSERT with
-- the same (company, key) fail instead of quietly succeeding, which
-- is what createInvoice's idempotency wrapper relies on to tell "I
-- won the claim, go ahead" apart from "someone already claimed this —
-- wait for or return their result". invoice_id is NULL while the
-- attempt is still in flight and is filled in once the invoice (and,
-- if requested, its initial payment) commits, so a retry with the
-- same key can return the exact same invoice without creating another
-- one. ON DELETE CASCADE on invoice_id, not NOT NULL, since a claim
-- that never finishes (the attempt threw) is released (deleted)
-- rather than left pointing at nothing.
CREATE TABLE invoice_save_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  idempotency_key  text NOT NULL,
  invoice_id       uuid REFERENCES invoices(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX invoice_save_requests_invoice_idx ON invoice_save_requests (invoice_id);
