import { Router } from 'express';
import { asBody, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as lifecycle from './company-lifecycle.service.js';
import * as membership from './membership.service.js';

/** Cross-company endpoints: list the memberships the user has, and switch or add to them. */
export const companiesRouter = Router();
companiesRouter.use(requireAuth);

companiesRouter.get('/', async (req, res) => {
  res.json(await membership.listMyCompanies(auth(req).userId));
});

companiesRouter.post('/', async (req, res) => {
  const body = asBody(req.body);
  const name = requireString(body, 'name');
  const { userId, sessionId } = auth(req);
  const company = await membership.createCompany(userId, sessionId, name);
  res.status(201).json(company);
});

companiesRouter.post('/:companyId/switch', async (req, res) => {
  const companyId = requireUuidParam(req.params.companyId, 'companyId');
  const { userId, sessionId } = auth(req);
  res.json(await membership.switchCompany(userId, sessionId, companyId));
});

// Reactivate necessarily targets a company other than the session's
// current one — a deactivated company can never itself be the active
// tenant (requireAuth excludes it) — so this checks the caller's role
// in *that* company directly rather than going through requirePermission
// (which only ever reflects the role of the session's current company).
companiesRouter.post('/:companyId/reactivate', async (req, res) => {
  const companyId = requireUuidParam(req.params.companyId, 'companyId');
  const { userId } = auth(req);
  res.json(await lifecycle.reactivateCompany(companyId, userId));
});
