import { ClassicNavyTemplate } from './ClassicNavyTemplate';
import { IndustrialBlueTemplate } from './IndustrialBlueTemplate';
import { MinimalCleanTemplate } from './MinimalCleanTemplate';
import { ModernCurveTemplate } from './ModernCurveTemplate';
import { PremiumModernTemplate } from './PremiumModernTemplate';
import type { InvoiceViewModel } from './types';

export interface InvoiceTemplate {
  id: string;
  label: string;
  Component: (props: { invoice: InvoiceViewModel }) => React.JSX.Element;
}

/**
 * The full set of invoice designs. Every template renders the same
 * InvoiceViewModel (see types.ts) — adding a new one is one new
 * component file plus one entry here; nothing about how an invoice is
 * created, calculated, or saved (apps/api) ever needs to change.
 *
 * A company's chosen id (companies.default_invoice_template) is stored
 * as a plain string, not a database enum, so a template can be added or
 * retired without a migration.
 */
export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  { id: 'classic-navy', label: 'Classic Navy', Component: ClassicNavyTemplate },
  { id: 'modern-curve', label: 'Modern Curve', Component: ModernCurveTemplate },
  { id: 'minimal-clean', label: 'Minimal Clean', Component: MinimalCleanTemplate },
  { id: 'industrial-blue', label: 'Industrial Blue', Component: IndustrialBlueTemplate },
  { id: 'premium-modern', label: 'Premium Modern', Component: PremiumModernTemplate },
];

const DEFAULT_TEMPLATE_ID = INVOICE_TEMPLATES[0].id;

export function getTemplate(id: string | null | undefined): InvoiceTemplate {
  return INVOICE_TEMPLATES.find((t) => t.id === id) ?? INVOICE_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
}
