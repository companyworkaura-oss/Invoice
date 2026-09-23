import { Router } from 'express';
import { asBody, optionalDate, optionalMoney, optionalString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './ledger.service.js';

/** Mounted at /api/customers/:customerId/ledger (mergeParams for :customerId). */
export const ledgerRouter = Router({ mergeParams: true });
ledgerRouter.use(requireAuth);

function customerIdParam(req: { params: Record<string, string> }): string {
  return requireUuidParam(req.params.customerId, 'customerId');
}

ledgerRouter.get('/', async (req, res) => {
  const customerId = customerIdParam(req);
  const { entries, balance } = await service.getCustomerLedger(auth(req).companyId, customerId);
  res.json({ customerId, entries, balance });
});

// Payments are recorded through the payments module (POST /api/payments),
// which creates the payment record and this same PAYMENT credit entry in
// one transaction — see modules/payments/payment.service.ts.

ledgerRouter.post('/adjustments', async (req, res) => {
  const customerId = customerIdParam(req);
  const body = asBody(req.body);
  const entry = await service.recordAdjustment(auth(req).companyId, customerId, {
    debit: optionalMoney(body, 'debit'),
    credit: optionalMoney(body, 'credit'),
    date: optionalDate(body, 'date'),
    notes: optionalString(body, 'notes', { max: 2000 }),
  });
  res.status(201).json(entry);
});
