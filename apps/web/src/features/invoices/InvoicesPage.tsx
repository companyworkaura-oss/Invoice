import type { InvoiceListEntry, InvoiceWithItems, Permission } from '@invoice/shared';
import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { CreateInvoiceForm } from './CreateInvoiceForm';
import { InvoiceDetails } from './InvoiceDetails';
import { InvoiceList, type InvoiceRowAction } from './InvoiceList';
import { getLastInvoiceMode, setLastInvoiceMode } from './last-invoice-mode';
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
  onViewPayments: (customerId: string) => void;
  onViewCustomerAccount: (customerId: string) => void;
}

export function InvoicesPage({ permissions, onViewPayments, onViewCustomerAccount }: Props) {
  const [view, setView] = useState<View>({ name: 'list' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // UI/UX-02: "Quick Invoice" and "New invoice" used to have identical
  // visual weight with nothing distinguishing them beyond their
  // labels — read once per mount, not reactively, since this only
  // ever needs to settle which button looks primary when the list
  // first renders, not change weight mid-session.
  const [lastMode] = useState(getLastInvoiceMode);

  function openQuickForm() {
    setLastInvoiceMode('quick');
    setView({ name: 'quick-form' });
  }

  function openStandardForm() {
    setLastInvoiceMode('standard');
    setView({ name: 'form' });
  }

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
            {/*
              UI/UX-02: each button now names both its mode and the
              pricing style it uses, so the choice is no longer "two
              identical-looking buttons" — and whichever one was
              picked last gets the slightly heavier (filled) style
              next time, without hiding or removing either option.
            */}
            <EntryModeButton primary={lastMode === 'quick'} onClick={openQuickForm} title="Quick Invoice" subtitle="Simple pricing — description, quantity, unit price" />
            <EntryModeButton primary={lastMode === 'standard'} onClick={openStandardForm} title="New Invoice" subtitle="Embroidery pricing — category, stitches, rate" />
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
            onViewPayments={onViewPayments}
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
            onViewCustomerAccount={onViewCustomerAccount}
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

/** UI/UX-02: a two-line entry button — bold mode name, a small subtitle naming its pricing style. `primary` (the last-used mode) gets the filled/dark treatment; the other stays outline-only, so the two never compete at equal visual weight. */
function EntryModeButton({
  primary,
  onClick,
  title,
  subtitle,
}: {
  primary: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-left ${
        primary ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      <span className="block text-sm font-medium">+ {title}</span>
      <span className={`block text-[11px] ${primary ? 'text-slate-300' : 'text-slate-400'}`}>{subtitle}</span>
    </button>
  );
}
