import { Router } from 'express';
import { asBody, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
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
