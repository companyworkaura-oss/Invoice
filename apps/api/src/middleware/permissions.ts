import type { RequestHandler } from 'express';
import type { Permission } from '@invoice/shared';
import { roleHasPermission } from '@invoice/shared';
import { forbidden } from '../lib/http-error.js';
import { auth } from './auth.js';

/**
 * The one place every route gates access by permission (Phase 17) — no
 * route file ever inlines a role-name check of its own. The actual
 * role -> permission mapping lives in @invoice/shared's permissions.ts
 * (ROLE_PERMISSIONS), shared verbatim with the frontend so a role's
 * capabilities are never defined twice. Requires *every* listed
 * permission (AND, not "any of"); every current caller passes exactly
 * one, but a future route needing two permissions at once doesn't need
 * new plumbing.
 */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const { role } = auth(req);
    if (!permissions.every((p) => roleHasPermission(role, p))) throw forbidden();
    next();
  };
}
