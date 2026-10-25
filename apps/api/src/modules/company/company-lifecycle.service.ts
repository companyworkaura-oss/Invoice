import type { Role } from '@invoice/shared';
import { roleHasPermission } from '@invoice/shared';
import { pool, withTransaction } from '../../db/pool.js';
import { badRequest, forbidden, notFound } from '../../lib/http-error.js';
import { getLogoStorage } from '../../lib/storage/index.js';
import { postAuditLog } from '../audit/audit.service.js';
import type { CompanyMembership } from './membership.service.js';

/**
 * Company deactivate/reactivate/permanent-delete (Phase 27). This file
 * is deliberately separate from membership.service.ts (create/list/
 * switch) and company.service.ts (profile fields) — lifecycle state
 * changes have a different shape of safety check (ownership, "is this
 * your only company", typed confirmation) than either of those.
 */

const MEMBERSHIP_COLUMNS = 'c.id, c.name, c.default_currency AS "defaultCurrency", m.role';

async function lockCompanyForUpdate(
  client: { query: typeof pool.query },
  companyId: string,
): Promise<{ name: string; status: 'active' | 'deactivated'; logoUrl: string | null }> {
  const { rows } = await client.query<{ name: string; status: 'active' | 'deactivated'; logoUrl: string | null }>(
    `SELECT name, status, logo_url AS "logoUrl" FROM companies WHERE id = $1 FOR UPDATE`,
    [companyId],
  );
  if (!rows[0]) throw notFound('Company not found');
  return rows[0];
}

/**
 * Serializes every deactivate/delete this user performs, across
 * concurrent requests/sessions, so two lifecycle actions racing to
 * each remove one of the user's last two active companies can never
 * both pass the "another active company exists" check before either
 * commits (F02). An ordinary row lock can't protect this invariant —
 * it spans every company the user belongs to, not one row — so this
 * takes a transaction-scoped Postgres advisory lock keyed on the
 * user's id instead. It's automatically released at COMMIT/ROLLBACK
 * (pg_advisory_xact_lock, not the session-scoped pg_advisory_lock),
 * matching withTransaction's lifecycle exactly, and hashtextextended
 * turns the user's uuid into the bigint key the function requires.
 */
async function lockUserForLifecycleChange(client: { query: typeof pool.query }, userId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
}

/** The caller's role in a *specific* company, independent of which company their session currently has active — reactivate targets a company that, by definition, can't be the active one. */
async function getMembershipRole(client: { query: typeof pool.query }, companyId: string, userId: string): Promise<Role | null> {
  const { rows } = await client.query<{ role: Role }>(
    'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
    [companyId, userId],
  );
  return rows[0]?.role ?? null;
}

function requireMembershipPermission(role: Role | null, permission: 'company.deactivate' | 'company.delete'): asserts role is Role {
  if (!role) throw forbidden('Not a member of this company');
  if (!roleHasPermission(role, permission)) throw forbidden('You do not have permission to do this');
}

/**
 * Picks another ACTIVE company this user belongs to (oldest first,
 * same tiebreak as login's default-membership pick) — a deactivated
 * company never counts, which is the whole fix for F02 ("stranding"
 * a user: the old safety check counted every membership regardless of
 * status, so a user with one active + one already-deactivated company
 * could deactivate/delete their only active one and be left with zero
 * active companies). Doing one call here both answers "is this
 * deactivate/delete safe to proceed with" (null means no — the caller
 * must block) and, when it's not null, supplies the exact company to
 * re-point the caller's own session to — one query serves both jobs,
 * so the safety check and the repoint target can never disagree.
 */
async function pickAnotherActiveCompany(
  client: { query: typeof pool.query },
  userId: string,
  excludingCompanyId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ companyId: string }>(
    `SELECT m.company_id AS "companyId"
       FROM company_members m
       JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = $1 AND m.company_id != $2 AND c.status = 'active'
      ORDER BY m.created_at
      LIMIT 1`,
    [userId, excludingCompanyId],
  );
  return rows[0]?.companyId ?? null;
}

