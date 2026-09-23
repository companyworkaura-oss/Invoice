import type { AuditAction, AuditEntityType, AuditLogEntry } from '@invoice/shared';
import { api } from '../../lib/api';

export interface ListParams {
  action?: AuditAction;
  entityType?: AuditEntityType;
  from?: string;
  to?: string;
}

export function listAuditLogs(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.action) query.set('action', params.action);
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const qs = query.toString();
  return api<AuditLogEntry[]>(`/audit-logs${qs ? `?${qs}` : ''}`);
}
