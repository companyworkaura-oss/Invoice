import type { InvoiceListEntry, InvoiceWithItems, Permission } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { CreateInvoiceForm } from './CreateInvoiceForm';
import { InvoiceDetails } from './InvoiceDetails';
import { InvoiceList, type InvoiceRowAction } from './InvoiceList';
import { QuickInvoiceForm } from './QuickInvoiceForm';
import { InvoiceTemplateView } from './templates/InvoiceTemplateView';
import * as invoicesApi from './api';

type TemplateInitialAction = 'print' | 'download' | 'whatsapp';

type View =
  | { name: 'list' }
  | { name: 'details'; invoice: InvoiceWithItems }
  | { name: 'template'; invoice: InvoiceWithItems; initialAction?: TemplateInitialAction; returnTo: 'list' | 'details' }
  | { name: 'form' }
  | { name: 'quick-form' }
  | { name: 'edit'; invoice: InvoiceWithItems };

const ROW_ACTION_TO_INITIAL_ACTION: Record<InvoiceRowAction, TemplateInitialAction | undefined> = {
  print: 'print',
  pdf: 'download',
  whatsapp: 'whatsapp',
  duplicate: undefined, // handled separately — never opens the template view
};

interface Props {
  permissions: Permission[];
}

export function InvoicesPage({ permissions }: Props) {
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
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
        {view.name === 'list' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView({ name: 'quick-form' })}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              + Quick Invoice
            </button>
            <button
              type="button"
              onClick={() => setView({ name: 'form' })}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              + New invoice
            </button>
          </div>
        )}
      </div>

      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}

      <div className="mt-3 print:mt-0">
        {view.name === 'list' && (
          <InvoiceList
            refreshToken={refreshToken}
            permissions={permissions}
            onSelect={(entry) => openInvoice(entry.id)}
            onAction={handleRowAction}
          />
        )}

        {view.name === 'details' && (
          <InvoiceDetails
            invoice={view.invoice}
            permissions={permissions}
            onBack={() => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'list' });
            }}
            onViewTemplate={() => setView({ name: 'template', invoice: view.invoice, returnTo: 'details' })}
            onInvoiceUpdated={(invoice) => setView({ name: 'details', invoice })}
            onEdit={() => setView({ name: 'edit', invoice: view.invoice })}
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
            onSaved={(invoice) => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'details', invoice });
            }}
            onCancel={() => setView({ name: 'list' })}
          />
        )}

        {view.name === 'quick-form' && (
          <QuickInvoiceForm
            onSaved={(invoice) => {
              // Straight into the printable template — Print/Download
              // PDF/Share via WhatsApp right away, the same component
              // and actions a normal invoice's row buttons use.
              setView({ name: 'template', invoice, returnTo: 'list' });
            }}
            onCancel={() => setView({ name: 'list' })}
          />
        )}

        {/*
          invoice.invoiceMode decides the editor — never inferred from
          item shape here. A 'quick' invoice (manual description/
          quantity/unit-price items, no category) reopens in
          QuickInvoiceForm; everything else ('standard') reopens in
          CreateInvoiceForm exactly as before. Saving either one keeps
          sending the same item shape it always has, so the server
          re-derives the same invoiceMode and reopening it again lands
          back in the same editor.
        */}
        {view.name === 'edit' && view.invoice.invoiceMode === 'quick' && (
          <QuickInvoiceForm
            invoice={view.invoice}
            onSaved={(invoice) => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'details', invoice });
            }}
            onCancel={() => setView({ name: 'details', invoice: view.invoice })}
          />
        )}

        {view.name === 'edit' && view.invoice.invoiceMode !== 'quick' && (
          <CreateInvoiceForm
            invoice={view.invoice}
            onSaved={(invoice) => {
              setRefreshToken((t) => t + 1);
              setView({ name: 'details', invoice });
            }}
            onCancel={() => setView({ name: 'details', invoice: view.invoice })}
          />
        )}
      </div>
    </div>
  );
}
