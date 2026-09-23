import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns a request id (reusing one from an upstream proxy/load balancer
 * if it already set one) and logs one structured JSON line per request
 * on completion — method, path, status, duration. Never logs the body
 * or headers (session cookie, Authorization, password fields in a
 * login/register payload would all end up in aggregated logs otherwise)
 * — see DEPLOYMENT.md's "Do not expose secrets" note.
 */
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  req.requestId = (typeof incoming === 'string' && incoming) || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    // Quiet in the test env — request-id assignment above still runs
    // (harmless, occasionally useful for a test), only the noisy
    // per-request log line is skipped so `npm test` output stays
    // readable. Not skipped in production or dev.
    if (config.isTest) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      JSON.stringify({
        level: 'info',
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  });

  next();
}
