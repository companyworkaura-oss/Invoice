import { useEffect } from 'react';

/** Pulled out as a pure function so the title format itself is unit-testable without a DOM. */
export function formatDocumentTitle(title: string): string {
  return title ? `${title} — Embroidery Billing` : 'Embroidery Billing';
}

/**
 * UI/UX-09 Part 12: updates the browser tab/document title per route —
 * "Invoices — Embroidery Billing", "INV-001 — Embroidery Billing",
 * etc. — so the title bar, browser history, and screen-reader route
 * announcements all reflect where the user actually is. Deliberately
 * minimal: no SEO meta tags, no title-stack/history management beyond
 * this one `document.title` assignment.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = formatDocumentTitle(title);
  }, [title]);
}
