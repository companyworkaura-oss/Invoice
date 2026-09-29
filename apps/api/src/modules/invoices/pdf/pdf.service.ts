import { buildInvoiceViewModel, invoicePdfFilename } from '@invoice/shared';
import { config } from '../../../config.js';
import { renderHtmlToPdf } from '../../../lib/pdf/render-pdf.js';
import * as companyService from '../../company/company.service.js';
import * as customerService from '../../customers/customer.service.js';
import * as invoiceService from '../invoice.service.js';
import { fetchLogoDataUri } from './logo.js';
import { renderInvoiceHtml } from './render-html.js';
import { getPdfTheme } from './themes.js';

export interface GeneratedPdf {
  buffer: Buffer;
  filename: string;
}

/**
 * Renders an A4 PDF of a saved invoice. Every field that ends up on the
 * page comes from invoice.service.getInvoice() — the same snapshot data
 * (category_name, rate, calculated amounts, ledger-derived summary) the
 * on-screen view uses — never from a live lookup of the category's
 * current settings. templateId defaults to the company's own
 * defaultInvoiceTemplate (Phase 3) when not given. Margins live inside
 * the HTML itself (the header/body padding in render-html.ts), not the
 * page.pdf() call — that keeps one page-margin model instead of two
 * competing ones, and matches the on-screen preview, whose A4-sized
 * page is also just internal padding, no page-engine margin.
 */
export async function generateInvoicePdf(
  companyId: string,
  invoiceId: string,
  templateId?: string,
): Promise<GeneratedPdf> {
  if (config.nodeEnv === 'development') {
    console.log(`[pdf] generating invoice PDF: companyId=${companyId} invoiceId=${invoiceId}`);
  }
  const invoice = await invoiceService.getInvoice(companyId, invoiceId);
  const [company, customer] = await Promise.all([
    companyService.getCompany(companyId),
    customerService.getCustomer(companyId, invoice.customerId),
  ]);

  const viewModel = buildInvoiceViewModel(invoice, company, customer);
  const theme = getPdfTheme(templateId || company.defaultInvoiceTemplate);
  const logoDataUri = await fetchLogoDataUri(company.logoUrl);
  const html = renderInvoiceHtml(theme, viewModel, logoDataUri);

  const buffer = await renderHtmlToPdf(html, { label: `invoice ${invoice.invoiceNumber}` });
  return { buffer, filename: invoicePdfFilename(invoice.invoiceNumber, customer.name) };
}
