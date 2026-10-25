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
import { buildCustomerPdfShareUrl } from './invoice-share.service.js';
import { getInvoice } from './invoice.service.js';
import { generateInvoicePdf } from './pdf/pdf.service.js';

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

  // F09: a customer-openable, expiring share link — never the
  // authenticated /api/invoices/:id/pdf route itself, which a
  // customer's phone (no company login) could never open. See
  // invoice-share.service.ts.
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
