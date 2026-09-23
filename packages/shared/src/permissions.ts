import type { Role } from './entities.js';

/**
 * Every permission this app currently knows about (Phase 17). Adding a
 * future module's permissions is: add the string(s) here, add them to
 * whichever role(s) in ROLE_PERMISSIONS should have them, and gate the
 * new routes with requirePermission(...) — no other plumbing changes.
 */
export const PERMISSIONS = [
  'invoice.view',
  'invoice.create',
  'invoice.edit',
  'invoice.cancel',
  'customer.view',
  'customer.create',
  'customer.edit',
  'payment.view',
  'payment.create',
  'formula.view',
  'formula.manage',
  'company.manage',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Single source of truth for what each role can do — imported by both
 * apps/api's requirePermission middleware and the frontend (to
 * conditionally render actions a role can't perform). There is no
 * per-user override and no permissions column on company_members: this
 * is plain role-based access control, not a per-user ACL, matching
 * "OWNER has all permissions" and the fixed initial permission list.
 *
 * OWNER always has literally every permission above — spelled out as
 * `PERMISSIONS` itself, not hand-copied, so a newly added permission is
 * automatically granted to owner without editing this map.
 *
 * ADMIN has every permission except users.manage — reserved for owner,
 * the one role a company can't lose (every company always has exactly
 * one owner; see membership.service.ts).
 *
 * STAFF keeps the operational access this app already granted any
 * member before this phase (see the "any member can manage
 * customers/categories" / "any authenticated company member can record
 * a payment" comments this replaces in customer.routes.ts,
 * category.routes.ts, and payment.routes.ts) — day-to-day data entry,
 * but never company settings, user access, or the more consequential
 * invoice.edit/invoice.cancel (which, as of Phase 17, no route exposes
 * to any role yet — invoices still have no PATCH/edit or cancel
 * endpoint, by design; these two permissions are defined ready for
 * whichever future phase adds one).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'users.manage'),
  staff: [
    'invoice.view',
    'invoice.create',
    'customer.view',
    'customer.create',
    'customer.edit',
    'payment.view',
    'payment.create',
    'formula.view',
    'formula.manage',
  ],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission);
}
