import { pool } from '../../db/pool.js';
import { config } from '../../config.js';
import { notFound } from '../../lib/http-error.js';
import { hashToken, newToken } from '../../lib/token.js';

/**
 * F09: a customer-accessible, expiring link to one invoice's PDF — the
 * WhatsApp message's PDF link used to point straight at the
 * authenticated GET /api/invoices/:id/pdf route, which a customer's
 * phone (no company login, no session cookie) could never open at
 * all. This mints a single-invoice, unguessable, expiring token
 * instead, resolved by the public (no requireAuth) route in
 * invoice-share.routes.ts — the private route itself is completely
 * unchanged and stays exactly as authenticated as it always was.
 *
 * Same shape as a login session (see auth.service.ts/migration 001):
 * only a SHA-256 hash of the actual token is ever stored, so a leaked
 * database row can't be used to forge a working link, and a row
 * expires on its own via `expires_at` with no separate cleanup job
 * needed for correctness (an expired row simply stops matching the
 * `expires_at > now()` check below; whether to ever delete old rows is
 * a housekeeping concern, not a security one).
 */

export interface InvoicePdfShare {
  token: string;
  expiresAt: Date;
}

/**
 * Mints a new share token for one specific invoice. The token is the
 * *only* identifier the public route takes — there is no separate
 * invoice id in that URL for a caller to swap out — so each token is
 * permanently tied to exactly the invoice it was created for and can
 * never be reused to reach a different one, even within the same
 * company.
 */
export async function createInvoicePdfShare(companyId: string, invoiceId: string): Promise<InvoicePdfShare> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.invoicePdfShareTtlHours * 3600_000);
  await pool.query(
    'INSERT INTO invoice_pdf_share_tokens (company_id, invoice_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [companyId, invoiceId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export interface ResolvedInvoicePdfShare {
  companyId: string;
  invoiceId: string;
}

/**
 * Resolves a presented token to the one invoice it was minted for, or
 * throws notFound for anything else — an unknown token, a token for
 * an invoice that's since been deleted (ON DELETE CASCADE drops the
 * row with it), or one whose `expires_at` has passed. Deliberately the
 * same error for all three: this is a public endpoint, so "wrong
 * token" and "right token, but expired" should look identical to
 * whoever's asking, rather than confirming a token once existed.
 */
export async function resolveInvoicePdfShare(token: string): Promise<ResolvedInvoicePdfShare> {
  const { rows } = await pool.query<ResolvedInvoicePdfShare>(
    `SELECT company_id AS "companyId", invoice_id AS "invoiceId"
       FROM invoice_pdf_share_tokens
      WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!rows[0]) throw notFound('This share link is invalid or has expired.');
  return rows[0];
}

/**
 * A real, publicly reachable share link — only when `base`
 * (PUBLIC_BASE_URL) is actually configured and isn't a localhost
 * address, same guard buildPublicPdfUrl always used (a customer's
 * phone can never open http://localhost:4000/...). Returns undefined,
 * minting no token at all, when there's no usable public URL to build
 * — there would be nothing for a customer to open either way.
 */
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

export async function buildCustomerPdfShareUrl(
  base: string | undefined,
  companyId: string,
  invoiceId: string,
): Promise<string | undefined> {
  if (!base || LOCALHOST_RE.test(base)) return undefined;
  const { token } = await createInvoicePdfShare(companyId, invoiceId);
  return `${base.replace(/\/+$/, '')}/api/public/invoice-pdf/${token}`;
}
