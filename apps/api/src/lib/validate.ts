import { badRequest } from './http-error.js';

type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Expected a JSON object');
  return value as Body;
}

export function requireString(body: Body, key: string, opts: { min?: number; max?: number } = {}): string {
  const { min = 1, max = 200 } = opts;
  const raw = body[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length < min || value.length > max) {
    throw badRequest('Validation failed', { [key]: `Must be ${min}-${max} characters` });
  }
  return value;
}

export function requireEmail(body: Body, key = 'email'): string {
  const value = requireString(body, key, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw badRequest('Validation failed', { [key]: 'Invalid email' });
  return value;
}

export function optionalString(body: Body, key: string, opts?: { min?: number; max?: number }): string | undefined {
  return body[key] === undefined ? undefined : requireString(body, key, opts);
}

export function optionalEmail(body: Body, key: string): string | undefined {
  if (body[key] === undefined) return undefined;
  return requireEmail(body, key);
}

/**
 * For a PATCH field on a nullable column where the caller must be
 * able to tell "omitted" (leave unchanged) apart from "explicitly
 * cleared" (F08) — unlike optionalString, which rejects an empty
 * value outright, this treats one as the clear signal:
 *   - key absent from the body at all           -> undefined (omit)
 *   - present as null, "", or whitespace-only    -> null (clear)
 *   - present as a non-blank string              -> the trimmed value
 * The caller (e.g. updateCompany) is expected to apply undefined vs.
 * null vs. a string differently — never collapse them with `?? null`
 * the way a plain optional field can.
 */
export function optionalClearableString(body: Body, key: string, opts: { max?: number } = {}): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw !== null && typeof raw !== 'string') {
    throw badRequest('Validation failed', { [key]: 'Must be a string or null' });
  }
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed === '') return null;
  const max = opts.max ?? 200;
  if (trimmed.length > max) {
    throw badRequest('Validation failed', { [key]: `Must be at most ${max} characters` });
  }
  return trimmed;
}

/** Same contract as optionalClearableString, but validates a non-blank value as an email address. */
export function optionalClearableEmail(body: Body, key = 'email'): string | null | undefined {
  const value = optionalClearableString(body, key, { max: 254 });
  if (value === undefined || value === null) return value;
  const lower = value.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) throw badRequest('Validation failed', { [key]: 'Invalid email' });
  return lower;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `unknown`, not `string`: Express types req.params values as `string | string[]`
// (to allow wildcard routes elsewhere in the app), and a route with two or more
// handlers loses the path-literal narrowing to plain `string` that a single
// handler gets — so this validates defensively rather than assuming the shape.
export function requireUuidParam(value: unknown, name = 'id'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest('Validation failed', { [name]: 'Must be a UUID' });
  }
  return value;
}

export function requireUuid(body: Body, key: string): string {
  return requireUuidParam(requireString(body, key, { max: 100 }), key);
}

// base64url, no padding — matches newToken() (lib/token.ts): 32 random
// bytes is 43 characters. Used for a path param the caller controls
// entirely (e.g. the public invoice-PDF-share token), so this is
// shape validation only — an unknown/expired token is rejected later
// by whichever lookup resolves it, the same "not found" either way
// (see invoice-share.service.ts's resolveInvoicePdfShare).
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function requireTokenParam(value: unknown, name = 'token'): string {
  if (typeof value !== 'string' || !SHARE_TOKEN_RE.test(value)) {
    throw badRequest('Validation failed', { [name]: 'Invalid token' });
  }
  return value;
}

// Up to 12 integer digits and 2 decimal places — matches the numeric(14,2) columns.
// Kept as a string end-to-end: money is never parsed into a float.
const MONEY_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

export function optionalMoney(body: Body, key: string): string | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !MONEY_RE.test(raw)) {
    throw badRequest('Validation failed', { [key]: 'Must be a decimal amount like 123.45' });
  }
  return raw;
}

/**
 * Any plain JSON object, unvalidated beyond shape and size — the meaning
 * of its keys depends on a sibling "type" field the caller interprets
 * (e.g. formula_config depends on formula_type). Keeping this generic is
 * what lets new types be added without a schema change.
 */
export function optionalJsonObject(
  body: Body,
  key: string,
  opts: { maxBytes?: number } = {},
): Record<string, unknown> | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badRequest('Validation failed', { [key]: 'Must be a JSON object' });
  }
  const maxBytes = opts.maxBytes ?? 10_000;
  if (Buffer.byteLength(JSON.stringify(raw)) > maxBytes) {
    throw badRequest('Validation failed', { [key]: `Must be under ${maxBytes} bytes` });
  }
  return raw as Record<string, unknown>;
}

/** A required positive whole number, e.g. a stitch count. */
export function requirePositiveInt(body: Body, key: string, opts: { max?: number } = {}): number {
  const raw = body[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0 || (opts.max !== undefined && value > opts.max)) {
    throw badRequest('Validation failed', { [key]: 'Must be a positive whole number' });
  }
  return value;
}

// Up to 12 integer digits and a configurable number of decimal places.
function decimalPattern(decimals: number): RegExp {
  return new RegExp(`^\\d{1,12}(\\.\\d{1,${decimals}})?$`);
}

/** A required positive decimal string (>0), e.g. an invoice's item quantity. */
export function requirePositiveDecimal(body: Body, key: string, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 2;
  const raw = body[key];
  if (typeof raw !== 'string' || !decimalPattern(decimals).test(raw) || Number(raw) <= 0) {
    throw badRequest('Validation failed', {
      [key]: `Must be a decimal greater than zero with up to ${decimals} decimal places`,
    });
  }
  return raw;
}

/** Same shape as requirePositiveDecimal, but absent is fine — e.g. an invoice's optional General Quantity. */
export function optionalPositiveDecimal(body: Body, key: string, opts: { decimals?: number } = {}): string | undefined {
  if (body[key] === undefined) return undefined;
  return requirePositiveDecimal(body, key, opts);
}

/** A plain true/false flag, e.g. an invoice's Show Unit Amount / Show Item Quantity display toggles. Absent is fine. */
export function optionalBoolean(body: Body, key: string): boolean | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw badRequest('Validation failed', { [key]: 'Must be true or false' });
  }
  return raw;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(body: Body, key: string): string | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw badRequest('Validation failed', { [key]: 'Must be a date like 2025-01-31' });
  }
  return raw;
}
