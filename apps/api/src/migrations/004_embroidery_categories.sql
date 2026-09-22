-- Phase 5: embroidery categories, each with its own default rate and
-- formula configuration. Categories are company-defined data, never
-- hard-coded — formula_type is just a label the application interprets;
-- new types are added in code, not by migrating this table.

CREATE TABLE embroidery_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  description     text,
  default_rate    numeric(12,2) NOT NULL DEFAULT 0,
  -- Free-form label naming which formula this category uses (e.g. "fixed",
  -- "per_unit"). Intentionally not a CHECK-constrained enum: new formula
  -- types must not require a migration.
  formula_type    text NOT NULL DEFAULT 'fixed',
  -- Parameters for formula_type, shape depends on the type. Whoever
  -- evaluates a formula later decides how to read this.
  formula_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX embroidery_categories_company_idx ON embroidery_categories (company_id, active, created_at DESC);
