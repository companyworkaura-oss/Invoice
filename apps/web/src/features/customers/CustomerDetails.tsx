import type { Customer } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { CustomerLedgerPanel } from '../ledger/CustomerLedgerPanel';
import * as customersApi from './api';

interface Props {
  customer: Customer;
  onBack: () => void;
  onEdit: () => void;
  onArchived: (customer: Customer) => void;
}

const ROW: [string, keyof Customer][] = [
  ['Business name', 'businessName'],
  ['Phone', 'phone'],
  ['WhatsApp', 'whatsapp'],
  ['Address', 'address'],
  ['Opening balance', 'openingBalance'],
  ['Notes', 'notes'],
];

export function CustomerDetails({ customer, onBack, onEdit, onArchived }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function handleArchive() {
    setError(null);
    setArchiving(true);
    try {
      onArchived(await customersApi.archiveCustomer(customer.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{customer.name}</h3>
          {customer.status === 'archived' && <p className="text-xs text-slate-400">Archived</p>}
        </div>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline">
          Back
        </button>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        {ROW.map(([label, key]) => (
          <div key={key} className="flex gap-2">
            <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
            <dd className="text-slate-900">{customer[key] || '—'}</dd>
          </div>
        ))}
      </dl>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Edit
        </button>
        {customer.status === 'active' && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {archiving ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>

      <CustomerLedgerPanel customerId={customer.id} />
    </div>
  );
}
