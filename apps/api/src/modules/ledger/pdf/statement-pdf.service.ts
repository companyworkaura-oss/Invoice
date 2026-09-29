import { renderHtmlToPdf } from '../../../lib/pdf/render-pdf.js';
import * as companyService from '../../company/company.service.js';
import { fetchLogoDataUri } from '../../invoices/pdf/logo.js';
import { getCustomerStatement, type StatementFilter } from '../statement.service.js';
import { renderStatementHtml } from './render-statement-html.js';

export interface GeneratedStatementPdf {
  buffer: Buffer;
  filename: string;
}

function statementFilename(customerName: string): string {
  const slug = customerName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'customer';
  return `Statement-${slug}.pdf`;
}

/**
 * Renders an A4 PDF of a customer statement — same headless-Chromium
 * pipeline as invoice PDFs (see invoices/pdf/pdf.service.ts), built from
 * the exact same getCustomerStatement() data the on-screen view uses.
 */
export async function generateStatementPdf(
  companyId: string,
  customerId: string,
  filter: StatementFilter,
): Promise<GeneratedStatementPdf> {
  const [statement, company] = await Promise.all([
    getCustomerStatement(companyId, customerId, filter),
    companyService.getCompany(companyId),
  ]);

  const logoDataUri = await fetchLogoDataUri(company.logoUrl);
  const html = renderStatementHtml(company, statement, logoDataUri);

  const buffer = await renderHtmlToPdf(html, { label: `statement for ${statement.customerName}` });
  return { buffer, filename: statementFilename(statement.customerName) };
}
