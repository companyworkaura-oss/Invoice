import {
  buildInvoiceWhatsAppMessage,
  buildWhatsAppClickToChatUrl,
  isValidWhatsAppPhone,
  normalizeWhatsAppPhone,
  type WhatsAppSharePayload,
  type WhatsAppSharePreview,
} from '@invoice/shared';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { badRequest, conflict } from '../../lib/http-error.js';
import { getWhatsAppService } from '../../lib/whatsapp/index.js';
import { getCompany } from '../company/company.service.js';
import { getCustomer } from '../customers/customer.service.js';
import { buildCustomerPdfShareUrl } from './invoice-share.service.js';
import { getInvoice } from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';

/**
 * F03: GET must never send a WhatsApp message. The old
 * `buildInvoiceWhatsAppShare` (called from the GET route) always ran
 * `getWhatsAppService().buildShare(...)` — which, the moment WhatsApp
 * Business Cloud API credentials are configured, uploads the PDF and
 * sends a real document message as a side effect of a GET. The report
 * reproduced this exactly: two GETs, two real sends.
 *
 * This file now has two entry points instead of one, matching exactly
 * what each HTTP verb is allowed to do:
 *   - `previewInvoiceWhatsAppShare` (GET): builds the message, the
 *     customer-openable PDF share link (F09), and the manual wa.me
 *     fallback — never calls into a WhatsAppService at all, so it is
 *     physically incapable of sending anything no matter which
 *     service is active.
 *   - `sendInvoiceWhatsAppShare` (POST only): the one place that ever
 *     calls `WhatsAppService.buildShare` — generating the PDF bytes
 *     and uploading/sending via Business Cloud API when that's the
 *     active service, wrapped in the idempotency guard below so a
 *     repeated request (retry, double-click) never sends twice.
 *
 * `buildShareContext` is the validation + message-building logic both
 * share, kept in one place so a GET preview and the message an actual
 * POST send uses can never drift apart from each other.
 */
interface ShareContext {
  normalizedPhone: string;
  message: string;
  fallbackUrl: string;
  invoiceNumber: string;
}

async function buildShareContext(companyId: string, invoiceId: string): Promise<ShareContext> {
  const invoice = await getInvoice(companyId, invoiceId);
  const [customer, company] = await Promise.all([
    getCustomer(companyId, invoice.customerId),
    getCompany(companyId),
  ]);

  // Server-side normalization + validation, before anything is ever
  // opened — a customer's saved number might be local-format
  // ("03001234567"), already international, or missing/junk entirely;
  // wa.me needs the normalized international form either way, and a
  // link built from an invalid one just opens a broken/blank chat.
  const normalizedPhone = customer.whatsapp ? normalizeWhatsAppPhone(customer.whatsapp) : '';
  if (!normalizedPhone || !isValidWhatsAppPhone(normalizedPhone)) {
    throw badRequest('Validation failed', { whatsapp: 'Customer WhatsApp number is missing or invalid.' });
  }

  // F09: a customer-openable, expiring share link — never the
  // authenticated /api/invoices/:id/pdf route itself, which a
  // customer's phone (no company login) could never open. See
  // invoice-share.service.ts. Minting this token is a local,
  // no-external-party, idempotent-in-effect write (nobody is notified,
  // nothing costs API quota) — categorically different from the
  // external WhatsApp send F03 is about, and is what lets the preview
  // message below show a real, working PDF link even when the actual
  // send only ever happens later, via POST.
  const pdfUrl = await buildCustomerPdfShareUrl(config.publicBaseUrl, companyId, invoice.id);

  const message = buildInvoiceWhatsAppMessage({
    customerName: customer.name,
    invoiceNumber: invoice.invoiceNumber,
    invoiceAmount: invoice.grandTotal,
    previousBalance: invoice.previousBalance,
    amountPaid: invoice.amountPaid,
    currentBalance: invoice.currentBalance,
    companyName: company.name,
    pdfUrl,
  });

  return {
    normalizedPhone,
    message,
    fallbackUrl: buildWhatsAppClickToChatUrl(normalizedPhone, message),
    invoiceNumber: invoice.invoiceNumber,
  };
}

/**
 * GET-safe preview: the recipient, the message, the manual wa.me link,
 * and whether an actual server-side send is even possible — nothing
 * else. Never calls `WhatsAppService.buildShare`, never generates a
 * full PDF for upload, never touches `whatsapp_send_requests`. Safe to
 * call any number of times with zero cumulative effect beyond the
 * (harmless, local) share-token mint in `buildShareContext`.
 */
export async function previewInvoiceWhatsAppShare(companyId: string, invoiceId: string): Promise<WhatsAppSharePreview> {
  const context = await buildShareContext(companyId, invoiceId);
  return {
    toPhone: context.normalizedPhone,
    message: context.message,
    fallbackUrl: context.fallbackUrl,
    invoiceNumber: context.invoiceNumber,
    cloudApiConfigured: getWhatsAppService().requiresPdfAttachment,
  };
}

