import { Decimal } from 'decimal.js';
import type { Customer, CompanyProfile, InvoiceWithItems } from './entities.js';
import { roundMoney } from './formula-engine/formula-engine.js';
import { calculateSets, formatQuantity } from './invoice-sets.js';

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
  /**
   * The customer's own lot number — null when not set, in which case a
   * template must hide the Lot # row entirely. This is deliberately
   * `Invoice.customerLotNumber`, never `Invoice.lotNumber` (the internal
   * one): the internal lot number is factory/business-internal and must
   * never appear on a customer-facing invoice, and there is no fallback
   * to it here even when this is empty.
   */
  customerLotNumber: string | null;
  /** A second, business-assigned number — null when not set, in which case a template must hide the Bill # row entirely. */
  billNumber: string | null;
  /**
   * The overall suit quantity for the invoice/job as a whole — e.g.
   * "504" — null when not set, in which case a template must hide the
   * Quantity metadata row entirely. Not to be confused with each
   * item's own `quantity` below.
   */
  generalQuantity: string | null;
  /**
   * generalQuantity / SUITS_PER_SET, already formatted for display
   * (see calculateSets) — null exactly when generalQuantity is, so a
   * template can gate both rows on the same presence check if it wants.
   */
  sets: string | null;
  /** Whether a template should render the per-item Quantity column — display-only, see Invoice.showItemQuantity. */
  showItemQuantity: boolean;
  /** Whether a template should render the per-item Unit Amount column — display-only, see Invoice.showUnitAmount. */
  showUnitAmount: boolean;
  items: {
    id: string;
    description: string;
    /** This line's own quantity — each category/line has its own (e.g. BAZU=12, FRONT=8), not one invoice-wide value. Always present even when showItemQuantity is false — hiding it is the template's job, not this shape's. */
    quantity: string;
    /** Null for a manual (Quick Invoice) item — it has no stitch count. */
    stitches: number | null;
    /** Price of a single unit/piece, after the formula calculation — never the internal rate. See unitAmount() below. Always present even when showUnitAmount is false. */
    unitAmount: string;
    amount: string;
  }[];
  /** Sum of the items above, before discount. */
  subtotal: string;
  /** Null when no discount applies — a template should hide the discount row entirely in that case. */
  discountType: 'percentage' | 'fixed' | null;
  discountValue: string;
  /** e.g. "Discount (10%)" or "Discount" — already formatted for display, never re-derived by a template. */
  discountLabel: string;
  discountAmount: string;
  /** subtotal - discountAmount. What the customer actually owes for this invoice. */
  grandTotal: string;
  previousBalance: string;
  amountPaid: string;
  currentBalance: string;
  terms: string | null;
}

/** A category's name is the line's description when no free-text description was given. */
function itemDescription(item: InvoiceWithItems['items'][number]): string {
  return item.description?.trim() || item.categoryName;
}

/**
 * Price of one single unit/piece of this line — what the customer pays
 * for a single piece, distinct from the internal `rate` (a formula
 * input, e.g. per-1000-stitches, never shown on the invoice).
 *
 * `calculatedUnitAmount` is already exactly this: the formula engine's
 * raw per-unit result (see invoice.service.ts's createInvoiceItem),
 * rounded and saved on the item snapshot *before* being multiplied by
 * quantity to produce calculatedTotal — so it's the authoritative
 * value, not a separate calculation path, and it never needs dividing
 * by quantity (`total / quantity` would just reverse a multiplication
 * that already happened, and could disagree with the saved value by a
 * cent on rounding). Falls back to a safe division only for an item
 * that predates this field or otherwise has it missing/invalid — division
 * by zero/blank/non-positive quantity is avoided by falling back to
 * "0.00" rather than throwing or showing Infinity/NaN.
 */
function unitAmount(item: InvoiceWithItems['items'][number]): string {
  try {
    return roundMoney(new Decimal(item.calculatedUnitAmount));
  } catch {
    // Missing/invalid saved value (e.g. a pre-this-field legacy row) —
    // fall back to total / quantity, still guarding division by zero.
    try {
      const qty = new Decimal(item.quantity);
      if (!qty.isFinite() || qty.lessThanOrEqualTo(0)) return '0.00';
      return roundMoney(new Decimal(item.calculatedTotal).dividedBy(qty));
    } catch {
      return '0.00';
    }
  }
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
    customerLotNumber: invoice.customerLotNumber,
    billNumber: invoice.billNumber,
    generalQuantity: formatQuantity(invoice.generalQuantity),
    sets: calculateSets(invoice.generalQuantity),
    showItemQuantity: invoice.showItemQuantity,
    showUnitAmount: invoice.showUnitAmount,
    items: invoice.items.map((item) => ({
      id: item.id,
      description: itemDescription(item),
      quantity: item.quantity,
      stitches: item.stitches,
      unitAmount: unitAmount(item),
      amount: item.calculatedTotal,
    })),
    subtotal: invoice.totalAmount,
    discountType: invoice.discountType,
    discountValue: invoice.discountValue,
    discountLabel: invoice.discountType === 'percentage' ? `Discount (${invoice.discountValue}%)` : 'Discount',
    discountAmount: invoice.discountAmount,
    grandTotal: invoice.grandTotal,
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
