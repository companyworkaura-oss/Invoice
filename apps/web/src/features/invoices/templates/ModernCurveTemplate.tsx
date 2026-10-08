import type { InvoiceViewModel } from '@invoice/shared';
import { vs } from './compact';

export function ModernCurveTemplate({ invoice, compact }: { invoice: InvoiceViewModel; compact?: boolean }) {
  return (
    <div className="print-page-invoice mx-auto w-[148mm] min-h-[210mm] overflow-hidden rounded-3xl bg-white shadow print:shadow-none print:rounded-none">
      <div className={`relative overflow-hidden bg-violet-600 px-8 ${vs(compact, 'pb-10', 'pb-5')} ${vs(compact, 'pt-8', 'pt-4')} text-white`}>
        <div className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-violet-500/50" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-3">
            {invoice.company.logoUrl && (
              <img src={invoice.company.logoUrl} alt="" className="h-14 w-14 rounded-xl bg-white/90 object-contain p-1" />
            )}
            <div>
              <p className="text-[length:calc(1.125rem*var(--inv-scale,1))] font-semibold">{invoice.company.factoryName || invoice.company.name}</p>
              <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">
                {[invoice.company.phone, invoice.company.email].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="rounded-2xl bg-white/15 px-4 py-2 text-right backdrop-blur">
            <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-widest text-violet-100">Invoice</p>
            <p className="font-semibold">{invoice.invoiceNumber}</p>
            {invoice.billNumber && <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">Bill #: {invoice.billNumber}</p>}
            <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">{invoice.invoiceDate}</p>
            {invoice.customerLotNumber && <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">Lot #: {invoice.customerLotNumber}</p>}
            {invoice.generalQuantity && <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">Quantity: {invoice.generalQuantity} Suits</p>}
            {invoice.sets && <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] text-violet-100">Sets: {invoice.sets}</p>}
          </div>
        </div>
      </div>

      <div className={`px-8 ${vs(compact, 'pb-8', 'pb-4')} ${vs(compact, 'pt-6', 'pt-3')}`}>
        <div className={`rounded-2xl bg-violet-50 px-4 ${vs(compact, 'py-4', 'py-2')}`}>
          <p className="text-[length:calc(0.75rem*var(--inv-scale,1))] font-semibold uppercase tracking-wide text-violet-400">Billed to</p>
          <p className="font-semibold text-slate-900">{invoice.customer.businessName || invoice.customer.name}</p>
          {invoice.customer.address && <p className="text-[length:calc(0.875rem*var(--inv-scale,1))] text-slate-600">{invoice.customer.address}</p>}
        </div>

        <div className={`${vs(compact, 'mt-6', 'mt-3')} overflow-hidden rounded-2xl border border-violet-100`}>
          <table className="w-full text-[length:calc(0.875rem*var(--inv-scale,1))]">
            <thead>
              <tr className="bg-violet-50 text-left text-[length:calc(0.75rem*var(--inv-scale,1))] uppercase tracking-wide text-violet-500">
                <th className={`px-3 ${vs(compact, 'py-2', 'py-1')}`}>Description</th>
                {invoice.showItemQuantity && <th className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>Quantity</th>}
                <th className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>Stitches</th>
                {invoice.showUnitAmount && <th className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>Unit Amount</th>}
                <th className={`px-3 ${vs(compact, 'py-2', 'py-1')} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="break-inside-avoid border-t border-violet-100">
                  <td className={`px-3 ${vs(compact, 'py-2', 'py-1')} break-words`}>{item.description}</td>
                  {invoice.showItemQuantity && <td className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>{item.quantity}</td>}
                  <td className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>{item.stitches}</td>
                  {invoice.showUnitAmount && <td className={`px-2 ${vs(compact, 'py-2', 'py-1')} text-right`}>{item.unitAmount}</td>}
                  <td className={`px-3 ${vs(compact, 'py-2', 'py-1')} text-right`}>{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={`${vs(compact, 'mt-6', 'mt-3')} totals-section flex justify-end break-inside-avoid`}>
          <div className={`w-64 ${vs(compact, 'space-y-1', 'space-y-0.5')} rounded-2xl bg-violet-600 px-4 ${vs(compact, 'py-4', 'py-2')} text-[length:calc(0.875rem*var(--inv-scale,1))] text-white`}>
            <Row label="Subtotal" value={invoice.subtotal} />
            {invoice.discountType && <Row label={invoice.discountLabel} value={`-${invoice.discountAmount}`} />}
            <Row label="Grand Total" value={invoice.grandTotal} />
            <Row label="Previous Balance" value={invoice.previousBalance} />
            <Row label="Amount Paid" value={invoice.amountPaid} />
            <div className="mt-1 flex justify-between border-t border-white/30 pt-1 text-[length:calc(1rem*var(--inv-scale,1))] font-semibold">
              <span>Current Balance</span>
              <span>{invoice.currentBalance}</span>
            </div>
          </div>
        </div>

        {invoice.terms && (
          <div className={`${vs(compact, 'mt-6', 'mt-3')} break-inside-avoid rounded-xl bg-slate-50 px-3 ${vs(compact, 'py-3', 'py-1.5')} text-[length:calc(0.75rem*var(--inv-scale,1))] text-slate-500`}>
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
