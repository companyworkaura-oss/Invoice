import type { Customer, CompanyProfile, InvoiceWithItems } from '@invoice/shared';
import { buildInvoiceViewModel, invoicePdfFilename } from '@invoice/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api';
import { downloadPdf } from '../../../lib/downloadPdf';
import * as companyApi from '../../company/api';
import * as customersApi from '../../customers/api';
import * as invoicesApi from '../api';
import { INVOICE_TEMPLATES, getTemplate } from './registry';
import { INVOICE_TEXT_SIZES, TEXT_SIZE_LABEL, TEXT_SIZE_SCALE, type InvoiceTextSize, loadTextSize, saveTextSize } from './textSize';

type InitialAction = 'print' | 'download' | 'whatsapp';

interface Props {
  invoice: InvoiceWithItems;
  onBack: () => void;
  /** Auto-fires the matching action once, right after the template is ready — used by Invoice History's row buttons so they don't need their own copy of this logic. */
  initialAction?: InitialAction;
}

/**
 * Fetches the extra data a printable invoice needs beyond the
 * "operational" InvoiceWithItems (the company profile, the full
 * customer record), builds the restricted view model, and renders
 * whichever template is selected — defaulting to the company's chosen
 * template (Phase 3's defaultInvoiceTemplate), switchable here for a
 * one-off preview without changing that default.
 */
