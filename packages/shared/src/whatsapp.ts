import type { Money } from './entities.js';

/**
 * Fields needed to build the V1 invoice-sharing WhatsApp message. Kept
 * as plain strings (no formatting/currency symbols) since Money values
 * are already decimal strings with 2 places.
 */
export interface WhatsAppInvoiceMessageInput {
  customerName: string;
  invoiceNumber: string;
  invoiceAmount: Money;
  previousBalance: Money;
  amountPaid: Money;
  currentBalance: Money;
  companyName?: string;
}

export function buildInvoiceWhatsAppMessage(input: WhatsAppInvoiceMessageInput): string {
  return [
    `Hi ${input.customerName},`,
    input.companyName ? `Here is your invoice from ${input.companyName}.` : 'Here is your invoice.',
    '',
    `Invoice: ${input.invoiceNumber}`,
    `Invoice Amount: ${input.invoiceAmount}`,
    `Previous Balance: ${input.previousBalance}`,
    `Paid Amount: ${input.amountPaid}`,
    `Current Balance: ${input.currentBalance}`,
  ].join('\n');
}

/** Strips everything but digits — wa.me links take a bare international number, no "+", spaces, or dashes. */
export function normalizeWhatsAppPhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** V1 "click-to-chat" link: no WhatsApp Business account or API key needed, just opens web.whatsapp.com / the app. */
export function buildWhatsAppClickToChatUrl(phone: string, message: string): string {
  const digits = normalizeWhatsAppPhone(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Response shape of GET /api/invoices/:id/whatsapp-share. */
export interface WhatsAppSharePayload {
  mode: 'click-to-chat';
  url: string;
  toPhone: string;
  message: string;
}
