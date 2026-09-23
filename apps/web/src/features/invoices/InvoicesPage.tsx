import type { InvoiceListEntry, InvoiceWithItems } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { CreateInvoiceForm } from './CreateInvoiceForm';
import { InvoiceDetails } from './InvoiceDetails';
import { InvoiceList, type InvoiceRowAction } from './InvoiceList';
import { InvoiceTemplateView } from './templates/InvoiceTemplateView';
import * as invoicesApi from './api';

type TemplateInitialAction = 'print' | 'download' | 'whatsapp';

type View =
  | { name: 'list' }
  | { name: 'details'; invoice: InvoiceWithItems }
  | { name: 'template'; invoice: InvoiceWithItems; initialAction?: TemplateInitialAction; returnTo: 'list' | 'details' }
  | { name: 'form' };

const ROW_ACTION_TO_INITIAL_ACTION: Record<InvoiceRowAction, TemplateInitialAction | undefined> = {
  print: 'print',
  pdf: 'download',
  whatsapp: 'whatsapp',
  duplicate: undefined, // handled separately — never opens the template view
};

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

  async function handleRowAction(action: InvoiceRowAction, entry: InvoiceListEntry) {
    setLoadError(null);
    try {
      if (action === 'duplicate') {
        const created = await invoicesApi.duplicateInvoice(entry.id);
        setRefreshToken((t) => t + 1);
        setView({ name: 'details', invoice: created });
        return;
      }
      const full = await invoicesApi.getInvoice(entry.id);
      setView({ name: 'template', invoice: full, initialAction: ROW_ACTION_TO_INITIAL_ACTION[action], returnTo: 'list' });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.body.details?.items ?? err.body.error : 'Something went wrong');
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
          <InvoiceList refreshToken={refreshToken} onSelect={(entry) => openInvoice(entry.id)} onAction={handleRowAction} />
        )}

        {view.name === 'details' && (
          <InvoiceDetails
            invoice={view.invoice}
            onBack={() => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'list' });
            }}
            onViewTemplate={() => setView({ name: 'template', invoice: view.invoice, returnTo: 'details' })}
            onInvoiceUpdated={(invoice) => setView({ name: 'details', invoice })}
          />
        )}

        {view.name === 'template' && (
          <InvoiceTemplateView
            invoice={view.invoice}
            initialAction={view.initialAction}
            onBack={() => {
              if (view.returnTo === 'details') {
                setView({ name: 'details', invoice: view.invoice });
              } else {
                setRefreshToken((t) => t + 1);
                setView({ name: 'list' });
              }
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
