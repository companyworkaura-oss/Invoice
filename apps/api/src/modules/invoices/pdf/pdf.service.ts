import { chromium } from 'playwright-core';
import { buildInvoiceViewModel, invoicePdfFilename } from '@invoice/shared';
import { config } from '../../../config.js';
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
 * defaultInvoiceTemplate (Phase 3) when not given.
 */
export async function generateInvoicePdf(
  companyId: string,
  invoiceId: string,
  templateId?: string,
): Promise<GeneratedPdf> {
  const invoice = await invoiceService.getInvoice(companyId, invoiceId);
  const [company, customer] = await Promise.all([
    companyService.getCompany(companyId),
    customerService.getCustomer(companyId, invoice.customerId),
  ]);

  const viewModel = buildInvoiceViewModel(invoice, company, customer);
  const theme = getPdfTheme(templateId || company.defaultInvoiceTemplate);
  const logoDataUri = await fetchLogoDataUri(company.logoUrl);
  const html = renderInvoiceHtml(theme, viewModel, logoDataUri);

  const browser = await chromium.launch({
    executablePath: config.chromiumExecutablePath,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // Margins live inside the HTML itself (the header/body padding in
    // render-html.ts), not here — that keeps one page-margin model
    // instead of two competing ones, and matches the on-screen preview,
    // whose A4-sized page is also just internal padding, no page-engine
    // margin. format: 'A4' still gives exact 210mm x 297mm pages,
    // spilling onto additional A4 pages as needed for a long invoice.
    const buffer = await page.pdf({
      format: 'A4',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      printBackground: true,
    });
    return { buffer, filename: invoicePdfFilename(invoice.invoiceNumber, customer.name) };
  } finally {
    await browser.close();
  }
}
