import { Router, type Request } from 'express';
import { roleHasPermission } from '@invoice/shared';
import { badRequest, forbidden } from '../../lib/http-error.js';
import {
  asBody,
  optionalBoolean,
  optionalDate,
  optionalMoney,
  optionalPositiveDecimal,
  optionalString,
  requirePositiveDecimal,
  requirePositiveInt,
  requireString,
  requireUuid,
  requireUuidParam,
} from '../../lib/validate.js';
import { config } from '../../config.js';
import { auth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import * as service from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';
import { previewInvoiceWhatsAppShare, sendInvoiceWhatsAppShare } from './whatsapp-share.service.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const STATUSES = ['draft', 'issued'] as const;
const PAYMENT_STATUSES = ['PAID', 'PARTIAL', 'UNPAID', 'CANCELLED'] as const;
const ARCHIVED_FILTERS = ['active', 'archived', 'all'] as const;
const DISCOUNT_TYPES = ['percentage', 'fixed'] as const;
const PAYMENT_METHODS = ['cash', 'bank', 'cheque', 'other'] as const;

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
    // This item's own quantity — each category/line carries its own
    // (e.g. BAZU=12, FRONT=8), never one invoice-wide value. Optional;
    // defaults to "1" server-side (see createInvoiceItem) when omitted.
    const quantity = itemBody.quantity === undefined ? undefined : requirePositiveDecimal(itemBody, 'quantity');

    // A manual (Quick Invoice) item has no categoryId — presence of that
    // field is what selects the embroidery-formula path below versus
    // the plain description/quantity/unitPrice path.
    if (itemBody.categoryId === undefined) {
      return {
        description: requireString(itemBody, 'description', { max: 500 }),
        unitPrice: requirePositiveDecimal(itemBody, 'unitPrice'),
        quantity,
      };
    }
    return {
      categoryId: requireUuid(itemBody, 'categoryId'),
      description: optionalString(itemBody, 'description', { max: 500 }),
      stitches: requirePositiveInt(itemBody, 'stitches', { max: 10_000_000 }),
      rate: optionalMoney(itemBody, 'rate'),
      quantity,
    };
  });
}

/**
 * discountType/discountValue/lotNumber/customerLotNumber/billNumber/
 * gatePassNumber/generalQuantity/showUnitAmount/showItemQuantity/
 * showItemAmount/showBillNumber — shared by create (POST /) and edit (PATCH /:id).
 */
function parseDiscountAndLot(body: Record<string, unknown>) {
  const discountType = optionalString(body, 'discountType', { max: 20 });
  if (discountType && !(DISCOUNT_TYPES as readonly string[]).includes(discountType)) {
    throw badRequest('Validation failed', { discountType: `Must be one of: ${DISCOUNT_TYPES.join(', ')}` });
  }
  return {
    // Internal lot number — never shown on customer-facing print/PDF/WhatsApp.
    lotNumber: optionalString(body, 'lotNumber', { max: 100 }),
    // The customer's own lot number — the only one shown on customer-facing print/PDF/WhatsApp.
    customerLotNumber: optionalString(body, 'customerLotNumber', { max: 100 }),
    // A second, business-assigned number — separate from the system-generated invoice number.
    billNumber: optionalString(body, 'billNumber', { max: 100 }),
    // The gate pass number that came with the client's material — free text (letters/digits/slashes/dashes all allowed via optionalString's plain length check).
    gatePassNumber: optionalString(body, 'gatePassNumber', { max: 100 }),
    // The overall suit quantity for the whole invoice/job — never an item's own quantity, never used in a calculation.
    generalQuantity: optionalPositiveDecimal(body, 'generalQuantity'),
    // Display-only toggles for the customer-facing table columns — see InvoiceInput.
    showUnitAmount: optionalBoolean(body, 'showUnitAmount'),
    showItemQuantity: optionalBoolean(body, 'showItemQuantity'),
    showItemAmount: optionalBoolean(body, 'showItemAmount'),
    showBillNumber: optionalBoolean(body, 'showBillNumber'),
    discountType: discountType as service.InvoiceInput['discountType'],
    discountValue: optionalMoney(body, 'discountValue'),
  };
}

