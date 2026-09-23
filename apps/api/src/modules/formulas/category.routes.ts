import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalJsonObject, optionalMoney, optionalString, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './category.service.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

// Staff has formula.manage by default (see @invoice/shared's
// ROLE_PERMISSIONS) — day-to-day pricing setup, not a company-level
// setting, same as it's always been for this module.

categoriesRouter.post('/', requirePermission('formula.manage'), async (req, res) => {
  const body = asBody(req.body);
  const category = await service.createCategory(auth(req).companyId, {
    name: requireString(body, 'name', { max: 200 }),
    description: optionalString(body, 'description', { max: 2000 }),
    defaultRate: optionalMoney(body, 'defaultRate'),
    formulaType: optionalString(body, 'formulaType', { max: 50 }),
    formulaConfig: optionalJsonObject(body, 'formulaConfig'),
  });
  res.status(201).json(category);
});

categoriesRouter.get('/', requirePermission('formula.view'), async (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : 'active';
  if (!['active', 'disabled', 'all'].includes(statusParam)) {
    throw badRequest('Validation failed', { status: 'Must be active, disabled, or all' });
  }
  const categories = await service.listCategories(auth(req).companyId, {
    status: statusParam as 'active' | 'disabled' | 'all',
  });
  res.json(categories);
});

categoriesRouter.get('/:categoryId', requirePermission('formula.view'), async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.getCategory(auth(req).companyId, categoryId));
});

categoriesRouter.patch('/:categoryId', requirePermission('formula.manage'), async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  const body = asBody(req.body);
  const category = await service.updateCategory(auth(req).companyId, categoryId, auth(req).userId, {
    name: optionalString(body, 'name', { max: 200 }),
    description: optionalString(body, 'description', { max: 2000 }),
    defaultRate: optionalMoney(body, 'defaultRate'),
    formulaType: optionalString(body, 'formulaType', { max: 50 }),
    formulaConfig: optionalJsonObject(body, 'formulaConfig'),
  });
  res.json(category);
});

categoriesRouter.post('/:categoryId/disable', requirePermission('formula.manage'), async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.setActive(auth(req).companyId, categoryId, false));
});

categoriesRouter.post('/:categoryId/enable', requirePermission('formula.manage'), async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.setActive(auth(req).companyId, categoryId, true));
});
