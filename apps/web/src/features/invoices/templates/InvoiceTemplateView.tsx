import type { Customer, CompanyProfile, InvoiceWithItems } from '@invoice/shared';
import { useEffect, useState } from 'react';
import * as companyApi from '../../company/api';
import * as customersApi from '../../customers/api';
import { INVOICE_TEMPLATES, getTemplate } from './registry';
import { buildInvoiceViewModel } from './types';

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
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Print
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-md bg-slate-100 p-4 print:m-0 print:bg-white print:p-0">
        <template.Component invoice={viewModel} />
      </div>
    </div>
  );
}
