import type { Company, CustomerStatement } from '@invoice/shared';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * One A4-sized HTML document for a customer statement, rendered
 * server-side from getCustomerStatement()'s output — the same figures
 * the on-screen statement shows — then handed to a headless Chromium to
 * print to PDF (see statement-pdf.service.ts). Unlike invoices, there's
 * one plain layout here, not a template registry — a statement is an
 * internal/accounting document, not a customer-facing branded design.
 */
export function renderStatementHtml(
  company: Pick<Company, 'name'>,
  statement: CustomerStatement,
  logoDataUri: string | null,
): string {
  const rows = statement.entries
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.date)}</td>
        <td>${e.reference ? escapeHtml(e.reference) : '—'}</td>
        <td>${e.description ? escapeHtml(e.description) : '—'}</td>
        <td class="num">${e.debit !== '0.00' ? escapeHtml(e.debit) : ''}</td>
        <td class="num">${e.credit !== '0.00' ? escapeHtml(e.credit) : ''}</td>
        <td class="num">${escapeHtml(e.runningBalance)}</td>
      </tr>`,
    )
    .join('');

  const periodLine =
    statement.from || statement.to
      ? `${statement.from ? escapeHtml(statement.from) : 'Beginning'} &ndash; ${statement.to ? escapeHtml(statement.to) : 'Now'}`
      : 'Full history';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; width: 210mm; min-height: 297mm; }
  .page { width: 210mm; min-height: 297mm; background: #ffffff; padding: 15mm; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e293b; padding-bottom: 8mm; }
  .header .company { display: flex; align-items: center; gap: 10px; }
  .header img.logo { height: 42px; width: 42px; object-fit: contain; }
  .header .company-name { font-size: 15px; font-weight: 700; margin: 0; }
  .header .title { text-align: right; }
  .header .title h1 { font-size: 16px; margin: 0; letter-spacing: 1px; text-transform: uppercase; color: #475569; }
  .header .title p { font-size: 11px; color: #64748b; margin: 2px 0 0; }

  .customer { margin-top: 6mm; }
  .customer .label { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin: 0; }
  .customer .name { font-size: 13px; font-weight: 700; margin: 2px 0 0; }

  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6mm; }
  thead tr { background: #f1f5f9; border-bottom: 2px solid #cbd5e1; }
  th { text-align: left; padding: 6px 4px; font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 4px; border-bottom: 1px solid #e2e8f0; break-inside: avoid; }
  tbody tr { break-inside: avoid; }

  .summary-wrap { display: flex; justify-content: flex-end; margin-top: 8mm; break-inside: avoid; }
  .summary { width: 75mm; font-size: 11px; border-top: 2px solid #1e293b; padding-top: 6px; }
  .summary .row { display: flex; justify-content: space-between; padding: 2px 0; color: #475569; }
  .summary .row.total { font-weight: 700; color: #1e293b; font-size: 13px; border-top: 1px solid #cbd5e1; margin-top: 4px; padding-top: 6px; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="" />` : ''}
        <p class="company-name">${escapeHtml(company.name)}</p>
      </div>
      <div class="title">
        <h1>Customer Statement</h1>
        <p>${periodLine}</p>
      </div>
    </div>

    <div class="customer">
      <p class="label">Statement For</p>
      <p class="name">${escapeHtml(statement.customerName)}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Reference</th>
          <th>Description</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
          <th class="num">Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="summary-wrap">
      <div class="summary">
        <div class="row"><span>Opening Balance</span><span>${escapeHtml(statement.openingBalance)}</span></div>
        <div class="row"><span>Invoice Total</span><span>${escapeHtml(statement.invoiceTotal)}</span></div>
        <div class="row"><span>Payments</span><span>${escapeHtml(statement.payments)}</span></div>
        <div class="row total"><span>Closing Balance</span><span>${escapeHtml(statement.closingBalance)}</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