invoicesRouter.post('/', requirePermission('invoice.create'), async (req, res) => {
  const body = asBody(req.body);

  const status = optionalString(body, 'status', { max: 20 });
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    throw badRequest('Validation failed', { status: `Must be one of: ${STATUSES.join(', ')}` });
  }

  // F11: Quick Invoice's "Save as Paid" — opt-in, so a caller that
  // never sends `paid` (every Standard Invoice save, duplicate) gets
  // today's exact behavior back, unchanged. `paid` + `payment.create`
  // gates posting the initial payment the same way the dedicated
  // POST /payments route does; `invoice.create` alone (e.g. STAFF
  // without payment.create, if that combination is ever introduced)
  // is not enough to post one here either.
  const paid = optionalBoolean(body, 'paid') ?? false;
  let paymentMethod: service.PaymentMethod | undefined;
  if (paid) {
    if (!roleHasPermission(auth(req).role, 'payment.create')) throw forbidden();
    const method = requireString(body, 'paymentMethod', { max: 20 });
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw badRequest('Validation failed', { paymentMethod: `Must be one of: ${PAYMENT_METHODS.join(', ')}` });
    }
    paymentMethod = method as service.PaymentMethod;
  }
  // Must be the same value across any retry of one logical "Save"
  // click — see createInvoice's idempotency wrapper. Optional: a
  // caller with no retry concern of its own (Standard Invoice) simply
  // never sends one.
  const idempotencyKey = optionalString(body, 'idempotencyKey', { max: 100 });

  const invoice = await service.createInvoice(
    auth(req).companyId,
    auth(req).userId,
    {
      customerId: requireUuid(body, 'customerId'),
      invoiceDate: optionalDate(body, 'invoiceDate'),
      notes: optionalString(body, 'notes', { max: 2000 }),
      status: status as service.InvoiceStatus | undefined,
      items: parseItems(body),
      ...parseDiscountAndLot(body),
    },
    {},
    {
      idempotencyKey,
      pay: paid ? { paymentMethod: paymentMethod as service.PaymentMethod } : undefined,
    },
  );
  res.status(201).json(invoice);
});

// Edits a draft invoice in place — items (each with its own quantity),
// date, notes, lot number, and discount are all replaceable, but only
// while the invoice is still a draft; see updateInvoice in
// invoice.service.ts. The customer can't be reassigned here.
invoicesRouter.patch('/:invoiceId', requirePermission('invoice.edit'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  const body = asBody(req.body);

  const invoice = await service.updateInvoice(auth(req).companyId, auth(req).userId, invoiceId, {
    invoiceDate: optionalDate(body, 'invoiceDate'),
    notes: optionalString(body, 'notes', { max: 2000 }),
    items: parseItems(body),
    ...parseDiscountAndLot(body),
  });
  res.json(invoice);
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

// F03: read-only preview only — the message text, the manual wa.me
// link, and whether a real server-side send is even configured.
// Never calls out to WhatsApp (see whatsapp-share.service.ts's doc
// comment); safe to call any number of times.
invoicesRouter.get('/:invoiceId/whatsapp-share', requirePermission('invoice.view'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  res.json(await previewInvoiceWhatsAppShare(auth(req).companyId, invoiceId));
});

// F03: the one route allowed to actually send — generates/uploads the
// PDF and calls the WhatsApp Business Cloud API when that's the
// active service (never for a plain GET). `idempotencyKey` is
// required and caller-supplied (the frontend mints one per "Send via
// WhatsApp" click): a repeated request with the same invoice +
// key never sends twice — see sendInvoiceWhatsAppShare.
invoicesRouter.post('/:invoiceId/whatsapp-send', requirePermission('invoice.view'), async (req, res) => {
  const invoiceId = requireUuidParam(req.params.invoiceId, 'invoiceId');
  const body = asBody(req.body);
  const idempotencyKey = requireString(body, 'idempotencyKey', { max: 100 });
  res.json(await sendInvoiceWhatsAppShare(auth(req).companyId, invoiceId, idempotencyKey));
});
