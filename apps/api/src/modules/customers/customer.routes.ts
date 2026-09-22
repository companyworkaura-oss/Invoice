import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalMoney, optionalString, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './customer.service.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

// Any member of the company (owner, admin, or staff) can manage customers —
// this is day-to-day operational data, not a company-level setting.

customersRouter.post('/', async (req, res) => {
  const body = asBody(req.body);
  const customer = await service.createCustomer(auth(req).companyId, {
    name: requireString(body, 'name', { max: 200 }),
    businessName: optionalString(body, 'businessName', { max: 200 }),
    phone: optionalString(body, 'phone', { max: 40 }),
    whatsapp: optionalString(body, 'whatsapp', { max: 40 }),
    address: optionalString(body, 'address', { max: 500 }),
    openingBalance: optionalMoney(body, 'openingBalance'),
    notes: optionalString(body, 'notes', { max: 2000 }),
  });
  res.status(201).json(customer);
});

customersRouter.get('/', async (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : 'active';
  if (!['active', 'archived', 'all'].includes(statusParam)) {
    throw badRequest('Validation failed', { status: 'Must be active, archived, or all' });
  }
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;

  const customers = await service.listCustomers(auth(req).companyId, {
    status: statusParam as 'active' | 'archived' | 'all',
    search: search || undefined,
  });
  res.json(customers);
});

customersRouter.get('/:customerId', async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  res.json(await service.getCustomer(auth(req).companyId, customerId));
});

customersRouter.patch('/:customerId', async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  const body = asBody(req.body);
  const customer = await service.updateCustomer(auth(req).companyId, customerId, {
    name: optionalString(body, 'name', { max: 200 }),
    businessName: optionalString(body, 'businessName', { max: 200 }),
    phone: optionalString(body, 'phone', { max: 40 }),
    whatsapp: optionalString(body, 'whatsapp', { max: 40 }),
    address: optionalString(body, 'address', { max: 500 }),
    openingBalance: optionalMoney(body, 'openingBalance'),
    notes: optionalString(body, 'notes', { max: 2000 }),
  });
  res.json(customer);
});

customersRouter.post('/:customerId/archive', async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  res.json(await service.archiveCustomer(auth(req).companyId, customerId));
});
