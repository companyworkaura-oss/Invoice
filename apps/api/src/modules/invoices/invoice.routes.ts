import { Router, type Request } from 'express';
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
import { config } from '../../config.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';
import { buildInvoiceWhatsAppShare } from './whatsapp-share.service.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const STATUSES = ['draft', 'issued'] as const;
const PAYMENT_STATUSES = ['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'] as const;
const ARCHIVED_FILTERS = ['active', 'archived', 'all'] as const;

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

invoicesRouter.post('/', requirePermission('invoice.create'), async (req, res) => {
  const body = asBody(req.body);

  const status = optionalString(body, 'status', { max: 20 });
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    throw badRequest('Validation failed', { status: `Must be one of: ${STATUSES.join(', ')}` });
  }

  const invoice = await service.createInvoice(auth(req).companyId, auth(req).userId, {
    customerId: requireUuid(body, 'customerId'),
    invoiceDate: optionalDate(body, 'invoiceDate'),
    quantity: requirePositiveDecimal(body, 'quantity'),
    notes: optionalString(body, 'notes', { max: 2000 }),
    status: status as service.InvoiceStatus | undefined,
    items: parseItems(body),
  });
  res.status(201).json(invoice);
});

function queryString(req: Request, key: string): string | undefined {
  return typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined;
}

invoicesRouter.get('/', requirePermission('invoice.view'), async (req, res) => {
  const status = queryString(req, 'status');
  const customerId = queryString(req, 'customerId');
  const search = queryString(req, 'search');
  const from = optionalDate({ from: req.query.from }, 'from');
  const to = optionalDate({ to: req.query.to }, 'to');

  const paymentStatusRaw = queryString(req, 'paymentStatus');
  if (paymentStatusRaw && !(PAYMENT_STATUSES as readonly string[]).includes(paymentStatusRaw)) {
    throw badRequest('Validation failed', { paymentStatus: `Must be one of: ${PAYMENT_STATUSES.join(', ')}` });
  }
  const paymentStatus = paymentStatusRaw as service.InvoicePaymentStatus | undefined;

  const archivedRaw = queryString(req, 'archived');
  if (archivedRaw && !(ARCHIVED_FILTERS as readonly string[]).includes(archivedRaw)) {
    throw badRequest('Validation failed', { archived: `Must be one of: ${ARCHIVED_FILTERS.join(', ')}` });
  }
  const archived = archivedRaw as service.InvoiceArchivedFilter | undefined;

  res.json(
    await service.listInvoices(auth(req).companyId, { status, customerId, from, to, paymentStatus, search, archived }),
  );
});

invoicesRouter.get('/:invoiceId', requirePermission('invoice.view'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await service.getInvoice(auth(req).companyId, invoiceId));
});

// Copies this invoice's items into a brand-new draft; never copies
// payments or ledger entries — see duplicateInvoice in invoice.service.ts.
invoicesRouter.post('/:invoiceId/duplicate', requirePermission('invoice.create'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  const invoice = await service.duplicateInvoice(auth(req).companyId, auth(req).userId, invoiceId);
  res.status(201).json(invoice);
});

// Hides the invoice from the default list without touching ledger
// entries, items, or payments — see archiveInvoice in invoice.service.ts.
invoicesRouter.patch('/:invoiceId/archive', requirePermission('invoice.archive'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await service.archiveInvoice(auth(req).companyId, auth(req).userId, invoiceId));
});

invoicesRouter.patch('/:invoiceId/unarchive', requirePermission('invoice.archive'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await service.unarchiveInvoice(auth(req).companyId, auth(req).userId, invoiceId));
});

// Permanently removes an invoice — only when it's still a draft with no
// payment applied to it; see deleteInvoice in invoice.service.ts for the
// exact safety rules. Returns a small JSON body (not a bare 204) so the
// frontend's shared api() wrapper, which always expects a JSON body,
// doesn't need a special case for this one route.
invoicesRouter.delete('/:invoiceId', requirePermission('invoice.delete'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  await service.deleteInvoice(auth(req).companyId, auth(req).userId, invoiceId);
  res.status(200).json({ deleted: true, id: invoiceId });
});

// A4 PDF, rendered server-side from this invoice's saved snapshots — see
// pdf/pdf.service.ts. ?template= previews a different template for this
// one download without changing the company's default.
invoicesRouter.get('/:invoiceId/pdf', requirePermission('invoice.view'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  const templateId = typeof req.query.template === 'string' ? req.query.template : undefined;
  const { buffer, filename } = await generateInvoicePdf(auth(req).companyId, invoiceId, templateId);
  if (config.nodeEnv === 'development') {
    console.log(`[invoice pdf] ${filename}: ${buffer.length} bytes`);
  }
  // res.end(buffer) rather than res.send(buffer): send() runs the body
  // through Express's content negotiation/ETag machinery, which is built
  // for strings and JSON, not binary payloads — end() writes the exact
  // bytes with no chance of that pipeline touching or re-encoding them.
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length.toString());
  res.end(buffer);
});

// Builds a WhatsApp share payload (message text + wa.me link) for this
// invoice, using the customer's saved WhatsApp number. Behind the
// WhatsAppService interface (see lib/whatsapp) so a future paid
// WhatsApp Business Cloud API integration is a provider swap, not a
// change to invoice logic.
invoicesRouter.get('/:invoiceId/whatsapp-share', requirePermission('invoice.view'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await buildInvoiceWhatsAppShare(auth(req).companyId, invoiceId));
});
