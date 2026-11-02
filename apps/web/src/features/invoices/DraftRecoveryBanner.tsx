/**
 * UI/UX-03 Part 6: shown once, only when a saved draft actually
 * exists for this exact user/company/mode — never silently applied
 * (that would risk overwriting whatever the user had just started
 * typing before this banner even finished checking) and never
 * silently discarded either.
 */
export function DraftRecoveryBanner({
  savedAt,
  onResume,
  onDiscard,
}: {
  savedAt: string;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const savedAtLabel = new Date(savedAt).toLocaleString();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      <span className="text-amber-800">
        <span className="font-medium">Unsaved invoice found</span> — saved {savedAtLabel}.
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={onResume}
          className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Resume draft
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-100"
        >
          Discard draft
        </button>
      </span>
    </div>
  );
}
