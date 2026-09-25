import type { InvoiceViewModel } from '@invoice/shared';
import type { PdfTheme } from './themes.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function line(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).map((p) => escapeHtml(p as string)).join(' &middot; ');
}

/**
 * One A4-sized (210mm x 297mm) HTML document per invoice, themed by the
 * selected template. Rendered server-side, from the invoice's own saved
 * snapshots (InvoiceViewModel never carries formula/factor/multiplier/
 * divisor — see @invoice/shared's invoice-view-model.ts), then handed to
 * a headless Chromium to print to PDF (see pdf.service.ts). The per-item
 * rate is deliberately not in InvoiceViewModel either — internal only,
 * never shown to the customer. break-inside avoid on every row/box is
 * what keeps a line item or the summary box
 * from being sliced across a page boundary.
 */
export function renderInvoiceHtml(theme: PdfTheme, invoice: InvoiceViewModel, logoDataUri: string | null): string {
  const labelClass = theme.uppercaseLabels ? 'label upper' : 'label';

  const itemRows = invoice.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${item.stitches}</td>
        <td class="num">${escapeHtml(item.amount)}</td>
      </tr>`,
    )
    .join('');

  const contactLine = line(invoice.company.phone, invoice.company.email);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${theme.fontFamily};
    color: #1e293b;
    width: 210mm;
    min-height: 297mm;
  }
  .page { width: 210mm; min-height: 297mm; background: #ffffff; }
  .header {
    background: ${theme.headerBg};
    color: ${theme.headerText};
    padding: 15mm 15mm 10mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: ${theme.borderWidth} solid ${theme.border};
  }
  .header .company { display: flex; align-items: center; gap: 10px; }
  .header img.logo { height: 48px; width: 48px; object-fit: contain; ${theme.headerBg !== '#ffffff' ? 'background: #fff; border-radius: 6px; padding: 3px;' : ''} }
  .header .company-name { font-size: 16px; font-weight: 700; margin: 0; }
  .header .contact { font-size: 10px; color: ${theme.headerMuted}; margin: 2px 0 0; }
  .header .invoice-meta { text-align: right; }
  .header .invoice-title { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: ${theme.headerMuted}; margin: 0; }
  .header .invoice-number { font-size: 16px; font-weight: 700; margin: 2px 0 0; }
  .header .invoice-date { font-size: 10px; color: ${theme.headerMuted}; margin: 2px 0 0; }

  .body { padding: 10mm 15mm; }
  .bill-to { margin-bottom: 8mm; break-inside: avoid; }
  .label { font-size: 9px; color: #94a3b8; margin: 0 0 2px; }
  .label.upper { text-transform: uppercase; letter-spacing: 1px; }
  .customer-name { font-size: 13px; font-weight: 700; margin: 0; }
  .muted-line { font-size: 11px; color: #475569; margin: 1px 0; }

  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: ${theme.tableHeaderBg}; border-bottom: ${theme.borderWidth} solid ${theme.border}; }
  th { text-align: left; padding: 6px 4px; font-size: 9px; color: ${theme.accent}; ${theme.uppercaseLabels ? 'text-transform: uppercase; letter-spacing: 0.5px;' : ''} }
  th.num, td.num { text-align: right; }
  td { padding: 6px 4px; border-bottom: 1px solid #e2e8f0; break-inside: avoid; }
  tbody tr { break-inside: avoid; }

  .summary-wrap { display: flex; justify-content: flex-end; margin-top: 8mm; break-inside: avoid; }
  .summary { width: 70mm; font-size: 11px; border-top: ${theme.borderWidth} solid ${theme.border}; padding-top: 6px; }
  .summary .row { display: flex; justify-content: space-between; padding: 2px 0; color: #475569; }
  .summary .row.total { font-weight: 700; color: ${theme.accent}; font-size: 13px; border-top: 1px solid #cbd5e1; margin-top: 4px; padding-top: 6px; }

  .terms { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; break-inside: avoid; white-space: pre-line; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="" />` : ''}
        <div>
          <p class="company-name">${escapeHtml(invoice.company.factoryName || invoice.company.name)}</p>
          ${contactLine ? `<p class="contact">${contactLine}</p>` : ''}
        </div>
      </div>
      <div class="invoice-meta">
        <p class="invoice-title">Invoice</p>
        <p class="invoice-number">${escapeHtml(invoice.invoiceNumber)}</p>
        <p class="invoice-date">${escapeHtml(invoice.invoiceDate)}</p>
      </div>
    </div>

    <div class="body">
      <div class="bill-to">
        <p class="${labelClass}">Bill To</p>
        <p class="customer-name">${escapeHtml(invoice.customer.businessName || invoice.customer.name)}</p>
        ${invoice.customer.address ? `<p class="muted-line">${escapeHtml(invoice.customer.address)}</p>` : ''}
        <p class="muted-line">Quantity: ${escapeHtml(invoice.quantity)}</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Stitches</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="summary-wrap">
        <div class="summary">
          <div class="row"><span>Current Bill</span><span>${escapeHtml(invoice.currentBill)}</span></div>
          <div class="row"><span>Previous Balance</span><span>${escapeHtml(invoice.previousBalance)}</span></div>
          <div class="row"><span>Amount Paid</span><span>${escapeHtml(invoice.amountPaid)}</span></div>
          <div class="row total"><span>Current Balance</span><span>${escapeHtml(invoice.currentBalance)}</span></div>
        </div>
      </div>

      ${
        invoice.terms
          ? `<div class="terms"><p class="${labelClass}" style="margin-bottom:2px;">Terms</p>${escapeHtml(invoice.terms)}</div>`
          : ''
      }
    </div>
  </div>
</body>
</html>`;
}
