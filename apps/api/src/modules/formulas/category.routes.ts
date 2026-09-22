import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalJsonObject, optionalMoney, optionalString, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './category.service.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

// Any member of the company (owner, admin, or staff) can manage categories —
// day-to-day pricing setup, not a company-level setting.

categoriesRouter.post('/', async (req, res) => {
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

categoriesRouter.get('/', async (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : 'active';
  if (!['active', 'disabled', 'all'].includes(statusParam)) {
    throw badRequest('Validation failed', { status: 'Must be active, disabled, or all' });
  }
  const categories = await service.listCategories(auth(req).companyId, {
    status: statusParam as 'active' | 'disabled' | 'all',
  });
  res.json(categories);
});

categoriesRouter.get('/:categoryId', async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.getCategory(auth(req).companyId, categoryId));
});

categoriesRouter.patch('/:categoryId', async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  const body = asBody(req.body);
  const category = await service.updateCategory(auth(req).companyId, categoryId, {
    name: optionalString(body, 'name', { max: 200 }),
    description: optionalString(body, 'description', { max: 2000 }),
    defaultRate: optionalMoney(body, 'defaultRate'),
    formulaType: optionalString(body, 'formulaType', { max: 50 }),
    formulaConfig: optionalJsonObject(body, 'formulaConfig'),
  });
  res.json(category);
});

categoriesRouter.post('/:categoryId/disable', async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.setActive(auth(req).companyId, categoryId, false));
});

categoriesRouter.post('/:categoryId/enable', async (req, res) => {
  const categoryId = requireUuidParam(req.params.categoryId, 'categoryId');
  res.json(await service.setActive(auth(req).companyId, categoryId, true));
});
