import type { InvoiceViewModel } from '@invoice/shared';

export function MinimalCleanTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white p-10 text-slate-900">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && <img src={invoice.company.logoUrl} alt="" className="h-10 w-10 object-contain" />}
          <p className="text-sm font-medium">{invoice.company.factoryName || invoice.company.name}</p>
        </div>
        <p className="text-sm text-slate-400">{invoice.invoiceDate}</p>
      </div>

      <div className="mt-10 flex items-baseline justify-between">
        <h1 className="text-3xl font-light tracking-tight">Invoice</h1>
        <p className="font-mono text-sm text-slate-500">{invoice.invoiceNumber}</p>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400">From</p>
          <p className="mt-1">{invoice.company.name}</p>
          {invoice.company.address && <p className="text-slate-500">{invoice.company.address}</p>}
          {invoice.company.email && <p className="text-slate-500">{invoice.company.email}</p>}
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400">To</p>
          <p className="mt-1">{invoice.customer.businessName || invoice.customer.name}</p>
          {invoice.customer.address && <p className="text-slate-500">{invoice.customer.address}</p>}
          <p className="text-slate-500">Quantity: {invoice.quantity}</p>
        </div>
      </div>

      <table className="mt-10 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-900 text-left text-xs uppercase tracking-widest text-slate-400">
            <th className="pb-2 font-normal">Description</th>
            <th className="pb-2 text-right font-normal">Stitches</th>
            <th className="pb-2 text-right font-normal">Rate</th>
            <th className="pb-2 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="break-inside-avoid border-b border-slate-100">
              <td className="py-2">{item.description}</td>
              <td className="py-2 text-right font-mono">{item.stitches}</td>
              <td className="py-2 text-right font-mono">{item.rate}</td>
              <td className="py-2 text-right font-mono">{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 flex justify-end break-inside-avoid">
        <div className="w-56 space-y-1.5 text-sm">
          <Row label="Current Bill" value={invoice.currentBill} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <div className="flex justify-between border-t border-slate-900 pt-1.5 font-medium">
            <span>Current Balance</span>
            <span className="font-mono">{invoice.currentBalance}</span>
          </div>
        </div>
      </div>

      {invoice.terms && (
        <div className="mt-12 break-inside-avoid text-xs text-slate-400">
          <p className="whitespace-pre-line">{invoice.terms}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-500">
      <span>{label}</span>
      <span className="font-mono text-slate-700">{value}</span>
    </div>
  );
}
