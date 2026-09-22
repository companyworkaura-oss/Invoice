import type { InvoiceViewModel } from './types';

export function IndustrialBlueTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="mx-auto max-w-3xl border-4 border-blue-800 bg-white text-slate-900 shadow print:shadow-none">
      <div className="flex items-center justify-between bg-blue-800 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && (
            <img src={invoice.company.logoUrl} alt="" className="h-12 w-12 bg-white object-contain p-1" />
          )}
          <p className="text-lg font-black uppercase tracking-wide">{invoice.company.factoryName || invoice.company.name}</p>
        </div>
        <p className="text-xl font-black uppercase tracking-widest">Invoice</p>
      </div>

      <div className="grid grid-cols-3 divide-x-2 divide-blue-800 border-b-2 border-blue-800 text-sm">
        <InfoCell label="Invoice No." value={invoice.invoiceNumber} />
        <InfoCell label="Date" value={invoice.invoiceDate} />
        <InfoCell label="Quantity" value={invoice.quantity} />
      </div>

      <div className="border-b-2 border-blue-800 px-6 py-3 text-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-800">Bill To</p>
        <p className="font-semibold">{invoice.customer.businessName || invoice.customer.name}</p>
        {invoice.customer.address && <p className="text-slate-600">{invoice.customer.address}</p>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-blue-800 bg-blue-50 text-left text-xs font-bold uppercase tracking-wide text-blue-800">
            <th className="px-6 py-2">Description</th>
            <th className="px-3 py-2 text-right">Stitches</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-6 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="border-b border-blue-100">
              <td className="px-6 py-2">{item.description}</td>
              <td className="px-3 py-2 text-right">{item.stitches}</td>
              <td className="px-3 py-2 text-right">{item.rate}</td>
              <td className="px-6 py-2 text-right font-semibold">{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end border-t-2 border-blue-800 px-6 py-4">
        <div className="w-64 space-y-1 text-sm">
          <Row label="Current Bill" value={invoice.currentBill} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <div className="mt-1 flex justify-between bg-blue-800 px-2 py-1.5 font-black text-white">
            <span>Current Balance</span>
            <span>{invoice.currentBalance}</span>
          </div>
        </div>
      </div>

      {invoice.terms && (
        <div className="border-t-2 border-blue-800 px-6 py-3 text-xs text-slate-600">
          <p className="font-bold uppercase tracking-wide text-blue-800">Terms</p>
          <p className="mt-1 whitespace-pre-line">{invoice.terms}</p>
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-800">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-700">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
