import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Basic brute-force/spam protection for the two unauthenticated auth
 * endpoints (Phase 19 security audit — "rate limiting where
 * appropriate"). In-memory, per-process: fine for this app's scale and
 * consistent with everything else here staying dependency-light — no
 * Redis or other shared store to run/operate. A restart clears counters,
 * which is an acceptable trade-off for this app's threat model; the
 * constant-time password comparison and generic "Invalid email or
 * password" message (see auth.service.ts) remain the primary defenses
 * even without this.
 *
 * Disabled under `config.rateLimitDisabled` (test env only — the test
 * suite legitimately registers/logs in far more than a real client
 * would in the same window). The middleware itself, not just the
 * config flag, is verified directly in test/security.test.ts against a
 * throwaway app instance.
 */
const noop: RequestHandler = (_req, _res, next) => next();

function limiterOrNoop(options: Parameters<typeof rateLimit>[0]): RequestHandler {
  return config.rateLimitDisabled ? noop : rateLimit(options);
}

export const loginRateLimiter = limiterOrNoop({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

export const registerRateLimiter = limiterOrNoop({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address. Try again later.' },
});
