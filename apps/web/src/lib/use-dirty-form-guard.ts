import { useEffect } from 'react';

/**
 * UI/UX-03 Part 7: warns before a user loses unsaved work — a plain
 * `beforeunload` listener for refresh/close (the one case the browser
 * itself can block), plus a `popstate` interception for the Back
 * button, and a `confirmLeaveIfDirty()` escape hatch the caller uses
 * before its own in-app navigation (a Cancel button, switching to
 * another screen). Both only ever activate while `isDirty` is true —
 * an untouched form, or one just saved/discarded (the caller sets
 * `isDirty` back to false first), never prompts anything.
 *
 * Browser Back: while dirty, pushes one extra history entry so the
 * first Back press fires a `popstate` this hook can intercept with a
 * confirm dialog instead of immediately leaving; declining re-pushes
 * the same guard entry so the next Back press is caught again too.
 * Known, accepted limitation (a best-effort UX safety net, not a
 * strict guarantee): if the form becomes clean by a route other than
 * this hook popping its own guard entry (e.g. a successful save
 * navigates away without ever pressing Back), that one extra history
 * entry is left behind, so a *subsequent* Back press from the next
 * screen may need pressing twice. Keeping this simple (no history
 * bookkeeping beyond "push one entry, re-push on cancel") was a
 * deliberate choice over a more defensive/stateful implementation,
 * matching this task's own "do not make this fragile" guidance.
 */
export function useDirtyFormGuard(isDirty: boolean, message: string): { confirmLeaveIfDirty: () => boolean } {
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    window.history.pushState({ dirtyFormGuard: true }, '');
    function handlePopState() {
      if (!window.confirm(message)) {
        window.history.pushState({ dirtyFormGuard: true }, '');
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  function confirmLeaveIfDirty(): boolean {
    return !isDirty || window.confirm(message);
  }

  return { confirmLeaveIfDirty };
}
