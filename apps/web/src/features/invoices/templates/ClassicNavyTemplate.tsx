import type { InvoiceViewModel } from '@invoice/shared';

export function ClassicNavyTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white p-8 font-serif text-slate-800 shadow print:shadow-none">
      <div className="flex items-start justify-between border-b-4 border-blue-950 pb-4">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && (
            <img src={invoice.company.logoUrl} alt="" className="h-14 w-14 object-contain" />
          )}
          <div>
            <p className="text-lg font-bold text-blue-950">{invoice.company.factoryName || invoice.company.name}</p>
            <p className="text-xs text-slate-500">
              {[invoice.company.address, invoice.company.phone, invoice.company.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-wide text-blue-950">INVOICE</p>
          <p className="text-sm text-slate-600">{invoice.invoiceNumber}</p>
          <p className="text-sm text-slate-600">{invoice.invoiceDate}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
        <p className="font-semibold text-slate-900">{invoice.customer.businessName || invoice.customer.name}</p>
        {invoice.customer.businessName && <p className="text-sm text-slate-600">{invoice.customer.name}</p>}
        {invoice.customer.address && <p className="text-sm text-slate-600">{invoice.customer.address}</p>}
        <p className="mt-1 text-sm text-slate-600">Quantity: {invoice.quantity}</p>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-blue-950 text-left text-xs uppercase tracking-wide text-blue-950">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Stitches</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="break-inside-avoid border-b border-slate-200">
              <td className="py-2">{item.description}</td>
              <td className="py-2 text-right">{item.stitches}</td>
              <td className="py-2 text-right">{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-end break-inside-avoid">
        <div className="w-64 space-y-1 border-t-2 border-blue-950 pt-2 text-sm">
          <Row label="Current Bill" value={invoice.currentBill} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <Row label="Current Balance" value={invoice.currentBalance} strong />
        </div>
      </div>

      {invoice.terms && (
        <div className="mt-8 break-inside-avoid border-t border-slate-200 pt-3 text-xs text-slate-500">
          <p className="font-semibold uppercase tracking-wide text-slate-400">Terms</p>
          <p className="mt-1 whitespace-pre-line">{invoice.terms}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-bold text-blue-950' : 'text-slate-700'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
