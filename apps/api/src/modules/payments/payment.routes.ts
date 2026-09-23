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
import * as service from './payment.service.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'other'] as const;

// Any authenticated company member can record a payment — same as
// customers/categories/invoices, this is day-to-day operational data.

paymentsRouter.post('/', async (req, res) => {
  const body = asBody(req.body);
  const paymentMethod = requireString(body, 'paymentMethod', { max: 20 });
  if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw badRequest('Validation failed', { paymentMethod: `Must be one of: ${PAYMENT_METHODS.join(', ')}` });
  }

  const payment = await service.createPayment(auth(req).companyId, {
    customerId: requireUuid(body, 'customerId'),
    amount: requirePositiveDecimal(body, 'amount'),
    date: optionalDate(body, 'date'),
    paymentMethod: paymentMethod as service.PaymentMethod,
    reference: optionalString(body, 'reference', { max: 200 }),
    notes: optionalString(body, 'notes', { max: 2000 }),
  });
  res.status(201).json(payment);
});

paymentsRouter.get('/', async (req, res) => {
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  res.json(await service.listPayments(auth(req).companyId, { customerId }));
});

paymentsRouter.get('/:paymentId', async (req, res) => {
  const paymentId = requireUuidParam(req.params.paymentId, 'paymentId');
  res.json(await service.getPayment(auth(req).companyId, paymentId));
});
