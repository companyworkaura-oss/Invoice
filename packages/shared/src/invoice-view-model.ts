import type { Customer, CompanyProfile, InvoiceWithItems } from './entities.js';

/**
 * Exactly what a printable invoice is allowed to show — deliberately a
 * narrower shape than InvoiceWithItems. There is no formula, factor,
 * formulaType, formulaConfig, calculationInputs, or per-item rate field
 * here: a template component physically cannot render what this object
 * doesn't carry, so "don't show calculation internals (including the
 * internal embroidery rate) on the customer invoice" is enforced by the
 * data shape, not just by convention in each template's JSX. The rate
 * is still saved on the invoice item snapshot and used server-side to
 * calculate `amount` — it's simply not carried into this view.
 */
export interface InvoiceViewModel {
  company: {
    name: string;
    factoryName: string | null;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    taxNumber: string | null;
  };
  customer: {
    name: string;
    businessName: string | null;
    address: string | null;
    phone: string | null;
  };
  invoiceNumber: string;
  invoiceDate: string;
  quantity: string;
  items: {
    id: string;
    description: string;
    stitches: number;
    amount: string;
  }[];
  currentBill: string;
  previousBalance: string;
  amountPaid: string;
  currentBalance: string;
  terms: string | null;
}

/** A category's name is the line's description when no free-text description was given. */
function itemDescription(item: InvoiceWithItems['items'][number]): string {
  return item.description?.trim() || item.categoryName;
}

export function buildInvoiceViewModel(
  invoice: InvoiceWithItems,
  company: CompanyProfile,
  customer: Customer,
): InvoiceViewModel {
  return {
    company: {
      name: company.name,
      factoryName: company.factoryName,
      logoUrl: company.logoUrl,
      address: company.address,
      phone: company.phone,
      whatsapp: company.whatsapp,
      email: company.email,
      taxNumber: company.taxNumber,
    },
    customer: {
      name: customer.name,
      businessName: customer.businessName,
      address: customer.address,
      phone: customer.phone,
    },
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    quantity: invoice.quantity,
    items: invoice.items.map((item) => ({
      id: item.id,
      description: itemDescription(item),
      stitches: item.stitches,
      amount: item.calculatedTotal,
    })),
    currentBill: invoice.totalAmount,
    previousBalance: invoice.previousBalance,
    amountPaid: invoice.amountPaid,
    currentBalance: invoice.currentBalance,
    terms: company.invoiceTerms,
  };
}

/**
 * The {invoice_number}-{customer_name}.pdf convention, with both parts
 * made filesystem-safe. Shared so the browser (naming a downloaded
 * blob) and the server (the PDF endpoint's Content-Disposition header)
 * never disagree on the filename.
 */
export function invoicePdfFilename(invoiceNumber: string, customerName: string): string {
  const safe = (value: string) =>
    value
      .trim()
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .replace(/\s+/g, '-') || 'invoice';
  return `${safe(invoiceNumber)}-${safe(customerName)}.pdf`;
}
