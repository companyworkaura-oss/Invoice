import {
  buildInvoiceWhatsAppMessage,
  buildWhatsAppClickToChatUrl,
  isValidWhatsAppPhone,
  normalizeWhatsAppPhone,
} from '@invoice/shared';
import { config } from '../../config.js';
import { badRequest } from '../../lib/http-error.js';
import { getWhatsAppService, type WhatsAppSharePayload } from '../../lib/whatsapp/index.js';
import { getCompany } from '../company/company.service.js';
import { getCustomer } from '../customers/customer.service.js';
import { getInvoice } from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

/**
 * A real, publicly reachable link to the invoice PDF — only when `base`
 * (PUBLIC_BASE_URL) is actually configured and isn't a localhost
 * address. A customer's phone can never open http://localhost:4000/...,
 * so rather than put an unusable link in a WhatsApp message, this just
 * omits the PDF-link line entirely when there's no usable public URL
 * (see buildInvoiceWhatsAppMessage's pdfUrl?). Takes `base` as a plain
 * argument (rather than reading config.publicBaseUrl itself) so it's a
 * pure function, testable without touching real environment variables.
 */
export function buildPublicPdfUrl(base: string | undefined, invoiceId: string): string | undefined {
  if (!base || LOCALHOST_RE.test(base)) return undefined;
  return `${base.replace(/\/+$/, '')}/api/invoices/${invoiceId}/pdf`;
}

export async function buildInvoiceWhatsAppShare(companyId: string, invoiceId: string): Promise<WhatsAppSharePayload> {
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

  const message = buildInvoiceWhatsAppMessage({
    customerName: customer.name,
    invoiceNumber: invoice.invoiceNumber,
    invoiceAmount: invoice.grandTotal,
    previousBalance: invoice.previousBalance,
    amountPaid: invoice.amountPaid,
    currentBalance: invoice.currentBalance,
    companyName: company.name,
    pdfUrl: buildPublicPdfUrl(config.publicBaseUrl, invoice.id),
  });

  const fallbackUrl = buildWhatsAppClickToChatUrl(normalizedPhone, message);
  const service = getWhatsAppService();

  // Only worth rendering the actual PDF bytes server-side when the
  // active service can do something with them (Business Cloud API) —
  // the click-to-chat link never needs them: the browser downloads the
  // PDF itself before opening WhatsApp (see InvoiceTemplateView).
  const pdf = service.requiresPdfAttachment ? await generateInvoicePdf(companyId, invoiceId) : undefined;

  return service.buildShare({
    toPhone: normalizedPhone,
    message,
    invoiceNumber: invoice.invoiceNumber,
    fallbackUrl,
    pdf,
  });
}