export interface LifecycleResult extends CompanyMembership {
  status: 'active' | 'deactivated';
  deactivatedAt: string | null;
}

/**
 * Deactivates the caller's current company: hides it from the active
 * switcher/login/session resolution (requireAuth, login, and
 * switchCompany all filter on companies.status = 'active'), but touches
 * nothing else — every invoice, customer, ledger entry, payment, and
 * audit row this company owns is completely untouched. Reversible via
 * reactivateCompany.
 */
export async function deactivateCompany(companyId: string, userId: string, sessionId: string): Promise<{ newActiveCompanyId: string | null }> {
  return withTransaction(async (client) => {
    // Must come before locking the company row: this is what prevents
    // two concurrent deactivate/delete calls from this same user (e.g.
    // their last two active companies, raced from two tabs/sessions)
    // from both reading "another active company exists" before either
    // has committed. See lockUserForLifecycleChange's doc comment.
    await lockUserForLifecycleChange(client, userId);
    const company = await lockCompanyForUpdate(client, companyId);
    const role = await getMembershipRole(client, companyId, userId);
    requireMembershipPermission(role, 'company.deactivate');
    if (company.status === 'deactivated') {
      throw badRequest('Validation failed', { status: 'This company is already deactivated' });
    }

    // F02: must be another ACTIVE company, never just another
    // membership — a membership in an already-deactivated company
    // doesn't give the user anywhere to land, so it must not count.
    const newActiveCompanyId = await pickAnotherActiveCompany(client, userId, companyId);
    if (!newActiveCompanyId) {
      throw badRequest('Validation failed', {
        company: 'You have no other active company. Create or reactivate another company before deactivating this one.',
      });
    }

    await client.query(`UPDATE companies SET status = 'deactivated', deactivated_at = now() WHERE id = $1`, [companyId]);
    await postAuditLog(client, {
      companyId,
      userId,
      action: 'COMPANY_DEACTIVATED',
      entityType: 'company',
      entityId: companyId,
      metadata: { companyName: company.name },
    });

    // The caller's own session was (by construction — this route only
    // ever acts on the active company) pointing here. Re-point it to
    // the active company already found above, in the same transaction,
    // so their very next request lands somewhere real instead of a 401
    // from requireAuth's status filter.
    await client.query('UPDATE sessions SET company_id = $1 WHERE id = $2 AND user_id = $3', [
      newActiveCompanyId,
      sessionId,
      userId,
    ]);

    return { newActiveCompanyId };
  });
}

/**
 * Restores a deactivated company — the exact reverse of deactivate,
 * and the only lifecycle action that must work while a *different*
 * company is the caller's active one (a deactivated company can never
 * itself be `requireAuth`'s resolved company), so this looks up the
 * caller's role in the *target* company directly rather than trusting
 * the session's current role.
 */
