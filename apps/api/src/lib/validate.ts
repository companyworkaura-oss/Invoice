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
