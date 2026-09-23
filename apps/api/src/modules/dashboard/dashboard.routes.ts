import { Router } from 'express';
import type { DashboardRange } from '@invoice/shared';
import { badRequest } from '../../lib/http-error.js';
import { optionalDate } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './dashboard.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const RANGES = ['today', 'month', 'custom'] as const;

// A summary of invoice/payment activity — gated the same as viewing
// invoices, since that's most of what it shows.
dashboardRouter.get('/', requirePermission('invoice.view'), async (req, res) => {
  const rangeRaw = typeof req.query.range === 'string' ? req.query.range : 'today';
  if (!(RANGES as readonly string[]).includes(rangeRaw)) {
    throw badRequest('Validation failed', { range: `Must be one of: ${RANGES.join(', ')}` });
  }
  const range = rangeRaw as DashboardRange;

  const from = optionalDate({ from: req.query.from }, 'from');
  const to = optionalDate({ to: req.query.to }, 'to');

  res.json(await service.getDashboard(auth(req).companyId, range, from, to));
});
