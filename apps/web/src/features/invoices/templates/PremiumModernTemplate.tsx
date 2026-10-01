import type { InvoiceViewModel } from '@invoice/shared';

export function PremiumModernTemplate({ invoice }: { invoice: InvoiceViewModel }) {
  return (
    <div className="print-page-invoice mx-auto w-[148mm] min-h-[210mm] bg-white text-slate-800 shadow print:shadow-none">
      <div className="flex items-center justify-between bg-slate-900 px-8 py-6">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && (
            <img src={invoice.company.logoUrl} alt="" className="h-12 w-12 rounded object-contain" />
          )}
          <div>
            <p className="text-[length:calc(1.125rem*var(--inv-scale,1))] font-semibold text-white">{invoice.company.factoryName || invoice.company.name}</p>
            <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] tracking-wide text-amber-400">
              {[invoice.company.phone, invoice.company.email].filter(Boolean).join('  ·  ')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] font-semibold uppercase tracking-[0.3em] text-amber-400">Invoice</p>
          <p className="text-[length:calc(1.125rem*var(--inv-scale,1))] font-light text-white">{invoice.invoiceNumber}</p>
        </div>
      </div>

      <div className="border-b border-amber-300/60 px-8 py-4">
        <div className="flex items-center justify-between text-[length:calc(0.875rem*var(--inv-scale,1))]">
          <div>
            <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-slate-400">Prepared for</p>
            <p className="font-medium text-slate-900">{invoice.customer.businessName || invoice.customer.name}</p>
            {invoice.customer.address && <p className="text-slate-500">{invoice.customer.address}</p>}
          </div>
          <div className="text-right text-slate-500">
            <p>{invoice.invoiceDate}</p>
            {invoice.lotNumber && <p>Lot #: {invoice.lotNumber}</p>}
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        <table className="w-full text-[length:calc(0.875rem*var(--inv-scale,1))]">
          <thead>
            <tr className="border-b border-amber-400 text-left text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-slate-500">
              <th className="pb-2 font-medium">Description</th>
              <th className="pb-2 text-right font-medium">Quantity</th>
              <th className="pb-2 text-right font-medium">Stitches</th>
              <th className="pb-2 text-right font-medium">Unit Amount</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="break-inside-avoid border-b border-slate-100">
                <td className="py-2.5 break-words">{item.description}</td>
                <td className="py-2.5 text-right">{item.quantity}</td>
                <td className="py-2.5 text-right">{item.stitches}</td>
                <td className="py-2.5 text-right">{item.unitAmount}</td>
                <td className="py-2.5 text-right">{item.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-end break-inside-avoid">
          <div className="w-64 space-y-1.5 text-[length:calc(0.875rem*var(--inv-scale,1))]">
            <Row label="Subtotal" value={invoice.subtotal} />
            {invoice.discountType && <Row label={invoice.discountLabel} value={`-${invoice.discountAmount}`} />}
            <Row label="Grand Total" value={invoice.grandTotal} />
            <Row label="Previous Balance" value={invoice.previousBalance} />
            <Row label="Amount Paid" value={invoice.amountPaid} />
            <div className="mt-2 flex justify-between border-t-2 border-slate-900 pt-2 text-[length:calc(1rem*var(--inv-scale,1))] font-semibold text-slate-900">
              <span>Current Balance</span>
              <span>{invoice.currentBalance}</span>
            </div>
          </div>
        </div>

        {invoice.terms && (
          <div className="mt-10 break-inside-avoid border-t border-slate-100 pt-4 text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-400">
            <p className="font-semibold uppercase tracking-widest text-slate-400">Terms</p>
            <p className="mt-1 whitespace-pre-line">{invoice.terms}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-500">
      <span>{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
