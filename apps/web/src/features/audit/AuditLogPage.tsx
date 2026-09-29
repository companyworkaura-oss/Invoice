import type { AuditAction, AuditEntityType, AuditLogEntry } from '@invoice/shared';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as auditApi from './api';

const ACTION_LABEL: Record<AuditAction, string> = {
  INVOICE_CREATED: 'Invoice created',
  INVOICE_EDITED: 'Invoice edited',
  INVOICE_CANCELLED: 'Invoice cancelled',
  INVOICE_ARCHIVED: 'Invoice archived',
  INVOICE_UNARCHIVED: 'Invoice restored',
  INVOICE_DELETED: 'Invoice deleted',
  PAYMENT_CREATED: 'Payment created',
  PAYMENT_EDITED: 'Payment edited',
  FORMULA_CHANGED: 'Formula changed',
  RATE_CHANGED: 'Rate changed',
  COMPANY_SETTINGS_CHANGED: 'Company settings changed',
};

const ENTITY_LABEL: Record<AuditEntityType, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  formula: 'Formula',
  company: 'Company',
};

function formatMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' · ');
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function AuditLogPage() {
  const [action, setAction] = useState<AuditAction | ''>('');
  const [entityType, setEntityType] = useState<AuditEntityType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (from && to && from > to) return; // wait for a valid range before fetching
    let cancelled = false;
    auditApi
      .listAuditLogs({ action: action || undefined, entityType: entityType || undefined, from: from || undefined, to: to || undefined })
      .then((result) => {
        if (cancelled) return;
        setLogs(result);
        setLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setLogs([]);
        setLoadError('Could not load the audit log.');
      });
    return () => {
      cancelled = true;
    };
  }, [action, entityType, from, to]);

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">Audit Log</h2>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | '')}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value as AuditEntityType | '')}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">All entities</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="text-xs font-medium text-slate-500">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {from && to && from > to && <p className="mt-2 text-sm text-red-600">"From" must be on or before "To".</p>}
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}

      {logs === null ? (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No activity matches these filters.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2 font-medium">Time</th>
                <th className="py-1.5 pr-2 font-medium">User</th>
                <th className="py-1.5 pr-2 font-medium">Action</th>
                <th className="py-1.5 pr-2 font-medium">Entity</th>
                <th className="py-1.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500">{formatTimestamp(log.createdAt)}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{log.userName ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-slate-900">{ACTION_LABEL[log.action]}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{ENTITY_LABEL[log.entityType]}</td>
                  <td className="py-1.5 text-slate-500">{formatMetadata(log.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
