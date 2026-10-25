import type * as companyApi from './api';

export type FormState = Record<string, string>;

/**
 * F08: only a field the user actually changed from `original` belongs
 * in the patch at all — an untouched field (blank or not) must be
 * omitted so the server leaves it alone, never sent as an empty string
 * (which the old code's "only send non-blank fields" rule conflated
 * with "untouched", making it impossible to ever clear a field — see
 * company.service.ts's updateCompany for the matching backend fix). A
 * changed field that's now blank is sent as `null`, the explicit
 * "clear this" signal; a changed, non-blank field is sent as-is.
 */
export function buildProfilePatch(form: FormState, original: FormState): companyApi.ProfilePatch {
  const patch: companyApi.ProfilePatch = {};
  for (const [key, value] of Object.entries(form)) {
    if (value === (original[key] ?? '')) continue;
    patch[key as keyof companyApi.ProfilePatch] = (value.trim() === '' ? null : value) as never;
  }
  return patch;
}
