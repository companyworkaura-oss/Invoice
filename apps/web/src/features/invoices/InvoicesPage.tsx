import type { InvoiceListEntry, InvoiceWithItems, Permission } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { CreateInvoiceForm } from './CreateInvoiceForm';
import { InvoiceDetails } from './InvoiceDetails';
import { InvoiceList, type InvoiceRowAction } from './InvoiceList';
import { getLastInvoiceMode, setLastInvoiceMode } from './last-invoice-mode';
import { QuickInvoiceForm } from './QuickInvoiceForm';
import { InvoiceTemplateView } from './templates/InvoiceTemplateView';
import * as invoicesApi from './api';

type TemplateInitialAction = 'print' | 'download' | 'whatsapp';

const ROW_ACTION_TO_INITIAL_ACTION: Record<InvoiceRowAction, TemplateInitialAction | undefined> = {
  print: 'print',
  pdf: 'download',
  whatsapp: 'whatsapp',
  duplicate: undefined, // handled separately — never opens the template view
};

interface Props {
  permissions: Permission[];
}

/**
 * UI/UX-03 Part 1/2/3: `/invoices`, `/invoices/new`, `/invoices/quick`,
 * `/invoices/:id`, `/invoices/:id/edit`, and `/invoices/:id/print` are
 * now real, addressable, refreshable URLs — this used to be one
 * `view` union kept entirely in local state, so a refresh anywhere
 * but the bare list lost whatever the user was looking at, and
 * Browser Back didn't correspond to anything (there was nothing to
 * go "back" to; the URL never changed). Each sub-route below fetches
 * its own invoice by `:id` on mount, so a refresh on
 * `/invoices/:id` (or `/edit`, or `/print`) re-fetches and lands
 * right back where it was instead of bouncing to the list.
 *
 * "Back" from detail/edit/print — and Cancel from new/quick/edit —
 * all call `navigate(-1)` rather than `navigate('/invoices')`: popping
 * one history entry lands exactly on whatever `/invoices?search=...`
 * URL the user actually came from, filters and all, which is what
 * makes Scenario A (search + filter + open + Back) work for free
 * once the list's own filters live in the URL (see InvoiceList.tsx)
 * — there is no separate "remembered list state" to keep in sync.
 */
export function InvoicesPage({ permissions }: Props) {
  return (
    <Routes>
      <Route index element={<InvoiceListRoute permissions={permissions} />} />
      <Route path="new" element={<CreateInvoiceRoute />} />
      <Route path="quick" element={<QuickInvoiceRoute />} />
      <Route path=":id" element={<InvoiceDetailRoute permissions={permissions} />} />
      <Route path=":id/edit" element={<InvoiceEditRoute />} />
      <Route path=":id/print" element={<InvoiceTemplateRoute />} />
      <Route path="*" element={<Navigate to="/invoices" replace />} />
    </Routes>
  );
}

function InvoiceListRoute({ permissions }: { permissions: Permission[] }) {
  const navigate = useNavigate();
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // UI/UX-02: read once per mount, not reactively — see EntryModeButton's doc comment.
  const [lastMode] = useState(getLastInvoiceMode);

  function openQuickForm() {
    setLastInvoiceMode('quick');
    navigate('/invoices/quick');
  }

  function openStandardForm() {
    setLastInvoiceMode('standard');
    navigate('/invoices/new');
  }

  async function handleRowAction(action: InvoiceRowAction, entry: InvoiceListEntry) {
    setLoadError(null);
    try {
      if (action === 'duplicate') {
        const created = await invoicesApi.duplicateInvoice(entry.id);
        setRefreshToken((t) => t + 1);
        navigate(`/invoices/${created.id}`);
        return;
      }
      const initialAction = ROW_ACTION_TO_INITIAL_ACTION[action];
      navigate(`/invoices/${entry.id}/print${initialAction ? `?action=${initialAction}` : ''}`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.body.details?.items ?? err.body.error : 'Something went wrong');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">Invoices</h2>
        <div className="flex gap-2">
          {/*
            UI/UX-02: each button names both its mode and the pricing
            style it uses; whichever was picked last gets the
            slightly heavier (filled) style next time.
          */}
          <EntryModeButton primary={lastMode === 'quick'} onClick={openQuickForm} title="Quick Invoice" subtitle="Simple pricing — description, quantity, unit price" />
          <EntryModeButton primary={lastMode === 'standard'} onClick={openStandardForm} title="New Invoice" subtitle="Embroidery pricing — category, stitches, rate" />
        </div>
      </div>

      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}

      <div className="mt-3 print:mt-0">
        <InvoiceList
          refreshToken={refreshToken}
          permissions={permissions}
          onSelect={(entry) => navigate(`/invoices/${entry.id}`)}
          onAction={handleRowAction}
          onViewPayments={(customerId) => navigate(`/payments?customerId=${customerId}`)}
        />
      </div>
    </div>
  );
}

