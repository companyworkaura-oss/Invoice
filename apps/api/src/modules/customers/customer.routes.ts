import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalClearableString, optionalMoney, optionalString, requireString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './customer.service.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

// Staff has customer.view/create/edit by default (see @invoice/shared's
// ROLE_PERMISSIONS) — day-to-day operational data, not a company-level
// setting, same as it's always been for this module.

customersRouter.post('/', requirePermission('customer.create'), async (req, res) => {
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

customersRouter.get('/', requirePermission('customer.view'), async (req, res) => {
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

customersRouter.get('/:customerId', requirePermission('customer.view'), async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  res.json(await service.getCustomer(auth(req).companyId, customerId));
});

// F12: `name` is NOT NULL (with a non-blank CHECK) — optionalString
// still rejects a present-but-blank value for it (there's nothing to
// "clear" it to). Every other field below is a nullable column, so it
// uses optionalClearableString instead: omitted stays omitted
// (undefined, leave unchanged), but an explicit null/empty value now
// comes through as `null` — the signal updateCustomer needs to
// actually clear it — rather than being rejected as invalid.
customersRouter.patch('/:customerId', requirePermission('customer.edit'), async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  const body = asBody(req.body);
  const customer = await service.updateCustomer(auth(req).companyId, customerId, {
    name: optionalString(body, 'name', { max: 200 }),
    businessName: optionalClearableString(body, 'businessName', { max: 200 }),
    phone: optionalClearableString(body, 'phone', { max: 40 }),
    whatsapp: optionalClearableString(body, 'whatsapp', { max: 40 }),
    address: optionalClearableString(body, 'address', { max: 500 }),
    notes: optionalClearableString(body, 'notes', { max: 2000 }),
  });
  res.json(customer);
});

customersRouter.post('/:customerId/archive', requirePermission('customer.edit'), async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  res.json(await service.archiveCustomer(auth(req).companyId, auth(req).userId, customerId));
});

customersRouter.post('/:customerId/unarchive', requirePermission('customer.edit'), async (req, res) => {
  const customerId = requireUuidParam(req.params.customerId, 'customerId');
  res.json(await service.unarchiveCustomer(auth(req).companyId, auth(req).userId, customerId));
});
