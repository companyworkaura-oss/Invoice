import { buildInvoiceWhatsAppMessage } from '@invoice/shared';
import { badRequest } from '../../lib/http-error.js';
import { getWhatsAppService, type WhatsAppSharePayload } from '../../lib/whatsapp/index.js';
import { getCompany } from '../company/company.service.js';
import { getCustomer } from '../customers/customer.service.js';
import { getInvoice } from './invoice.service.js';

export async function buildInvoiceWhatsAppShare(companyId: string, invoiceId: string): Promise<WhatsAppSharePayload> {
  const invoice = await getInvoice(companyId, invoiceId);
  const [customer, company] = await Promise.all([
    getCustomer(companyId, invoice.customerId),
    getCompany(companyId),
  ]);

  if (!customer.whatsapp) {
    throw badRequest('Validation failed', { whatsapp: 'Customer has no WhatsApp number saved' });
  }

  const message = buildInvoiceWhatsAppMessage({
    customerName: customer.name,
    invoiceNumber: invoice.invoiceNumber,
    invoiceAmount: invoice.totalAmount,
    previousBalance: invoice.previousBalance,
    amountPaid: invoice.amountPaid,
    currentBalance: invoice.currentBalance,
    companyName: company.name,
  });

  return getWhatsAppService().buildShare({ toPhone: customer.whatsapp, message });
}
