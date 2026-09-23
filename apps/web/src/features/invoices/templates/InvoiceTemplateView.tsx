import type { Customer, CompanyProfile, InvoiceWithItems } from '@invoice/shared';
import { buildInvoiceViewModel, invoicePdfFilename } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api';
import * as companyApi from '../../company/api';
import * as customersApi from '../../customers/api';
import * as invoicesApi from '../api';
import { INVOICE_TEMPLATES, getTemplate } from './registry';

interface Props {
  invoice: InvoiceWithItems;
  onBack: () => void;
}

/**
 * Fetches the extra data a printable invoice needs beyond the
 * "operational" InvoiceWithItems (the company profile, the full
 * customer record), builds the restricted view model, and renders
 * whichever template is selected — defaulting to the company's chosen
 * template (Phase 3's defaultInvoiceTemplate), switchable here for a
 * one-off preview without changing that default.
 */
export function InvoiceTemplateView({ invoice, onBack }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    companyApi.fetchProfile().then((c) => {
      setCompany(c);
      setTemplateId((current) => current ?? c.defaultInvoiceTemplate);
    });
    customersApi.getCustomer(invoice.customerId).then(setCustomer);
  }, [invoice.customerId]);

  if (!company || !customer) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  const template = getTemplate(templateId);
  const viewModel = buildInvoiceViewModel(invoice, company, customer);
  const filename = invoicePdfFilename(invoice.invoiceNumber, customer.name);

  function handlePrint() {
    // Chrome/Edge suggest document.title as the default filename when
    // someone picks "Save as PDF" from the print dialog — so the same
    // {invoice_number}-{customer_name} convention applies whether they
    // use this or the dedicated Download button below.
    const previousTitle = document.title;
    document.title = filename.replace(/\.pdf$/, '');
    window.print();
    document.title = previousTitle;
  }

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      // Rendered server-side from this invoice's own saved snapshots —
      // see apps/api's pdf.service.ts — never from live category data.
      const blob = await invoicesApi.fetchInvoicePdf(invoice.id, template.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.body.error : 'Could not generate the PDF');
    } finally {
      setDownloading(false);
    }
  }

  async function handleShare() {
    setShareError(null);
    setSharing(true);
    try {
      // Server builds the message from the invoice's own ledger-derived
      // stats and the customer's saved WhatsApp number, then hands back
      // a wa.me link — see apps/api's whatsapp-share.service.ts.
      const share = await invoicesApi.getWhatsAppShare(invoice.id);
      window.open(share.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setShareError(
        err instanceof ApiError ? (err.body.details?.whatsapp ?? err.body.error) : 'Could not build the WhatsApp share link',
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline">
          Back
        </button>
        <div className="flex items-center gap-2">
          <select
            value={template.id}
            onChange={(e) => setTemplateId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {INVOICE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Print
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {sharing ? 'Preparing…' : 'Share via WhatsApp'}
          </button>
        </div>
      </div>
      {downloadError && <p className="mt-1 text-sm text-red-600 print:hidden">{downloadError}</p>}
      {shareError && <p className="mt-1 text-sm text-red-600 print:hidden">{shareError}</p>}

      {/*
        The gray surround is the on-screen "print preview" frame; the
        A4-sized (210mm) white page inside it is what actually prints or
        gets exported. It's deliberately wider than the dashboard card
        that contains it, so on screen it breaks out to the viewport
        edges (the relative/left-1/2/-mx-[50vw] trick below) rather than
        forcing a horizontal scrollbar inside a narrow card — a "preview"
        that requires scrolling to see the whole page isn't much of one.
        None of that breakout applies when actually printing: print:static
        resets it back to normal document flow for the real page.
      */}
      <div className="relative left-1/2 right-1/2 -mx-[50vw] mt-4 w-screen overflow-x-auto bg-slate-200 px-6 py-6 print:static print:left-auto print:right-auto print:m-0 print:w-auto print:overflow-visible print:bg-white print:p-0">
        <div className="mx-auto w-fit">
          <template.Component invoice={viewModel} />
        </div>
      </div>
    </div>
  );
}