/**
 * UI/UX-03 Part 9: fetches the invoice this route's `:id` names, and —
 * since that id lives entirely in the URL, not in any per-company
 * component state — automatically redirects to the plain invoice list
 * if it 404s. The one time this actually happens is switching to a
 * company that doesn't have (or can no longer see) this invoice: the
 * URL itself doesn't change on a company switch, but the session
 * backing `getInvoice` now belongs to the new company, so the exact
 * same tenant-isolation check that already protects every invoice
 * route server-side naturally turns into "safely redirect" here —
 * this never has to special-case "did the company just change", it
 * just reacts to the fetch failing.
 */
function useInvoiceFromParam(): { invoice: InvoiceWithItems | null; error: string | null; setInvoice: (invoice: InvoiceWithItems) => void } {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // oxlint-disable-next-line react/set-state-in-effect
    setInvoice(null);
    setError(null);
    invoicesApi
      .getInvoice(id)
      .then(setInvoice)
      .catch(() => {
        setError('Could not load that invoice.');
        navigate('/invoices', { replace: true });
      });
  }, [id, navigate]);

  return { invoice, error, setInvoice };
}

function InvoiceDetailRoute({ permissions }: { permissions: Permission[] }) {
  const navigate = useNavigate();
  const { invoice, error, setInvoice } = useInvoiceFromParam();

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!invoice) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <InvoiceDetails
      invoice={invoice}
      permissions={permissions}
      onBack={() => navigate(-1)}
      onViewTemplate={() => navigate(`/invoices/${invoice.id}/print`)}
      onInvoiceUpdated={setInvoice}
      onEdit={() => navigate(`/invoices/${invoice.id}/edit`)}
      onViewCustomerAccount={(customerId) => navigate(`/customers?openCustomerId=${customerId}`)}
    />
  );
}

function InvoiceTemplateRoute() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { invoice, error } = useInvoiceFromParam();
  const initialAction = params.get('action');
  const validInitialAction: TemplateInitialAction | undefined =
    initialAction === 'print' || initialAction === 'download' || initialAction === 'whatsapp' ? initialAction : undefined;

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!invoice) return <p className="text-sm text-slate-400">Loading…</p>;

  return <InvoiceTemplateView invoice={invoice} initialAction={validInitialAction} onBack={() => navigate(-1)} />;
}

function CreateInvoiceRoute() {
  const navigate = useNavigate();
  return (
    <CreateInvoiceForm
      onSaved={(invoice) => navigate(`/invoices/${invoice.id}`)}
      onCancel={() => navigate(-1)}
    />
  );
}

function QuickInvoiceRoute() {
  const navigate = useNavigate();
  return (
    <QuickInvoiceForm
      onSaved={(invoice) => {
        // Straight into the printable template — Print/Download
        // PDF/Share via WhatsApp right away, the same component and
        // actions a normal invoice's row buttons use.
        navigate(`/invoices/${invoice.id}/print`);
      }}
      onCancel={() => navigate(-1)}
    />
  );
}

/**
 * invoice.invoiceMode decides the editor — never inferred from item
 * shape here. A 'quick' invoice (manual description/quantity/unit-
 * price items, no category) reopens in QuickInvoiceForm; everything
 * else ('standard') reopens in CreateInvoiceForm exactly as before.
 */
function InvoiceEditRoute() {
  const navigate = useNavigate();
  const { invoice, error } = useInvoiceFromParam();

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!invoice) return <p className="text-sm text-slate-400">Loading…</p>;

  const onSaved = (saved: InvoiceWithItems) => navigate(`/invoices/${saved.id}`);
  const onCancel = () => navigate(`/invoices/${invoice.id}`);

  return invoice.invoiceMode === 'quick' ? (
    <QuickInvoiceForm invoice={invoice} onSaved={onSaved} onCancel={onCancel} />
  ) : (
    <CreateInvoiceForm invoice={invoice} onSaved={onSaved} onCancel={onCancel} />
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
