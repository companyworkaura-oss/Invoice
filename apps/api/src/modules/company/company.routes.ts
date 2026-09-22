import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalString } from '../../lib/validate.js';
import { auth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as service from './company.service.js';

export const companyRouter = Router();
companyRouter.use(requireAuth);

// The tenant is always the session's company; there is no :companyId in the URL.
companyRouter.get('/', async (req, res) => {
  res.json(await service.getCompany(auth(req).companyId));
});

companyRouter.patch('/', requireRole('owner', 'admin'), async (req, res) => {
  const body = asBody(req.body);
  const name = optionalString(body, 'name');
  const currencyCode = optionalString(body, 'currencyCode', { min: 3, max: 3 })?.toUpperCase();
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) {
    throw badRequest('Validation failed', { currencyCode: 'Must be a 3-letter ISO code' });
  }
  res.json(await service.updateCompany(auth(req).companyId, { name, currencyCode }));
});