export function InvoiceTemplateView({ invoice, onBack, initialAction }: Props) {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [textSize, setTextSize] = useState<InvoiceTextSize>(() => loadTextSize());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [shareStage, setShareStage] = useState<'idle' | 'preparing-pdf' | 'opening-whatsapp'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  /** Set only when the last share attempt failed specifically at the PDF-generation step — offers "send text only" as the explicit escape hatch the spec calls for, instead of silently degrading. */
  const [offerTextOnlyShare, setOfferTextOnlyShare] = useState(false);
  const firedInitialAction = useRef(false);

  useEffect(() => {
    companyApi.fetchProfile().then((c) => {
      setCompany(c);
      setTemplateId((current) => current ?? c.defaultInvoiceTemplate);
    });
    customersApi.getCustomer(invoice.customerId).then(setCustomer);
  }, [invoice.customerId]);

  const template = getTemplate(templateId);
  const viewModel = company && customer ? buildInvoiceViewModel(invoice, company, customer) : null;
  const filename = customer ? invoicePdfFilename(invoice.invoiceNumber, customer.name) : '';

  function handleTextSizeChange(size: InvoiceTextSize) {
    setTextSize(size);
    saveTextSize(size);
  }

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
      await downloadPdf(invoicesApi.invoicePdfUrl(invoice.id, template.id), filename);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.body.error : 'Could not generate the PDF');
    } finally {
      setDownloading(false);
    }
  }

  /**
   * A wa.me link can prefill the recipient and message text, but it can
   * never attach a local/generated PDF — that's a hard platform
   * limitation, not something to paper over. So by default this
   * downloads the invoice PDF first (same mechanism as the Download PDF
   * button), *then* opens WhatsApp to the exact customer with the
   * message prefilled, and tells the user to attach the file they just
   * downloaded. `textOnly` is the explicit opt-out the spec calls for:
   * only set when the user has already seen a PDF-generation failure
   * and chose to share the text anyway.
   *
   * If the server is configured with WhatsApp Business Cloud API
   * credentials (see apps/api's lib/whatsapp), it may have already sent
   * the PDF as a real document message server-side — share.status
   * 'sent' means that succeeded and there's nothing left to do here;
   * 'failed' (or the default click-to-chat mode) falls through to the
   * same download-then-open flow, using share.url as the manual
   * fallback either way.
   */
  async function handleShare(textOnly = false) {
    setShareError(null);
    setShareNotice(null);
    setOfferTextOnlyShare(false);
    setShareStage('preparing-pdf');
    try {
      // Server normalizes/validates the customer's WhatsApp number and
      // builds the message from the invoice's own ledger-derived stats
      // — see apps/api's whatsapp-share.service.ts. A missing/invalid
      // number throws here, before anything opens.
      const share = await invoicesApi.getWhatsAppShare(invoice.id);

      if (share.mode === 'business-api' && share.status === 'sent') {
        setShareNotice('Invoice sent via WhatsApp.');
        return;
      }

      if (!textOnly) {
        try {
          await downloadPdf(invoicesApi.invoicePdfUrl(invoice.id, template.id), filename);
        } catch (err) {
          setShareError(err instanceof ApiError ? err.body.error : 'Could not generate the PDF');
          setOfferTextOnlyShare(true);
          return; // never open WhatsApp on a failed PDF unless the user explicitly asks for text-only
        }
      }

      setShareStage('opening-whatsapp');
      window.open(share.url, '_blank', 'noopener,noreferrer');
      setShareNotice(
        textOnly
          ? 'WhatsApp opened with the invoice message. Attach the invoice PDF manually if needed.'
          : 'Invoice PDF has been downloaded. Attach the downloaded PDF in WhatsApp before sending.',
      );
      if (share.mode === 'business-api' && share.status === 'failed') {
        setShareError(share.error ?? 'Automatic WhatsApp sending failed — opened a manual chat instead.');
      }
    } catch (err) {
      setShareError(
        err instanceof ApiError ? (err.body.details?.whatsapp ?? err.body.error) : 'Could not build the WhatsApp share link',
      );
    } finally {
      setShareStage('idle');
    }
  }

  useEffect(() => {
    if (!company || !customer || !initialAction || firedInitialAction.current) return;
    firedInitialAction.current = true;
    // Deferred to a microtask so the action's own setState calls
    // (downloading/sharing) aren't triggered synchronously from within
    // this effect. handlePrint/handleDownload/handleShare close over
    // state declared above and are redefined every render, so they're
    // deliberately left out of the dependency array — the
    // firedInitialAction guard is what keeps this to firing once.
    queueMicrotask(() => {
      if (initialAction === 'print') handlePrint();
      else if (initialAction === 'download') void handleDownload();
      else if (initialAction === 'whatsapp') void handleShare();
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [company, customer, initialAction]);

  if (!company || !customer || !viewModel) {
    return <p className="text-sm text-slate-400">Loading…</p>;
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
          <div className="flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Text size">
            {INVOICE_TEXT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => handleTextSizeChange(size)}
                aria-pressed={textSize === size}
                className={`px-2 py-1 text-sm ${
                  textSize === size ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {TEXT_SIZE_LABEL[size]}
              </button>
            ))}
          </div>
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
            onClick={() => handleShare()}
            disabled={shareStage !== 'idle'}
            className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {shareStage === 'preparing-pdf'
              ? 'Preparing PDF…'
              : shareStage === 'opening-whatsapp'
                ? 'Opening WhatsApp…'
                : 'Share via WhatsApp'}
          </button>
        </div>
      </div>
      {downloadError && <p className="mt-1 text-sm text-red-600 print:hidden">{downloadError}</p>}
      {shareError && (
        <p className="mt-1 text-sm text-red-600 print:hidden">
          {shareError}
          {offerTextOnlyShare && (
            <>
              {' '}
              <button type="button" onClick={() => handleShare(true)} className="underline hover:text-red-800">
                Send text only (without PDF)
              </button>
            </>
          )}
        </p>
      )}
      {shareNotice && <p className="mt-1 text-sm text-green-700 print:hidden">{shareNotice}</p>}

      {/*
        The gray surround is the on-screen "print preview" frame; the
        A5-sized (148mm) white page inside it is what actually prints
        from here (window.print(), via the print-page-invoice/
        invoice-a5 rules in index.css — the Download PDF button is a
        separate, A4 server-rendered document and unaffected by either
        this page size or the text-size control above). The preview
        frame is deliberately wider than the dashboard card
        that contains it, so on screen it breaks out to the viewport
        edges (the relative/left-1/2/-mx-[50vw] trick below) rather than
        forcing a horizontal scrollbar inside a narrow card — a "preview"
        that requires scrolling to see the whole page isn't much of one.
        None of that breakout applies when actually printing: print:static
        resets it back to normal document flow for the real page.
      */}
      <div className="relative left-1/2 right-1/2 -mx-[50vw] mt-4 w-screen overflow-x-auto bg-slate-200 px-6 py-6 print:static print:left-auto print:right-auto print:m-0 print:w-auto print:overflow-visible print:bg-white print:p-0">
        <div className="mx-auto w-fit" style={{ '--inv-scale': TEXT_SIZE_SCALE[textSize] } as React.CSSProperties}>
          <template.Component invoice={viewModel} compact={textSize === 'large'} />
        </div>
      </div>
    </div>
  );
}
