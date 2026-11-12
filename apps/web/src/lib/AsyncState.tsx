/**
 * UI/UX-04: small shared pieces for the five list/picker states (loading,
 * refreshing, load-failed, truly-empty, no-filter-matches) so every
 * screen doesn't re-invent its own wording and markup. Deliberately not a
 * framework — each screen still owns its own fetch (via useAsyncList) and
 * decides which of these to render and when.
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <p className="text-sm text-slate-400">{label}</p>;
}

/** Shown instead of the list when there is nothing previously loaded to fall back on. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-1.5 font-medium text-red-700 underline hover:text-red-900">
        Retry
      </button>
    </div>
  );
}

/** A non-destructive banner for when a refetch fails but previous rows are still shown. */
export function InlineErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 font-medium underline hover:text-amber-950">
        Retry
      </button>
    </div>
  );
}

/** A quiet indicator that a background refetch is in flight while existing rows stay visible. */
export function UpdatingIndicator({ label = 'Updating…' }: { label?: string }) {
  return (
    <p role="status" className="mb-2 text-xs text-slate-400">
      {label}
    </p>
  );
}

/** A dismissible save-success confirmation — uses the actual created identifier/wording the caller passes, never a bare "Success". */
export function SuccessBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div role="status" className="mb-3 flex items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-green-700 hover:text-green-900">
          ✕
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mt-3 text-sm text-slate-400">
      <p>{message}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="mt-1.5 font-medium text-slate-600 underline hover:text-slate-900">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
