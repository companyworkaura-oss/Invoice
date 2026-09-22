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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuidParam(value: string, name = 'id'): string {
  if (!UUID_RE.test(value)) throw badRequest('Validation failed', { [name]: 'Must be a UUID' });
  return value;
}

export function requireUuid(body: Body, key: string): string {
  return requireUuidParam(requireString(body, key, { max: 100 }), key);
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(body: Body, key: string): string | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw badRequest('Validation failed', { [key]: 'Must be a date like 2025-01-31' });
  }
  return raw;
}
