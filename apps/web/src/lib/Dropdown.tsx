import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * UI/UX-06/09: a small shared open/close-on-outside-click/Escape
 * dropdown shell — used by the header's company switcher and the
 * mobile "More" nav menu. UI/UX-09 Parts 5/6/10 added: Escape and any
 * item-selection close both return focus to the trigger button
 * (safe to do synchronously — the trigger itself is always rendered,
 * never removed, so focusing it doesn't depend on waiting for a
 * re-render to finish); the trigger's own `aria-expanded` is already
 * threaded through by every caller via the `open` argument `trigger`
 * receives. (InvoiceList's own row-actions "⋮" menu predates this and
 * now follows the same Escape/focus-return contract, implemented
 * locally there rather than switched to this shared shell, to avoid
 * touching its own already-shipped, already-tested UI/UX-04 markup
 * more than necessary.)
 */
export function Dropdown({
  trigger,
  children,
  align = 'left',
  className = '',
  panelClassName = '',
}: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function closeAndRefocusTrigger() {
    setOpen(false);
    // The trigger is always rendered (never conditionally), so it's
    // safe to focus it right away rather than waiting for the panel
    // to actually unmount on the next render.
    containerRef.current?.querySelector<HTMLElement>('button, a[href], [tabindex]')?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      // An outside click already moves focus wherever the user
      // clicked — only close, don't fight that by also refocusing
      // the trigger.
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAndRefocusTrigger();
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className={`absolute z-20 mt-1 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-md ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${panelClassName}`}
        >
          {children(closeAndRefocusTrigger)}
        </div>
      )}
    </div>
  );
}
