/**
 * Shared entity shapes used across apps/api and apps/web.
 * Business modules (customers, formulas, invoices, ...) add their own
 * types here as those phases are implemented.
 */

/** Money is always a decimal string (e.g. "1234.50"), never a float. */
export type Money = string;

export type Role = 'owner' | 'admin' | 'staff';

/** Minimal company identity, as returned by GET /api/auth/me and GET/POST /api/companies. */
export interface Company {
  id: string;
  name: string;
  defaultCurrency: string;
}

/**
 * Full company profile (Phase 3), returned by GET /api/company. Fields
 * are pre-filled from here onto future invoices.
 */
export interface CompanyProfile extends Company {
  factoryName: string | null;
  ownerName: string | null;
  logoUrl: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  invoicePrefix: string;
  defaultInvoiceTemplate: string;
  invoiceTerms: string | null;
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  company: Company;
}

export type CustomerStatus = 'active' | 'archived';

/** Returned by the customers endpoints (Phase 4). */
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  openingBalance: Money;
  notes: string | null;
  status: CustomerStatus;
  createdAt: string;
}

/**
 * A company-defined embroidery work category (Phase 5): the examples in
 * the product brief (HS/HP, Daman Lace, Motia, ...) are just that —
 * examples. Nothing in the app hard-codes them; every company creates
 * its own. formulaType is a free-form label the application interprets;
 * formulaConfig's shape depends on it. New formula types are added in
 * code, never by changing this type or the database schema.
 */
export interface EmbroideryCategory {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  defaultRate: Money;
  formulaType: string;
  formulaConfig: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

/**
 * A saved invoice line item (Phase 7). Every field below this comment is
 * a snapshot taken when the item was created — category_name, rate,
 * formula_type, formula_config, and the exact calculation inputs used —
 * so it never changes even if the category it came from is later edited,
 * disabled, or its rate changes. calculatedUnitAmount and
 * calculatedTotal are always computed server-side by the formula engine;
 * the frontend never sends or determines these values.
 */
export interface InvoiceItem {
  id: string;
  invoiceId: string;
  categoryId: string | null;
  categoryName: string;
  description: string | null;
  stitches: number;
  rate: Money;
  formulaType: string;
  formulaConfig: Record<string, unknown>;
  calculationInputs: Record<string, unknown>;
  calculatedUnitAmount: Money;
  calculatedTotal: Money;
  createdAt: string;
}

export interface Invoice {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  quantity: string;
  notes: string | null;
  status: InvoiceStatus;
  createdAt: string;
}

/** Returned by GET /api/invoices (list) and as the summary row for GET /api/invoices/:id. */
export interface InvoiceListEntry extends Invoice {
  /** Sum of the items' calculatedTotal — derived on read, never stored. */
  totalAmount: Money;
}

/**
 * The ledger-derived statement for one invoice (Phase 8), generated from
 * ledger_entries on every read and never stored:
 *   previousBalance — customer's balance immediately before this invoice
 *   totalAmount      — this invoice's own total ("Current Invoice Amount")
 *   totalReceivable  — previousBalance + totalAmount
 *   currentBalance    — the customer's live overall balance right now
 *   amountPaid        — totalReceivable - currentBalance
 */
export interface InvoiceLedgerSummary {
  previousBalance: Money;
  totalReceivable: Money;
  amountPaid: Money;
  currentBalance: Money;
}

/** Returned by POST /api/invoices and GET /api/invoices/:id. */
export interface InvoiceWithItems extends Invoice, InvoiceLedgerSummary {
  items: InvoiceItem[];
  totalAmount: Money;
}

export type LedgerEntryType = 'OPENING_BALANCE' | 'INVOICE' | 'PAYMENT' | 'ADJUSTMENT';

/**
 * One row of a customer's ledger (Phase 8). Append-only: entries are
 * never edited or deleted, so a customer's balance — total debit minus
 * total credit — can always be regenerated from this table alone.
 */
export interface LedgerEntry {
  id: string;
  companyId: string;
  customerId: string;
  type: LedgerEntryType;
  referenceId: string | null;
  debit: Money;
  credit: Money;
  date: string;
  notes: string | null;
  createdAt: string;
}

/** Returned by GET /api/customers/:customerId/ledger. */
export interface CustomerLedger {
  customerId: string;
  entries: LedgerEntry[];
  balance: Money;
}

export type PaymentMethod = 'cash' | 'bank' | 'cheque' | 'other';

/**
 * A customer payment (Phase 12). Creating one also posts a PAYMENT
 * ledger credit entry (referenceId = this payment's id) in the same
 * database transaction — see apps/api's payment.service.ts.
 */
export interface Payment {
  id: string;
  companyId: string;
  customerId: string;
  customerName: string;
  amount: Money;
  date: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}
