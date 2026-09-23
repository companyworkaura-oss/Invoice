import type { AuditAction, AuditEntityType, AuditLogEntry } from '@invoice/shared';
import { pool } from '../../db/pool.js';

// A pg Pool and a pg PoolClient (inside a transaction) share this shape.
type Queryable = Pick<typeof pool, 'query'>;

export interface AuditLogInput {
  companyId: string;
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes one audit row. Always called with the *same* transaction
 * client as the write it's auditing (same convention as
 * postLedgerEntry) — invoice/payment creation, a category rate change,
 * and a company-settings update all commit their audit entry together
 * with the change it describes, never as a separate best-effort write
 * that could silently drift from what actually happened.
 *
 * This is one indexed INSERT into a plain table with no triggers and no
 * synchronous computation — negligible next to the multi-step
 * transactions (formula evaluation, ledger balance queries, ...) it
 * already runs alongside, which is what keeps this from affecting core
 * transaction performance the way a naive design (a synchronous call
 * to an external logging service, or a heavy trigger) would.
 */
export async function postAuditLog(client: Queryable, entry: AuditLogInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      entry.companyId,
      entry.userId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export interface AuditLogFilter {
  action?: AuditAction;
  entityType?: AuditEntityType;
  from?: string;
  to?: string;
}

/** Owner/admin only — see the `audit.view` permission gate on the route. */
export async function listAuditLogs(companyId: string, filter: AuditLogFilter): Promise<AuditLogEntry[]> {
  const conditions = ['a.company_id = $1'];
  const params: unknown[] = [companyId];

  if (filter.action) {
    params.push(filter.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (filter.entityType) {
    params.push(filter.entityType);
    conditions.push(`a.entity_type = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    conditions.push(`a.created_at >= $${params.length}::date`);
  }
  if (filter.to) {
    params.push(filter.to);
    conditions.push(`a.created_at < ($${params.length}::date + interval '1 day')`);
  }

  const { rows } = await pool.query<AuditLogEntry>(
    `SELECT a.id, a.company_id AS "companyId", a.user_id AS "userId", u.full_name AS "userName",
            a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.metadata,
            a.created_at AS "createdAt"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows;
}