export async function reactivateCompany(companyId: string, userId: string): Promise<LifecycleResult> {
  return withTransaction(async (client) => {
    const company = await lockCompanyForUpdate(client, companyId);
    const role = await getMembershipRole(client, companyId, userId);
    requireMembershipPermission(role, 'company.deactivate');
    if (company.status === 'active') {
      throw badRequest('Validation failed', { status: 'This company is already active' });
    }

    await client.query(`UPDATE companies SET status = 'active', deactivated_at = NULL WHERE id = $1`, [companyId]);
    await postAuditLog(client, {
      companyId,
      userId,
      action: 'COMPANY_REACTIVATED',
      entityType: 'company',
      entityId: companyId,
      metadata: { companyName: company.name },
    });

    const { rows } = await client.query<CompanyMembership>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM company_members m JOIN companies c ON c.id = m.company_id
        WHERE m.company_id = $1 AND m.user_id = $2`,
      [companyId, userId],
    );
    return { ...rows[0], status: 'active', deactivatedAt: null };
  });
}

/**
 * Permanently deletes the caller's current company and everything it
 * owns — invoices, invoice_items, customers, categories, payments,
 * ledger_entries, audit_logs, invoice_counters, and company_members —
 * in one transaction. None of those tables are deleted from by name
 * here: every one of them already has `ON DELETE CASCADE` back to
 * companies.id (confirmed against every migration before writing this),
 * so a single `DELETE FROM companies` is both the simplest and the
 * safest way to do it — there is no hand-maintained list of tables to
 * keep in sync with the schema as it grows, and nothing can be
 * accidentally left orphaned by this function forgetting a table a
 * future migration adds (it would need its own CASCADE to begin with,
 * same as every existing one).
 *
 * The one row that must *not* be swept up by that cascade is this
 * event's own record — company_deletion_log has no foreign key back to
 * companies at all, specifically so it survives.
 */
interface DeleteResult {
  newActiveCompanyId: string | null;
  logoUrl: string | null;
}

export async function deleteCompanyPermanently(
  companyId: string,
  userId: string,
  sessionId: string,
  confirmName: string,
): Promise<{ newActiveCompanyId: string | null }> {
  const result = await withTransaction<DeleteResult>(async (client) => {
    // Same race protection as deactivateCompany — see
    // lockUserForLifecycleChange's doc comment.
    await lockUserForLifecycleChange(client, userId);
    const company = await lockCompanyForUpdate(client, companyId);
    const role = await getMembershipRole(client, companyId, userId);
    requireMembershipPermission(role, 'company.delete');
    if (confirmName !== company.name) {
      throw badRequest('Validation failed', { confirmName: 'Type the company name exactly to confirm deletion' });
    }

    // F02: must be another ACTIVE company, never just another
    // membership — see pickAnotherActiveCompany's doc comment.
    const newActiveCompanyId = await pickAnotherActiveCompany(client, userId, companyId);
    if (!newActiveCompanyId) {
      throw badRequest('Validation failed', {
        company: 'You have no other active company. Create or reactivate another company before deleting this one.',
      });
    }

    const counts = await client.query<{ members: string; customers: string; invoices: string; payments: string; email: string }>(
      `SELECT
         (SELECT count(*) FROM company_members WHERE company_id = $1) AS members,
         (SELECT count(*) FROM customers WHERE company_id = $1) AS customers,
         (SELECT count(*) FROM invoices WHERE company_id = $1) AS invoices,
         (SELECT count(*) FROM payments WHERE company_id = $1) AS payments,
         (SELECT email FROM users WHERE id = $2) AS email`,
      [companyId, userId],
    );
    const snapshot = counts.rows[0];

    // Re-point the caller's own session away from this company *before*
    // the delete below — so when the company (and every session still
    // pointing at it) cascades away, this session's row has already
    // moved and survives. (newActiveCompanyId was already resolved by
    // the F02 safety check above — reusing it here, rather than
    // querying again, means the check and the repoint target can never
    // disagree.) Every *other* member's session pointing here is
    // deliberately left alone and lets the cascade remove it — the same
    // "a vanished tenant logs its members out" behavior a revoked
    // membership already causes today (see requireAuth), not a new kind
    // of failure this feature introduces.
    await client.query('UPDATE sessions SET company_id = $1 WHERE id = $2 AND user_id = $3', [
      newActiveCompanyId,
      sessionId,
      userId,
    ]);

    // Durable, outside the cascade — see this function's doc comment.
    await client.query(
      `INSERT INTO company_deletion_log
         (company_id, company_name, deleted_by_user_id, deleted_by_user_email, member_count, customer_count, invoice_count, payment_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [companyId, company.name, userId, snapshot.email, snapshot.members, snapshot.customers, snapshot.invoices, snapshot.payments],
    );

    await client.query('DELETE FROM companies WHERE id = $1', [companyId]);

    return { newActiveCompanyId, logoUrl: company.logoUrl };
  });

  // Best-effort, after commit — same convention as the logo-replace path
  // in company.routes.ts. A failure here never undoes the
  // already-committed deletion; it just leaves an orphaned file on disk,
  // which is a cheap, non-accounting-affecting cleanup miss.
  if (result.logoUrl) await getLogoStorage().delete(result.logoUrl).catch(() => undefined);
  return { newActiveCompanyId: result.newActiveCompanyId };
}
