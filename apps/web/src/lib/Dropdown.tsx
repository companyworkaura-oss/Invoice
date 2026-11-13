import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * UI/UX-06: a small shared open/close-on-outside-click/Escape dropdown
 * shell — used by the header's company switcher and the mobile "More"
 * navigation menu, the two new places this task needs exactly that
 * behavior. (InvoiceList's own row-actions "⋮" menu predates this and
 * is left as its own local implementation — not touched here, since
 * reaching into already-shipped, already-tested UI/UX-04 code for a
 * navigation task is out of scope.)
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

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
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
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
