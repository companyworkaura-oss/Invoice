import { useState } from 'react';

interface Props {
  title: string;
  /** e.g. "Internal lot, customer lot, bill number, gate pass, general quantity" — shown next to the title when collapsed, so a user can tell at a glance whether anything is hiding in here without opening it. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * UI/UX-02: "Job details" and "Print options" both need to be
 * available without competing for the same visual priority as the
 * actual billing workflow (customer, items, totals). Children are
 * always mounted — toggling only switches a CSS class, never
 * conditionally renders — so every field inside keeps the exact same
 * React state/DOM node across any number of collapse/expand cycles;
 * nothing is ever cleared by closing and reopening this.
 */
export function CollapsibleSection({ title, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4 rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
      >
        {/*
          min-w-0 is load-bearing, not decorative: a flex item's
          default min-width is `auto` (its content size), which lets
          this row grow past the button's own width — exactly the
          391-vs-312px horizontal overflow a live mobile-viewport
          check (Playwright, 390px) caught before this fix — and
          without it, `truncate` below never gets a bounded box to
          actually truncate within.
        */}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
          {!open && summary && <span className="min-w-0 truncate text-xs text-slate-400">{summary}</span>}
        </span>
        <span aria-hidden className="shrink-0 text-slate-400">
          {open ? '−' : '+'}
        </span>
      </button>
      <div className={open ? 'border-t border-slate-200 p-3' : 'hidden'}>{children}</div>
    </div>
  );
}
