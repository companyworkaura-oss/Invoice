import type { InvoiceViewModel } from '@invoice/shared';

export function IndustrialBlueTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="print-page-invoice mx-auto w-[148mm] min-h-[210mm] border-4 border-blue-800 bg-white text-slate-900 shadow print:shadow-none">
      <div className="flex items-center justify-between bg-blue-800 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && (
            <img src={invoice.company.logoUrl} alt="" className="h-12 w-12 bg-white object-contain p-1" />
          )}
          <p className="text-[length:calc(1.125rem*var(--inv-scale,1))] font-black uppercase tracking-wide">{invoice.company.factoryName || invoice.company.name}</p>
        </div>
        <p className="text-[length:calc(1.25rem*var(--inv-scale,1))] font-black uppercase tracking-widest">Invoice</p>
      </div>

      <div className={`grid divide-x-2 divide-blue-800 border-b-2 border-blue-800 text-[length:calc(0.875rem*var(--inv-scale,1))] ${invoice.lotNumber ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <InfoCell label="Invoice No." value={invoice.invoiceNumber} />
        <InfoCell label="Date" value={invoice.invoiceDate} />
        {invoice.lotNumber && <InfoCell label="Lot #" value={invoice.lotNumber} />}
      </div>

      <div className="border-b-2 border-blue-800 px-6 py-3 text-[length:calc(0.875rem*var(--inv-scale,1))]">
        <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] font-bold uppercase tracking-widest text-blue-800">Bill To</p>
        <p className="font-semibold">{invoice.customer.businessName || invoice.customer.name}</p>
        {invoice.customer.address && <p className="text-slate-600">{invoice.customer.address}</p>}
      </div>

      <table className="w-full text-[length:calc(0.875rem*var(--inv-scale,1))]">
        <thead>
          <tr className="border-b-2 border-blue-800 bg-blue-50 text-left text-[length:calc(0.75rem*var(--inv-scale,1))] font-bold uppercase tracking-wide text-blue-800">
            <th className="px-4 py-2">Description</th>
            <th className="px-3 py-2 text-right">Quantity</th>
            <th className="px-3 py-2 text-right">Stitches</th>
            <th className="px-3 py-2 text-right">Unit Amount</th>
            <th className="px-4 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="break-inside-avoid border-b border-blue-100">
              <td className="px-4 py-2 break-words">{item.description}</td>
              <td className="px-3 py-2 text-right">{item.quantity}</td>
              <td className="px-3 py-2 text-right">{item.stitches}</td>
              <td className="px-3 py-2 text-right">{item.unitAmount}</td>
              <td className="px-4 py-2 text-right font-semibold">{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex break-inside-avoid justify-end border-t-2 border-blue-800 px-6 py-4">
        <div className="w-64 space-y-1 text-[length:calc(0.875rem*var(--inv-scale,1))]">
          <Row label="Subtotal" value={invoice.subtotal} />
          {invoice.discountType && <Row label={invoice.discountLabel} value={`-${invoice.discountAmount}`} />}
          <Row label="Grand Total" value={invoice.grandTotal} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <div className="mt-1 flex justify-between bg-blue-800 px-2 py-1.5 font-black text-white">
            <span>Current Balance</span>
            <span>{invoice.currentBalance}</span>
          </div>
        </div>
      </div>

      {invoice.terms && (
        <div className="break-inside-avoid border-t-2 border-blue-800 px-6 py-3 text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-600">
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
      <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] font-bold uppercase tracking-widest text-blue-800">{label}</p>
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
