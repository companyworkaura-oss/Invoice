import type { InvoiceViewModel } from './types';

export function ModernCurveTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl bg-white shadow print:shadow-none">
      <div className="relative overflow-hidden bg-violet-600 px-8 pb-10 pt-8 text-white">
        <div className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-violet-500/50" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            {invoice.company.logoUrl && (
              <img src={invoice.company.logoUrl} alt="" className="h-14 w-14 rounded-xl bg-white/90 object-contain p-1" />
            )}
            <div>
              <p className="text-lg font-semibold">{invoice.company.factoryName || invoice.company.name}</p>
              <p className="text-xs text-violet-100">
                {[invoice.company.phone, invoice.company.email].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="rounded-2xl bg-white/15 px-4 py-2 text-right backdrop-blur">
            <p className="text-xs uppercase tracking-widest text-violet-100">Invoice</p>
            <p className="font-semibold">{invoice.invoiceNumber}</p>
            <p className="text-xs text-violet-100">{invoice.invoiceDate}</p>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8 pt-6">
        <div className="rounded-2xl bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">Billed to</p>
          <p className="font-semibold text-slate-900">{invoice.customer.businessName || invoice.customer.name}</p>
          {invoice.customer.address && <p className="text-sm text-slate-600">{invoice.customer.address}</p>}
          <p className="mt-1 text-sm text-slate-600">Quantity: {invoice.quantity}</p>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-violet-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-violet-50 text-left text-xs uppercase tracking-wide text-violet-500">
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-right">Stitches</th>
                <th className="px-4 py-2 text-right">Rate</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-t border-violet-100">
                  <td className="px-4 py-2">{item.description}</td>
                  <td className="px-4 py-2 text-right">{item.stitches}</td>
                  <td className="px-4 py-2 text-right">{item.rate}</td>
                  <td className="px-4 py-2 text-right">{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-64 space-y-1 rounded-2xl bg-violet-600 p-4 text-sm text-white">
            <Row label="Current Bill" value={invoice.currentBill} />
            <Row label="Previous Balance" value={invoice.previousBalance} />
            <Row label="Amount Paid" value={invoice.amountPaid} />
            <div className="mt-1 flex justify-between border-t border-white/30 pt-1 text-base font-semibold">
              <span>Current Balance</span>
              <span>{invoice.currentBalance}</span>
            </div>
          </div>
        </div>

        {invoice.terms && (
          <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            <p className="font-semibold uppercase tracking-wide text-slate-400">Terms</p>
            <p className="mt-1 whitespace-pre-line">{invoice.terms}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-violet-100">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
