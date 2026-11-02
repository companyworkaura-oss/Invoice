import { useEffect } from 'react';

/**
 * UI/UX-03 Part 3: a simple, reliable scroll-position restore for one
 * named list (e.g. the invoice list) — not a general-purpose history-
 * wide scroll manager, which the task explicitly warns against making
 * fragile. `key` should be stable for "the same list in the same
 * filtered state" (callers pass the filter query string itself as
 * part of the key, so scrolling down a search result and returning to
 * a *different* search doesn't restore the wrong position) and change
 * whenever that state changes.
 *
 * Saves on every scroll (throttled via `requestAnimationFrame`, not a
 * timer) and restores once on mount — sessionStorage, so it survives a
 * refresh but never leaks across browser sessions or between devices.
 */
export function useScrollRestoration(key: string): void {
  useEffect(() => {
    const storageKey = `scroll-position:${key}`;
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const y = Number(saved);
      if (Number.isFinite(y)) window.scrollTo(0, y);
    }

    let frame: number | null = null;
    function handleScroll() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        try {
          sessionStorage.setItem(storageKey, String(window.scrollY));
        } catch {
          // Non-fatal — scroll restoration is a convenience, not a guarantee.
        }
      });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [key]);
}
