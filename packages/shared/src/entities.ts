/**
 * Shared entity shapes used across apps/api and apps/web.
 * Business modules (customers, formulas, invoices, ...) add their own
 * types here as those phases are implemented.
 */
import type { Permission } from './permissions.js';

/** Money is always a decimal string (e.g. "1234.50"), never a float. */
export type Money = string;

export type Role = 'owner' | 'admin' | 'staff';

export type CompanyStatus = 'active' | 'deactivated';

/** Minimal company identity, as returned by GET /api/auth/me and GET/POST /api/companies. */
export interface Company {
  id: string;
  name: string;
  defaultCurrency: string;
}

/** Only GET/POST /api/companies (the cross-company list/switch endpoints) carries this — a single active tenant (GET /api/auth/me, GET /api/company) is always 'active' by construction, since requireAuth never resolves a session pointing at a deactivated company. */
export interface CompanyWithStatus extends Company {
  status: CompanyStatus;
  deactivatedAt: string | null;
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
  /** This role's permission set (Phase 17) — see @invoice/shared's permissions.ts. Server-computed; the frontend never derives this from `role` itself. */
  permissions: Permission[];
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
 * Which editor an invoice reopens in — 'standard' for a category/
 * formula invoice (CreateInvoiceForm shows Category/Stitches/Avg
 * Stitch/formula controls), 'quick' for a manual description/quantity
 * /unit-price invoice (QuickInvoiceForm shows none of those). Always
 * derived server-side from the items actually saved, never
 * client-supplied — see apps/api's invoice.service.ts invoiceModeFromItems.
 */
export type InvoiceMode = 'standard' | 'quick';

/** Percentage of the subtotal, or a fixed money amount — see Invoice.discountType. */
export type DiscountType = 'percentage' | 'fixed';

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
  /** Null for a manual (Quick Invoice) item — it has no category or stitch count, see unitPrice-driven calculatedUnitAmount/calculatedTotal instead. */
  stitches: number | null;
  /** This item's own quantity — each category/line has its own (e.g. BAZU=12, FRONT=8), never one invoice-wide value. */
  quantity: string;
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
  notes: string | null;
  status: InvoiceStatus;
  createdAt: string;
  /** Which editor this invoice reopens in — see InvoiceMode. Always server-derived, never client-supplied. */
  invoiceMode: InvoiceMode;
  /**
   * Internal lot/batch/job identifier, e.g. "LOT-001" — free text, not
   * required to be unique. Factory/business-internal only; never shown
   * on customer-facing print/PDF/WhatsApp — see InvoiceViewModel, which
   * deliberately does not carry this field (customerLotNumber below is
   * the one that does).
   */
  lotNumber: string | null;
  /**
   * The lot number as provided by the customer — independent of the
   * internal lotNumber above. This is the only one of the two shown on
   * customer-facing print/PDF/WhatsApp; the Lot # row is hidden there
   * entirely when this is null, never falling back to lotNumber.
   */
  customerLotNumber: string | null;
  /** A second, business-assigned number — separate from invoiceNumber — shown on customer-facing print/PDF/WhatsApp. */
  billNumber: string | null;
  /** The gate pass number that came with the client's material — manual, free text — shown on customer-facing print/PDF/WhatsApp. */
  gatePassNumber: string | null;
  /**
   * The overall suit quantity for this invoice/job as a whole — e.g.
   * "504" — distinct from each item's own quantity (InvoiceItem.quantity)
   * and never used in any calculation; pure job/invoice metadata.
   * Number of Sets is always derived from this (see @invoice/shared's
   * calculateSets), never stored.
   */
  generalQuantity: string | null;
  /** Display-only: whether the customer-facing Unit Amount column is shown. Saved per invoice so an old invoice always prints the same way, regardless of any later global UI default change. */
  showUnitAmount: boolean;
  /** Display-only: whether the customer-facing per-item Quantity column is shown. Saved per invoice so an old invoice always prints the same way, regardless of any later global UI default change. */
  showItemQuantity: boolean;
  /**
   * Invoice-level discount (never per-item). `discountType` null means no
   * discount at all — `discountValue`/`discountAmount` are then always
   * "0.00", not just unused. `discountAmount` is the server-calculated
   * snapshot (percentage of the subtotal, or the fixed amount itself,
   * clamped so it can never exceed the subtotal) — see
   * apps/api's invoice.service.ts calculateDiscount. It's recalculated
   * whenever the invoice's items change (create, or a draft edit), never
   * on a plain read.
   */
  discountType: DiscountType | null;
  discountValue: Money;
  discountAmount: Money;
  /**
   * Visibility only, not an accounting reversal (Phase 21): archiving an
   * invoice hides it from the default list but never touches its ledger
   * entries, items, or payments — archived_at is a plain nullable
   * timestamp on `invoices`, deliberately not folded into `status`, so
   * "is this invoice archived" never has to be reverse-engineered from
   * the workflow status enum.
   */
  archivedAt: string | null;
}

