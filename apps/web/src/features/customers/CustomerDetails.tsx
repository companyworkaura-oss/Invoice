import type { Customer, Permission } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { DangerButton, SecondaryButton, SectionHeading, StatusBadge } from '../../lib/ui';
import { CustomerLedgerPanel } from '../ledger/CustomerLedgerPanel';
import * as customersApi from './api';

interface Props {
  customer: Customer;
  onBack: () => void;
  onEdit: () => void;
  onArchived: (customer: Customer) => void;
  onViewStatement: () => void;
  permissions: Permission[];
}

const ROW: [string, keyof Customer][] = [
  ['Business name', 'businessName'],
  ['Phone', 'phone'],
  ['WhatsApp', 'whatsapp'],
  ['Address', 'address'],
  ['Opening balance', 'openingBalance'],
  ['Notes', 'notes'],
];

export function CustomerDetails({ customer, onBack, onEdit, onArchived, onViewStatement, permissions }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function handleArchive() {
    if (
      !window.confirm('Archive this customer? Existing invoices, payments and ledger history will remain.')
    ) {
      return;
    }
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

  async function handleUnarchive() {
    if (!window.confirm('Restore this customer to the active customer list?')) return;
    setError(null);
    setArchiving(true);
    try {
      onArchived(await customersApi.unarchiveCustomer(customer.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error : 'Something went wrong');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <SectionHeading>{customer.name}</SectionHeading>
          {customer.status === 'archived' && <StatusBadge label="Archived" tone="neutral" />}
        </div>
        <SecondaryButton onClick={onBack} className="px-3 py-1.5">
          ← Back
        </SecondaryButton>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        {ROW.map(([label, key]) => (
          <div key={key} className="flex gap-2">
            <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
            <dd className="text-slate-900">{customer[key] || '—'}</dd>
          </div>
        ))}
      </dl>

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {customer.status === 'active' && <SecondaryButton onClick={onEdit}>Edit</SecondaryButton>}
        <SecondaryButton onClick={onViewStatement}>View Statement</SecondaryButton>
        {customer.status === 'active' && (
          <DangerButton onClick={handleArchive} disabled={archiving}>
            {archiving ? 'Archiving…' : 'Archive'}
          </DangerButton>
        )}
        {customer.status === 'archived' && (
          <SecondaryButton onClick={handleUnarchive} disabled={archiving}>
            {archiving ? 'Restoring…' : 'Restore / Unarchive'}
          </SecondaryButton>
        )}
      </div>

      <CustomerLedgerPanel customerId={customer.id} permissions={permissions} />
    </div>
  );
}
