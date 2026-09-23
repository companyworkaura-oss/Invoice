import type { DashboardRange, DashboardSummary } from '@invoice/shared';
import { api } from '../../lib/api';

export interface DashboardParams {
  range: DashboardRange;
  from?: string;
  to?: string;
}

export function getDashboard(params: DashboardParams) {
  const query = new URLSearchParams({ range: params.range });
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return api<DashboardSummary>(`/dashboard?${query.toString()}`);
}
