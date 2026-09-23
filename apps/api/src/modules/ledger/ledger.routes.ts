import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import { asBody, optionalDate, optionalMoney, optionalString, requireUuidParam } from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './ledger.service.js';
import { generateStatementPdf } from './pdf/statement-pdf.service.js';
import * as statementService from './statement.service.js';

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

const LEDGER_ENTRY_TYPES = ['OPENING_BALANCE', 'INVOICE', 'PAYMENT', 'ADJUSTMENT'] as const;

function statementFilter(req: { query: Record<string, unknown> }): statementService.StatementFilter {
  const from = optionalDate({ from: req.query.from }, 'from');
  const to = optionalDate({ to: req.query.to }, 'to');
  const typeRaw = typeof req.query.type === 'string' ? req.query.type : undefined;
  if (typeRaw && !(LEDGER_ENTRY_TYPES as readonly string[]).includes(typeRaw)) {
    throw badRequest('Validation failed', { type: `Must be one of: ${LEDGER_ENTRY_TYPES.join(', ')}` });
  }
  return { from, to, type: typeRaw as service.LedgerEntryType | undefined };
}

ledgerRouter.get('/statement', async (req, res) => {
  const customerId = customerIdParam(req);
  res.json(await statementService.getCustomerStatement(auth(req).companyId, customerId, statementFilter(req)));
});

ledgerRouter.get('/statement/pdf', async (req, res) => {
  const customerId = customerIdParam(req);
  const { buffer, filename } = await generateStatementPdf(auth(req).companyId, customerId, statementFilter(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

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
