-- Lightweight audit trail (Phase 18). Append-only, like ledger_entries —
-- nothing here is ever updated or deleted. user_id is nullable with
-- ON DELETE SET NULL so a removed user's history survives them, even
-- though nothing in this app currently hard-deletes a user row.
CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Covers the default "recent activity for this company" read; entity_id
-- lookups (e.g. "history for this one invoice") are rare enough not to
-- need their own index yet.
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id, created_at DESC);
