/**
 * F08/F12: shared by every edit form that PATCHes a partial-update
 * endpoint with nullable optional fields (company profile, customer)
 * — only a field the user actually changed from `original` belongs in
 * the patch at all. An untouched field (blank or not) must be omitted
 * so the server leaves it alone, never sent as an empty string (which
 * would otherwise conflate "untouched" with "clear this", making it
 * impossible to ever actually clear a field — see the matching
 * backend fix, e.g. customer.service.ts's updateCustomer). A changed
 * field that's now blank is sent as `null`, the explicit "clear this"
 * signal; a changed, non-blank field is sent as-is.
 */
export type FormPatchState = Record<string, string>;

export function buildFormPatch<T>(form: FormPatchState, original: FormPatchState): Partial<T> {
  const patch: Partial<T> = {};
  for (const [key, value] of Object.entries(form)) {
    if (value === (original[key] ?? '')) continue;
    (patch as Record<string, unknown>)[key] = value.trim() === '' ? null : value;
  }
  return patch;
}
