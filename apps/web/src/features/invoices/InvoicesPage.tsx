import type { InvoiceWithItems } from '@invoice/shared';
import { useState } from 'react';
import { CreateInvoiceForm } from './CreateInvoiceForm';
import { InvoiceDetails } from './InvoiceDetails';
import { InvoiceList } from './InvoiceList';
import * as invoicesApi from './api';

type View = { name: 'list' } | { name: 'details'; invoice: InvoiceWithItems } | { name: 'form' };

export function InvoicesPage() {
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function openInvoice(id: string) {
    setLoadError(null);
    try {
      setView({ name: 'details', invoice: await invoicesApi.getInvoice(id) });
    } catch {
      setLoadError('Could not load that invoice.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
        {view.name === 'list' && (
          <button
            type="button"
            onClick={() => setView({ name: 'form' })}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            New invoice
          </button>
        )}
      </div>

      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}

      <div className="mt-3">
        {view.name === 'list' && (
          <InvoiceList refreshToken={refreshToken} onSelect={(entry) => openInvoice(entry.id)} />
        )}

        {view.name === 'details' && (
          <InvoiceDetails
            invoice={view.invoice}
            onBack={() => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'list' });
            }}
          />
        )}

        {view.name === 'form' && (
          <CreateInvoiceForm
            onCreated={(invoice) => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'details', invoice });
            }}
            onCancel={() => setView({ name: 'list' })}
          />
        )}
      </div>
    </div>
  );
}
