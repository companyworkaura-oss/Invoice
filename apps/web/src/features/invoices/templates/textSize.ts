/**
 * Print/preview text size (A5 print feature) — presentation only. This
 * never touches invoice data: it just scales the font-size of the
 * already-rendered InvoiceViewModel via a single CSS custom property
 * (--inv-scale, set once on a wrapper in InvoiceTemplateView) that each
 * template's text-size utility classes read from. Nothing here is sent
 * to the server, and it has no effect on the PDF (apps/api renders that
 * from its own separate HTML layout, not these React templates).
 */
export type InvoiceTextSize = 'small' | 'medium' | 'large';

export const TEXT_SIZE_SCALE: Record<InvoiceTextSize, number> = {
  small: 0.85,
  medium: 1,
  large: 1.15,
};

export const TEXT_SIZE_LABEL: Record<InvoiceTextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export const INVOICE_TEXT_SIZES: InvoiceTextSize[] = ['small', 'medium', 'large'];

const STORAGE_KEY = 'invoiceTextSize';

function isTextSize(value: unknown): value is InvoiceTextSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

/** Falls back to 'medium' (the default) whenever storage is unavailable, empty, or holds something unexpected. */
export function loadTextSize(): InvoiceTextSize {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTextSize(saved)) return saved;
  } catch {
    // Private browsing / storage disabled — just use the default.
  }
  return 'medium';
}

export function saveTextSize(size: InvoiceTextSize): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Nothing to do if storage isn't available — the selection still
    // works for the rest of this session via React state.
  }
}
