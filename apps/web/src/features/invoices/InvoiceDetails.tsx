import type { InvoiceWithItems } from '@invoice/shared';

interface Props {
  invoice: InvoiceWithItems;
  onBack: () => void;
}

export function InvoiceDetails({ invoice, onBack }: Props) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{invoice.invoiceNumber}</h3>
          <p className="text-xs text-slate-500">
            {invoice.customerName} · {invoice.invoiceDate} · {invoice.status}
          </p>
        </div>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline">
          Back
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-600">Quantity: {invoice.quantity}</p>
      {invoice.notes && <p className="mt-1 text-sm text-slate-600">Notes: {invoice.notes}</p>}

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-medium">Category</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 text-right font-medium">Stitches</th>
            <th className="py-1 pr-2 text-right font-medium">Rate</th>
            <th className="py-1 pr-2 text-right font-medium">Unit amount</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="py-1 pr-2">{item.categoryName}</td>
              <td className="py-1 pr-2 text-slate-500">{item.description ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{item.stitches}</td>
              <td className="py-1 pr-2 text-right">{item.rate}</td>
              <td className="py-1 pr-2 text-right">{item.calculatedUnitAmount}</td>
              <td className="py-1 text-right">{item.calculatedTotal}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="pt-2 text-right text-sm font-medium text-slate-900">
              Total
            </td>
            <td className="pt-2 text-right text-sm font-semibold text-slate-900">{invoice.totalAmount}</td>
          </tr>
        </tfoot>
      </table>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm sm:grid-cols-5">
        <StatRow label="Previous Balance" value={invoice.previousBalance} />
        <StatRow label="Current Bill" value={invoice.totalAmount} />
        <StatRow label="Total Receivable" value={invoice.totalReceivable} />
        <StatRow label="Amount Paid" value={invoice.amountPaid} />
        <StatRow label="Current Balance" value={invoice.currentBalance} emphasize />
      </dl>
    </div>
  );
}

function StatRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={emphasize ? 'font-semibold text-slate-900' : 'text-slate-700'}>{value}</dd>
    </div>
  );
}