async function performSend(companyId: string, invoiceId: string): Promise<WhatsAppSharePayload> {
  const context = await buildShareContext(companyId, invoiceId);
  const service = getWhatsAppService();

  // Only worth rendering the actual PDF bytes when the active service
  // can do something with them (Business Cloud API) — click-to-chat
  // never does: the browser already has/can get the PDF itself via
  // the ordinary download, and opening wa.me is the user's own action,
  // never something this function does on their behalf.
  const pdf = service.requiresPdfAttachment ? await generateInvoicePdf(companyId, invoiceId) : undefined;

  return service.buildShare({
    toPhone: context.normalizedPhone,
    message: context.message,
    invoiceNumber: context.invoiceNumber,
    fallbackUrl: context.fallbackUrl,
    pdf,
  });
}

/**
 * F03 idempotency: claims `idempotencyKey` for this exact
 * (companyId, invoiceId) by inserting a row — the UNIQUE constraint
 * on (company_id, invoice_id, idempotency_key) means at most one
 * caller can ever win this INSERT for a given key. The loser gets
 * `claimed: false` and whatever `result` the winner has filled in so
 * far (`null` while the winner's send is still in flight).
 */
async function claimIdempotencyKey(
  companyId: string,
  invoiceId: string,
  idempotencyKey: string,
): Promise<{ claimed: true } | { claimed: false; result: WhatsAppSharePayload | null }> {
  try {
    await pool.query(
      'INSERT INTO whatsapp_send_requests (company_id, invoice_id, idempotency_key) VALUES ($1, $2, $3)',
      [companyId, invoiceId, idempotencyKey],
    );
    return { claimed: true };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      const { rows } = await pool.query<{ result: WhatsAppSharePayload | null }>(
        'SELECT result FROM whatsapp_send_requests WHERE company_id = $1 AND invoice_id = $2 AND idempotency_key = $3',
        [companyId, invoiceId, idempotencyKey],
      );
      return { claimed: false, result: rows[0]?.result ?? null };
    }
    throw err;
  }
}

async function finalizeIdempotencyKey(
  companyId: string,
  invoiceId: string,
  idempotencyKey: string,
  result: WhatsAppSharePayload,
): Promise<void> {
  await pool.query(
    'UPDATE whatsapp_send_requests SET result = $4 WHERE company_id = $1 AND invoice_id = $2 AND idempotency_key = $3',
    [companyId, invoiceId, idempotencyKey, JSON.stringify(result)],
  );
}

/** Releases a claimed key that never produced a result (the send attempt itself threw) — so a genuine retry with the same key starts clean instead of polling forever for a result that will never arrive. */
async function releaseIdempotencyKey(companyId: string, invoiceId: string, idempotencyKey: string): Promise<void> {
  await pool.query(
    'DELETE FROM whatsapp_send_requests WHERE company_id = $1 AND invoice_id = $2 AND idempotency_key = $3 AND result IS NULL',
    [companyId, invoiceId, idempotencyKey],
  );
}

const POLL_INTERVAL_MS = 250;
const MAX_POLL_ATTEMPTS = 20; // ~5s total — generous for a request genuinely still in flight, short enough not to hang a caller indefinitely.

/**
 * POST-only: the one function in this file that may actually call out
 * to WhatsApp. `idempotencyKey` must be supplied by the caller (the
 * frontend generates one per logical "Send via WhatsApp" click) —
 * retrying the exact same (invoiceId, idempotencyKey) pair, whether a
 * genuine double-click, a dropped-response retry, or a test
 * deliberately repeating a request, replays the first attempt's
 * result instead of sending again.
 */
export async function sendInvoiceWhatsAppShare(
  companyId: string,
  invoiceId: string,
  idempotencyKey: string,
): Promise<WhatsAppSharePayload> {
  const claim = await claimIdempotencyKey(companyId, invoiceId, idempotencyKey);

  if (claim.claimed) {
    try {
      const result = await performSend(companyId, invoiceId);
      await finalizeIdempotencyKey(companyId, invoiceId, idempotencyKey, result);
      return result;
    } catch (err) {
      // The attempt never produced a result worth replaying — release
      // the key so a genuine retry (same key) starts clean rather than
      // being stuck waiting for a result that will never arrive.
      await releaseIdempotencyKey(companyId, invoiceId, idempotencyKey);
      throw err;
    }
  }

  if (claim.result) return claim.result;

  // Another request with this exact key is still in flight (or just
  // errored and released the key) — wait briefly for it to settle
  // rather than sending a second time ourselves.
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const { rows } = await pool.query<{ result: WhatsAppSharePayload | null }>(
      'SELECT result FROM whatsapp_send_requests WHERE company_id = $1 AND invoice_id = $2 AND idempotency_key = $3',
      [companyId, invoiceId, idempotencyKey],
    );
    if (rows[0]?.result) return rows[0].result;
    if (!rows[0]) return sendInvoiceWhatsAppShare(companyId, invoiceId, idempotencyKey); // released — try claiming it ourselves now.
  }
  throw conflict('A WhatsApp send for this invoice with this idempotency key is already in progress. Try again shortly.');
}
