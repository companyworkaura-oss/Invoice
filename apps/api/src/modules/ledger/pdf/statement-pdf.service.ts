import { chromium } from 'playwright-core';
import { config } from '../../../config.js';
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

  const browser = await chromium.launch({
    executablePath: config.chromiumExecutablePath,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      printBackground: true,
    });
    // Explicit conversion, not a no-op: page.pdf() is typed as
    // Promise<Buffer> but that's not guaranteed across every Playwright
    // build/transport — wrapping in Buffer.from() guarantees a real Node
    // Buffer reaches the route, since sending anything else (a plain
    // Uint8Array view, for instance) as the HTTP body is what produces a
    // byte-for-byte-wrong, unopenable "PDF".
    const buffer = Buffer.from(pdfBytes);
    return { buffer, filename: statementFilename(statement.customerName) };
  } finally {
    await browser.close();
  }
}