/** The GET /api/invoices `?archived=` filter — defaults to 'active' when omitted. */
export type InvoiceArchivedFilter = 'active' | 'archived' | 'all';

/**
 * A per-invoice payment status (Phase 15), distinct from the invoice's
 * own workflow `status` (draft/issued/cancelled). Computed by applying
 * a customer's payments/credits FIFO against their oldest debt first —
 * see apps/api's invoice.service.ts `listInvoices` for the query.
 */
export type InvoicePaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED';

/** Returned by GET /api/invoices (list) and as the summary row for GET /api/invoices/:id. */
export interface InvoiceListEntry extends Invoice {
  /** Sum of the items' calculatedTotal — derived on read, never stored. This is the pre-discount subtotal. */
  totalAmount: Money;
  /** totalAmount - discountAmount — derived on read, never stored. What the customer actually owes for this invoice, and what the ledger debit equals. */
  grandTotal: Money;
  /** This invoice's own FIFO-allocated paid amount (Phase 15), allocated against grandTotal. */
  paid: Money;
  /** grandTotal - paid. */
  balance: Money;
  paymentStatus: InvoicePaymentStatus;
}

/**
 * The ledger-derived statement for one invoice (Phase 8), generated from
 * ledger_entries on every read and never stored:
 *   previousBalance — customer's balance immediately before this invoice
 *   totalReceivable  — previousBalance + this invoice's grandTotal
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
  /** Pre-discount subtotal — sum of items' calculatedTotal. */
  totalAmount: Money;
  /** totalAmount - discountAmount. What the ledger debit equals. */
  grandTotal: Money;
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

/**
 * One row of a customer statement (Phase 16). Unlike a raw LedgerEntry,
 * this carries a human-readable `reference` (invoice number / payment
 * reference / "Opening Balance" / "Adjustment") and its running balance
 * as of this transaction — both derived on read from the ledger, never
 * stored. See apps/api's statement.service.ts for exactly how
 * `runningBalance` is ordered and computed.
 */
export interface StatementEntry {
  id: string;
  date: string;
  type: LedgerEntryType;
  reference: string | null;
  description: string | null;
  debit: Money;
  credit: Money;
  runningBalance: Money;
}

/**
 * Returned by GET /api/customers/:customerId/ledger/statement. Summary
 * figures (openingBalance/invoiceTotal/payments/closingBalance) reflect
 * the selected date range only — never narrowed by the `type` filter,
 * which only changes which rows appear in `entries`.
 */
export interface CustomerStatement {
  customerId: string;
  customerName: string;
  from: string | null;
  to: string | null;
  openingBalance: Money;
  invoiceTotal: Money;
  payments: Money;
  closingBalance: Money;
  entries: StatementEntry[];
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

/** Dashboard (Phase 14) — GET /api/dashboard?range=... */
export type DashboardRange = 'today' | 'month' | 'custom';

export interface DashboardPeriod {
  range: DashboardRange;
  from: string;
  to: string;
}

/**
 * invoiceAmount/paymentsReceived are scoped to `period`; totalReceivable
 * and unpaidOrPartialInvoiceCount are current-state (not period-bound) —
 * "how much is owed right now", not "how much became owed in this range".
 */
export interface DashboardCards {
  invoiceAmount: Money;
  paymentsReceived: Money;
  totalReceivable: Money;
  unpaidOrPartialInvoiceCount: number;
}

export interface DashboardRecentInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  totalAmount: Money;
  status: InvoiceStatus;
}

export interface DashboardRecentPayment {
  id: string;
  customerName: string;
  amount: Money;
  date: string;
  paymentMethod: PaymentMethod;
}

export interface DashboardOutstandingCustomer {
  id: string;
  name: string;
  balance: Money;
}

export interface DashboardSummary {
  period: DashboardPeriod;
  cards: DashboardCards;
  recentInvoices: DashboardRecentInvoice[];
  recentPayments: DashboardRecentPayment[];
  customersWithOutstandingBalance: DashboardOutstandingCustomer[];
}
