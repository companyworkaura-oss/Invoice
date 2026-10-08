import type { InvoiceViewModel } from '@invoice/shared';
import { vs } from './compact';

export function ClassicNavyTemplate({ invoice, compact }: { invoice: InvoiceViewModel; compact?: boolean }) {
  return (
    <div className={`print-page-invoice mx-auto w-[148mm] min-h-[210mm] bg-white px-8 ${vs(compact, 'py-8', 'py-4')} font-serif text-slate-800 shadow print:shadow-none`}>
      <div className={`flex items-start justify-between border-b-4 border-blue-950 ${vs(compact, 'pb-4', 'pb-2')}`}>
        <div className="flex items-center gap-3">
          {invoice.company.logoUrl && (
            <img src={invoice.company.logoUrl} alt="" className="h-14 w-14 object-contain" />
          )}
          <div>
            <p className="text-[length:calc(1.125rem*var(--inv-scale,1))] font-bold text-blue-950">{invoice.company.factoryName || invoice.company.name}</p>
            <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-500">
              {[invoice.company.address, invoice.company.phone, invoice.company.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[length:calc(1.5rem*var(--inv-scale,1))] font-bold tracking-wide text-blue-950">INVOICE</p>
          <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">{invoice.invoiceNumber}</p>
          {invoice.billNumber && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">Bill #: {invoice.billNumber}</p>}
          <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">{invoice.invoiceDate}</p>
          {invoice.customerLotNumber && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">Lot #: {invoice.customerLotNumber}</p>}
          {invoice.generalQuantity && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">Quantity: {invoice.generalQuantity} Suits</p>}
          {invoice.sets && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">Sets: {invoice.sets}</p>}
        </div>
      </div>

      <div className={vs(compact, 'mt-4', 'mt-2')}>
        <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] font-semibold uppercase tracking-wide text-slate-400">Bill To</p>
        <p className="font-semibold text-slate-900">{invoice.customer.businessName || invoice.customer.name}</p>
        {invoice.customer.businessName && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">{invoice.customer.name}</p>}
        {invoice.customer.address && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">{invoice.customer.address}</p>}
      </div>

      <table className={`${vs(compact, 'mt-6', 'mt-3')} w-full text-[length:calc(0.875rem*var(--inv-scale,1))]`}>
        <thead>
          <tr className="border-b-2 border-blue-950 text-left text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-wide text-blue-950">
            <th className={vs(compact, 'py-2', 'py-1')}>Description</th>
            {invoice.showItemQuantity && <th className={`${vs(compact, 'py-2', 'py-1')} text-right`}>Quantity</th>}
            <th className={`${vs(compact, 'py-2', 'py-1')} text-right`}>Stitches</th>
            {invoice.showUnitAmount && <th className={`${vs(compact, 'py-2', 'py-1')} text-right`}>Unit Amount</th>}
            <th className={`${vs(compact, 'py-2', 'py-1')} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="break-inside-avoid border-b border-slate-200">
              <td className={`${vs(compact, 'py-2', 'py-1')} break-words`}>{item.description}</td>
              {invoice.showItemQuantity && <td className={`${vs(compact, 'py-2', 'py-1')} text-right`}>{item.quantity}</td>}
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right`}>{item.stitches}</td>
              {invoice.showUnitAmount && <td className={`${vs(compact, 'py-2', 'py-1')} text-right`}>{item.unitAmount}</td>}
              <td className={`${vs(compact, 'py-2', 'py-1')} text-right`}>{item.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={`${vs(compact, 'mt-6', 'mt-3')} totals-section flex justify-end break-inside-avoid`}>
        <div className={`w-64 ${vs(compact, 'space-y-1', 'space-y-0.5')} border-t-2 border-blue-950 ${vs(compact, 'pt-2', 'pt-1')} text-[length:calc(0.875rem*var(--inv-scale,1))]`}>
          <Row label="Subtotal" value={invoice.subtotal} />
          {invoice.discountType && <Row label={invoice.discountLabel} value={`-${invoice.discountAmount}`} />}
          <Row label="Grand Total" value={invoice.grandTotal} />
          <Row label="Previous Balance" value={invoice.previousBalance} />
          <Row label="Amount Paid" value={invoice.amountPaid} />
          <Row label="Current Balance" value={invoice.currentBalance} strong />
        </div>
      </div>

      {invoice.terms && (
        <div className={`${vs(compact, 'mt-8', 'mt-4')} break-inside-avoid border-t border-slate-200 ${vs(compact, 'pt-3', 'pt-1')} text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-500`}>
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
