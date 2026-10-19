import type { InvoiceWithItems, Permission } from '@invoice/shared';
import { calculateSets, formatNumber, formatQuantity } from '@invoice/shared';
import { useState } from 'react';
import { PaymentForm } from '../payments/PaymentForm';
import * as invoicesApi from './api';

interface Props {
  invoice: InvoiceWithItems;
  permissions: Permission[];
  onBack: () => void;
  onViewTemplate: () => void;
  onInvoiceUpdated: (invoice: InvoiceWithItems) => void;
  onEdit: () => void;
}

export function InvoiceDetails({ invoice, permissions, onBack, onViewTemplate, onInvoiceUpdated, onEdit }: Props) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const canEdit = invoice.status === 'draft' && permissions.includes('invoice.edit');
  const sets = calculateSets(invoice.generalQuantity);
  const formattedGeneralQuantity = formatQuantity(invoice.generalQuantity);
  const hasReferences = Boolean(invoice.billNumber || invoice.lotNumber || invoice.customerLotNumber || invoice.gatePassNumber);
  const hasQuantity = Boolean(formattedGeneralQuantity || sets);

  async function refresh() {
    onInvoiceUpdated(await invoicesApi.getInvoice(invoice.id));
  }

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{invoice.invoiceNumber}</h3>
          <p className="text-xs text-slate-500">{invoice.customerName}</p>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <button type="button" onClick={onEdit} className="text-xs text-slate-500 underline">
              Edit
            </button>
          )}
          <button type="button" onClick={onViewTemplate} className="text-xs text-slate-500 underline">
            View / Print
          </button>
          <button type="button" onClick={onBack} className="text-xs text-slate-500 underline">
            Back
          </button>
        </div>
      </div>

      {invoice.notes && <p className="mt-1 text-sm text-slate-600">Notes: {invoice.notes}</p>}

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Invoice Information</p>
        <div className="mt-2 space-y-3">
          <MetaGroup title="Invoice">
            <MetaField label="Invoice No." value={invoice.invoiceNumber} />
            <MetaField label="Date" value={invoice.invoiceDate} />
            <MetaField label="Status" value={capitalize(invoice.status)} />
          </MetaGroup>

          {hasReferences && (
            <MetaGroup title="References">
              {invoice.billNumber && <MetaField label="Bill Number" value={invoice.billNumber} />}
              {invoice.lotNumber && <MetaField label="Internal Lot" value={invoice.lotNumber} />}
              {invoice.customerLotNumber && <MetaField label="Customer Lot" value={invoice.customerLotNumber} />}
              {invoice.gatePassNumber && <MetaField label="Gate Pass" value={invoice.gatePassNumber} />}
            </MetaGroup>
          )}

          {hasQuantity && (
            <MetaGroup title="Quantity">
              {formattedGeneralQuantity && <MetaField label="General Quantity" value={formattedGeneralQuantity} />}
              {sets && <MetaField label="Sets" value={sets} />}
            </MetaGroup>
          )}
        </div>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1 pr-2 font-medium">Category</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 pr-2 text-right font-medium">Quantity</th>
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
              <td className="py-1 pr-2 text-right">{formatNumber(item.quantity)}</td>
              <td className="py-1 pr-2 text-right">{item.stitches}</td>
              <td className="py-1 pr-2 text-right">{formatNumber(item.rate)}</td>
              <td className="py-1 pr-2 text-right">{formatNumber(item.calculatedUnitAmount)}</td>
              <td className="py-1 text-right">{formatNumber(item.calculatedTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="pt-2 text-right text-sm text-slate-500">
              Subtotal
            </td>
            <td className="pt-2 text-right text-sm text-slate-700">{formatNumber(invoice.totalAmount)}</td>
          </tr>
          {invoice.discountType && (
            <tr>
              <td colSpan={6} className="pt-1 text-right text-sm text-slate-500">
                {invoice.discountType === 'percentage' ? `Discount (${formatNumber(invoice.discountValue)}%)` : 'Discount'}
              </td>
              <td className="pt-1 text-right text-sm text-slate-700">-{formatNumber(invoice.discountAmount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={6} className="pt-1 text-right text-sm font-medium text-slate-900">
              Grand Total
            </td>
            <td className="pt-1 text-right text-sm font-semibold text-slate-900">{formatNumber(invoice.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm sm:grid-cols-5">
        <StatRow label="Previous Balance" value={formatNumber(invoice.previousBalance)} />
        <StatRow label="Grand Total" value={formatNumber(invoice.grandTotal)} />
        <StatRow label="Total Receivable" value={formatNumber(invoice.totalReceivable)} />
        <StatRow label="Amount Paid" value={formatNumber(invoice.amountPaid)} />
        <StatRow label="Current Balance" value={formatNumber(invoice.currentBalance)} emphasize />
      </dl>

      <div className="mt-4 border-t border-slate-200 pt-3">
        {showPaymentForm ? (
          <PaymentForm
            customerId={invoice.customerId}
            suggestedAmount={invoice.currentBalance !== '0.00' ? invoice.currentBalance : undefined}
            onRecorded={() => {
              setShowPaymentForm(false);
              refresh();
            }}
            onCancel={() => setShowPaymentForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowPaymentForm(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Record a payment
          </button>
        )}
      </div>
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

/** One labeled group inside the Invoice Information card — e.g. Invoice / References / Quantity. */
function MetaGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <dl className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </div>
  );
}

/** A single label/value pair inside a MetaGroup — the caller is responsible for not rendering this at all when the value is empty, so no field ever shows as a blank dash. */
function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
