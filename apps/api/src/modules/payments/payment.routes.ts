import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import {
  asBody,
  optionalDate,
  optionalString,
  requirePositiveDecimal,
  requireString,
  requireUuid,
  requireUuidParam,
} from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './payment.service.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'other'] as const;

// Staff has payment.view/create by default (see @invoice/shared's
// ROLE_PERMISSIONS) — same as customers/categories, this is day-to-day
// operational data.

paymentsRouter.post('/', requirePermission('payment.create'), async (req, res) => {
  const body = asBody(req.body);
  const paymentMethod = requireString(body, 'paymentMethod', { max: 20 });
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw badRequest('Validation failed', { paymentMethod: `Must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }

  const payment = await service.createPayment(auth(req).companyId, auth(req).userId, {
    customerId: requireUuid(body, 'customerId'),
    amount: requirePositiveDecimal(body, 'amount'),
    date: optionalDate(body, 'date'),
    paymentMethod: paymentMethod as service.PaymentMethod,
    reference: optionalString(body, 'reference', { max: 200 }),
    notes: optionalString(body, 'notes', { max: 2000 }),
  });
  res.status(201).json(payment);
});

paymentsRouter.get('/', requirePermission('payment.view'), async (req, res) => {
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  res.json(await service.listPayments(auth(req).companyId, { customerId }));
});

paymentsRouter.get('/:paymentId', requirePermission('payment.view'), async (req, res) => {
  const paymentId = requireUuidParam(req.params.paymentId, 'paymentId');
  res.json(await service.getPayment(auth(req).companyId, paymentId));
});
