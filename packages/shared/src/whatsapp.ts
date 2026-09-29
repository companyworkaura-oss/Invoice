import type { Money } from './entities.js';

/**
 * Fields needed to build the invoice-sharing WhatsApp message. Kept as
 * plain strings (no formatting/currency symbols) since Money values are
 * already decimal strings with 2 places.
 */
export interface WhatsAppInvoiceMessageInput {
  customerName: string;
  invoiceNumber: string;
  invoiceAmount: Money;
  previousBalance: Money;
  amountPaid: Money;
  currentBalance: Money;
  companyName?: string;
  /**
   * A real, publicly reachable HTTPS link to the invoice PDF — omitted
   * entirely (never rendered as a broken/blank line) when none is
   * available. Never a localhost URL: a customer's phone cannot open
   * http://localhost:4000/... See apps/api's whatsapp-share.service.ts
   * for where this is built (only when PUBLIC_BASE_URL is configured
   * and isn't a localhost address).
   */
  pdfUrl?: string;
}

export function buildInvoiceWhatsAppMessage(input: WhatsAppInvoiceMessageInput): string {
  const lines = [
    `Assalam-o-Alaikum ${input.customerName},`,
    input.companyName
      ? `Your invoice ${input.invoiceNumber} from ${input.companyName} is ready.`
      : `Your invoice ${input.invoiceNumber} is ready.`,
    '',
    `Invoice Total: ${input.invoiceAmount}`,
    `Previous Balance: ${input.previousBalance}`,
    `Paid Amount: ${input.amountPaid}`,
    `Current Balance: ${input.currentBalance}`,
  ];
  if (input.pdfUrl) {
    lines.push('', `PDF invoice: ${input.pdfUrl}`);
  }
  lines.push('', 'Thank you.');
  return lines.join('\n');
}

/**
 * Normalizes a WhatsApp/phone number into the bare digits-only
 * international format wa.me requires: no "+", spaces, dashes,
 * brackets, or leading zero.
 *
 * Strips everything but digits, then — the one format-specific
 * conversion this app needs — turns a Pakistani local mobile number
 * (11 digits, leading 0, e.g. "03001234567") into its international
 * form by swapping the leading 0 for the country code 92
 * ("923001234567"). Any other digit string (already international, or
 * some other country's local format) passes through unchanged: this
 * app has no reliable way to guess a country code for a number that
 * isn't already one of these two recognizable shapes, and guessing
 * wrong would silently message the wrong recipient.
 */
export function normalizeWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) {
    return `92${digits.slice(1)}`;
  }
  return digits;
}

/**
 * True for a normalized (digits-only) number that's a plausible
 * WhatsApp recipient — a believable international length. This is a
 * sanity check, never a guarantee the number is real or has WhatsApp;
 * wa.me/WhatsApp itself is the actual source of truth for that.
 */
export function isValidWhatsAppPhone(normalized: string): boolean {
  return /^\d{8,15}$/.test(normalized);
}

/**
 * The click-to-chat link: no WhatsApp Business account or API key
 * needed, just opens web.whatsapp.com / the app to this exact
 * recipient with the message prefilled. Normalizes `phone` itself
 * (idempotent if the caller already normalized it) — but the caller is
 * still responsible for validating it first (see isValidWhatsAppPhone):
 * this function never refuses to build a link, so an invalid/empty
 * number here just produces an unusable link rather than an error.
 */
export function buildWhatsAppClickToChatUrl(phone: string, message: string): string {
  const digits = normalizeWhatsAppPhone(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export type WhatsAppShareMode = 'click-to-chat' | 'business-api';

/** Response shape of GET /api/invoices/:id/whatsapp-share. */
export interface WhatsAppSharePayload {
  mode: WhatsAppShareMode;
  /** Normalized (digits-only, international) recipient number. */
  toPhone: string;
  message: string;
  /**
   * A manual click-to-chat fallback link — always present, even when
   * mode is 'business-api', so the frontend always has something
   * actionable if an automatic send fails.
   */
  url: string;
  /** Only present when mode is 'business-api': whether the PDF document message was actually sent. */
  status?: 'sent' | 'failed';
  /** Only present when status is 'failed'. */
  error?: string;
}
