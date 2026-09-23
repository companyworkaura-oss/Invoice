import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { unauthorized } from '../lib/http-error.js';
import { readCookie, SESSION_COOKIE } from '../lib/cookies.js';
import { hashToken } from '../lib/token.js';

export type Role = 'owner' | 'admin' | 'staff';

export interface AuthContext {
  sessionId: string;
  userId: string;
  /** Tenant for every company-owned query. Always from the session, never the request. */
  companyId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw unauthorized();

  // Joining company_members means a revoked membership kills the session immediately.
  const { rows } = await pool.query<AuthContext>(
    `SELECT s.id AS "sessionId", s.user_id AS "userId", s.company_id AS "companyId", m.role
       FROM sessions s
       JOIN company_members m ON m.company_id = s.company_id AND m.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!rows[0]) throw unauthorized();
  req.auth = rows[0];
  next();
}

/** Returns the auth context; use only in handlers mounted behind requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

// Role-gated routes use requirePermission (middleware/permissions.ts),
// never a role-name check of their own — see that file for why.
