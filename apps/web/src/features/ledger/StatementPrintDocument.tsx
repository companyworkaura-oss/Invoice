import type { CompanyProfile, Customer, CustomerStatement } from '@invoice/shared';

interface Props {
  company: CompanyProfile;
  customer: Customer;
  statement: CustomerStatement;
}

/**
 * The ONLY thing that shows up on paper when the statement's Print
 * button fires — a clean A4 document (company/logo, title, period,
 * customer, transaction table, summary), styled independently of the
 * on-screen filters/cards/table it's built from. Mirrors apps/api's
 * render-statement-html.ts (the server-side PDF version) field for
 * field, so the two never drift apart, and is `hidden print:block` in
 * CustomerStatementView — invisible on screen, the only thing visible
 * on paper, once the surrounding app chrome (App.tsx) and this view's
 * own on-screen content are print:hidden.
 */
export function StatementPrintDocument({ company, customer, statement }: Props) {
  const periodLine = statement.from || statement.to
    ? `${statement.from ?? 'Beginning'} – ${statement.to ?? 'Now'}`
    : 'Full history';

  return (
    <div className="print-page mx-auto hidden w-[210mm] min-h-[297mm] border border-slate-300 bg-white p-[12mm] text-slate-800 print:block">
      <div className="flex items-center justify-between border-b-2 border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          {company.logoUrl && <img src={company.logoUrl} alt="" className="h-11 w-11 object-contain" />}
          <p className="text-base font-bold">{company.name}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Customer Statement</p>
          <p className="text-xs text-slate-500">{periodLine}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Statement For</p>
        <p className="text-sm font-bold">{customer.businessName || customer.name}</p>
      </div>

      <table className="mt-4 w-full text-[10.5px]">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 text-left uppercase tracking-wide text-slate-600">
            <th className="px-1 py-1.5">Date</th>
            <th className="px-1 py-1.5">Reference</th>
            <th className="px-1 py-1.5">Description</th>
            <th className="px-1 py-1.5 text-right">Debit</th>
            <th className="px-1 py-1.5 text-right">Credit</th>
            <th className="px-1 py-1.5 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {statement.entries.map((e) => (
            <tr key={e.id} className="border-b border-slate-200">
              <td className="px-1 py-1.5">{e.date}</td>
              <td className="px-1 py-1.5">{e.reference ?? '—'}</td>
              <td className="px-1 py-1.5">{e.description ?? '—'}</td>
              <td className="px-1 py-1.5 text-right">{e.debit !== '0.00' ? e.debit : ''}</td>
              <td className="px-1 py-1.5 text-right">{e.credit !== '0.00' ? e.credit : ''}</td>
              <td className="px-1 py-1.5 text-right">{e.runningBalance}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-end">
        <div className="w-[75mm] border-t-2 border-slate-800 pt-1.5 text-xs">
          <SummaryRow label="Opening Balance" value={statement.openingBalance} />
          <SummaryRow label="Invoice Total" value={statement.invoiceTotal} />
          <SummaryRow label="Payments" value={statement.payments} />
          <SummaryRow label="Closing Balance" value={statement.closingBalance} strong />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between py-0.5 ${
        strong ? 'mt-1 border-t border-slate-300 pt-1.5 text-sm font-bold' : 'text-slate-600'
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
