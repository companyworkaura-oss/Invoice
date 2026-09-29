import { chromium } from 'playwright-core';
import { config } from '../../config.js';

const PDF_MAGIC = '%PDF-';

export interface RenderPdfOptions {
  /** A short label for diagnostic logs, e.g. "invoice INV-000042" or "statement for Jane Doe". */
  label: string;
}

/**
 * Renders one HTML document to an A4 PDF via headless Chromium — the one
 * place both invoice PDF generation (invoices/pdf/pdf.service.ts) and
 * statement PDF generation (ledger/pdf/statement-pdf.service.ts) launch
 * a browser, so a hardening fix or a diagnostic only has to happen here
 * once instead of drifting between two copies.
 *
 * `--disable-dev-shm-usage` works around a well-known Chromium-in-a-
 * container failure mode: the default `/dev/shm` size in many container
 * runtimes (64MB) is too small for Chromium's shared-memory needs, and
 * under memory pressure it can crash or render an empty/truncated page
 * instead of throwing a catchable error — this tells it to spill to
 * `/tmp` instead, which is the standard fix documented by both
 * Puppeteer and Playwright for exactly this symptom.
 *
 * Always verifies the result is non-empty and starts with the real PDF
 * magic bytes (`%PDF-`) before returning. Chromium resolving page.pdf()
 * "successfully" with empty or garbage bytes (rather than throwing) is
 * rare but real in constrained environments — without this check that
 * silently becomes a 200 response with an empty body, which is
 * indistinguishable from "it worked" until a customer's phone can't
 * open the file. This turns it into a loud, logged 500 instead (see the
 * error middleware's getErrorReporter().report(), which logs the full
 * message/stack — never swallowed).
 */
export async function renderHtmlToPdf(html: string, { label }: RenderPdfOptions): Promise<Buffer> {
  if (config.nodeEnv === 'development') {
    console.log(`[pdf] ${label}: rendered HTML is ${html.length} bytes`);
  }

  const browser = await chromium.launch({
    executablePath: config.chromiumExecutablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      printBackground: true,
    });
    if (config.nodeEnv === 'development') {
      console.log(`[pdf] ${label}: page.pdf() returned ${pdfBytes.length} bytes`);
    }
    // Explicit conversion, not a no-op: page.pdf() is typed as
    // Promise<Buffer> but that's not guaranteed across every Playwright
    // build/transport — wrapping in Buffer.from() guarantees a real Node
    // Buffer reaches the route, since sending anything else (a plain
    // Uint8Array view, for instance) as the HTTP body is what produces a
    // byte-for-byte-wrong, unopenable "PDF".
    const buffer = Buffer.from(pdfBytes);
    if (config.nodeEnv === 'development') {
      console.log(`[pdf] ${label}: final buffer is ${buffer.length} bytes`);
    }

    if (buffer.length === 0 || buffer.subarray(0, PDF_MAGIC.length).toString('ascii') !== PDF_MAGIC) {
      throw new Error(
        `PDF generation for ${label} produced ${
          buffer.length === 0 ? 'an empty' : 'an invalid (missing the %PDF- header)'
        } buffer (${buffer.length} bytes)`,
      );
    }

    return buffer;
  } finally {
    await browser.close();
  }
}
