import { Router } from 'express';
import { badRequest } from '../../lib/http-error.js';
import {
  asBody,
  optionalDate,
  optionalMoney,
  optionalString,
  requirePositiveDecimal,
  requirePositiveInt,
  requireUuid,
  requireUuidParam,
} from '../../lib/validate.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import * as service from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const STATUSES = ['draft', 'issued'] as const;

function parseItems(body: Record<string, unknown>): service.InvoiceItemInput[] {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('Validation failed', { items: 'At least one item is required' });
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw badRequest('Validation failed', { [`items[${index}]`]: 'Expected an object' });
    }
    const itemBody = entry as Record<string, unknown>;
    return {
      categoryId: requireUuid(itemBody, 'categoryId'),
      description: optionalString(itemBody, 'description', { max: 500 }),
      stitches: requirePositiveInt(itemBody, 'stitches', { max: 10_000_000 }),
      rate: optionalMoney(itemBody, 'rate'),
    };
  });
}

invoicesRouter.post('/', async (req, res) => {
  const body = asBody(req.body);

  const status = optionalString(body, 'status', { max: 20 });
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    throw badRequest('Validation failed', { status: `Must be one of: ${STATUSES.join(', ')}` });
  }

  const invoice = await service.createInvoice(auth(req).companyId, {
    customerId: requireUuid(body, 'customerId'),
    invoiceDate: optionalDate(body, 'invoiceDate'),
    quantity: requirePositiveDecimal(body, 'quantity'),
    notes: optionalString(body, 'notes', { max: 2000 }),
    status: status as service.InvoiceStatus | undefined,
    items: parseItems(body),
  });
  res.status(201).json(invoice);
});

invoicesRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  res.json(await service.listInvoices(auth(req).companyId, { status, customerId }));
});

invoicesRouter.get('/:invoiceId', async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await service.getInvoice(auth(req).companyId, invoiceId));
});

// A4 PDF, rendered server-side from this invoice's saved snapshots — see
// pdf/pdf.service.ts. ?template= previews a different template for this
// one download without changing the company's default.
invoicesRouter.get('/:invoiceId/pdf', async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  const templateId = typeof req.query.template === 'string' ? req.query.template : undefined;
  const { buffer, filename } = await generateInvoicePdf(auth(req).companyId, invoiceId, templateId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
