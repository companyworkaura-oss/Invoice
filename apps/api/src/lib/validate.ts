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
