import type { InvoiceViewModel } from '@invoice/shared';
import { vs } from './compact';

export function MinimalCleanTemplate({ invoice, compact }: { invoice: InvoiceViewModel; compact?: boolean }) {
  return (
    <div className={`print-page-invoice mx-auto w-[148mm] min-h-[210mm] bg-white px-10 ${vs(compact, 'py-10', 'py-5')} text-slate-900`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && <img src={invoice.company.logoUrl} alt="" className="h-10 w-10 object-contain" />}
          <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] font-medium">{invoice.company.factoryName || invoice.company.name}</p>
        </div>
        <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-400">{invoice.invoiceDate}</p>
      </div>

      <div className={`${vs(compact, 'mt-10', 'mt-4')} flex items-baseline justify-between`}>
        <h1 className="text-[length:calc(1.875rem*var(--inv-scale,1))] font-light tracking-tight">Invoice</h1>
        <div className="text-right">
          <p className="font-mono text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-500">{invoice.invoiceNumber}</p>
          {invoice.lotNumber && <p className="font-mono text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-400">Lot #: {invoice.lotNumber}</p>}
        </div>
      </div>

      <div className={`${vs(compact, 'mt-8', 'mt-3')} grid grid-cols-2 gap-8 text-[length:calc(0.875rem*var(--inv-scale,1))]`}>
        <div>
          <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-slate-400">From</p>
          <p className="mt-1">{invoice.company.name}</p>
          {invoice.company.address && <p className="text-slate-500">{invoice.company.address}</p>}
          {invoice.company.email && <p className="text-slate-500">{invoice.company.email}</p>}
        </div>
        <div>
          <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-slate-400">To</p>
          <p className="mt-1">{invoice.customer.businessName || invoice.customer.name}</p>
          {invoice.customer.address && <p className="text-slate-500">{invoice.customer.address}</p>}
        </div>
      </div>

      <table className={`${vs(compact, 'mt-10', 'mt-4')} w-full text-[length:calc(0.875rem*var(--inv-scale,1))]`}>
        <thead>
          <tr className="border-b border-slate-900 text-left text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-slate-400">
            <th className={`${vs(compact, 'pb-2', 'pb-1')} font-normal`}>Description</th>
            <th className={`${vs(compact, 'pb-2', 'pb-1')} text-right font-normal`}>Quantity</th>
            <th className={`${vs(compact, 'pb-2', 'pb-1')} text-right font-normal`}>Stitches</th>
            <th className={`${vs(compact, 'pb-2', 'pb-1')} text-right font-normal`}>Unit Amount</th>
            <th className={`${vs(compact, 'pb-2', 'pb-1')} text-right font-normal`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="break-inside-avoid border-b border-slate-100">
              <td className={`${vs(compact, 'py-2', 'py-1')} break-words`}>{item.description}</td>
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right font-mono`}>{item.quantity}</td>
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right font-mono`}>{item.stitches}</td>
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right font-mono`}>{item.unitAmount}</td>
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right font-mono`}>{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={`${vs(compact, 'mt-8', 'mt-3')} totals-section flex justify-end break-inside-avoid`}>
        <div className={`w-56 ${vs(compact, 'space-y-1.5', 'space-y-0.5')} text-[length:calc(0.875rem*var(--inv-scale,1))]`}>
          <Row label="Subtotal" value={invoice.subtotal} />
          {invoice.discountType && <Row label={invoice.discountLabel} value={`-${invoice.discountAmount}`} />}
          <Row label="Grand Total" value={invoice.grandTotal} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <div className={`flex justify-between border-t border-slate-900 ${vs(compact, 'pt-1.5', 'pt-1')} font-medium`}>
            <span>Current Balance</span>
            <span className="font-mono">{invoice.currentBalance}</span>
          </div>
        </div>
      </div>

      {invoice.terms && (
        <div className={`${vs(compact, 'mt-12', 'mt-5')} break-inside-avoid text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-400`}>
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
