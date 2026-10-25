import { Router } from 'express';
import { config } from '../../config.js';
import { requireTokenParam } from '../../lib/validate.js';
import { invoicePdfShareRateLimiter } from '../../middleware/rate-limit.js';
import { resolveInvoicePdfShare } from './invoice-share.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';

/**
 * F09: the one deliberately public (no requireAuth) surface this app
 * exposes — a customer following a WhatsApp share link has no company
 * login at all, so this route can't sit behind the same
 * requireAuth/requirePermission guard every other invoice route does.
 * It is not a backdoor into the authenticated PDF route: the token is
 * the *only* identifier this route takes (no invoice id anywhere in
 * the URL to tamper with), it resolves to exactly one invoice,
 * unknown/expired tokens are rejected the same way (see
 * resolveInvoicePdfShare), and GET /api/invoices/:id/pdf itself is
 * completely untouched — still fully authenticated, still requiring
 * `invoice.view`.
 */
export const invoiceShareRouter = Router();

invoiceShareRouter.get('/invoice-pdf/:token', invoicePdfShareRateLimiter, async (req, res) => {
  const token = requireTokenParam(req.params.token);
  const { companyId, invoiceId } = await resolveInvoicePdfShare(token);
  const { buffer, filename } = await generateInvoicePdf(companyId, invoiceId);
  if (config.nodeEnv === 'development') {
    console.log(`[invoice pdf share] ${filename}: ${buffer.length} bytes`);
  }
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length.toString());
  res.end(buffer);
});
