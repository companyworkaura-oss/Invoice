import { useEffect, useState } from 'react';
import * as authApi from '../features/auth/api';

export interface CurrentIdentity {
  userId: string;
  companyId: string;
}

/**
 * UI/UX-03 Part 4/5/9: invoice drafts are scoped to
 * `<userId>:<companyId>:<mode>` (see invoice-draft.ts) so one never
 * leaks into another company or another user's session. App.tsx
 * already fetches `/auth/me` once for the whole shell but only
 * passes `permissions` down to page components — rather than thread
 * the full `Me` object through every layer down to CreateInvoiceForm/
 * QuickInvoiceForm just for `userId`/`companyId`, this fetches it
 * directly. `/auth/me` is cheap (session-cookie lookup, no heavy
 * query) and already called this often elsewhere in the app.
 */
export function useCurrentIdentity(): CurrentIdentity | null {
  const [identity, setIdentity] = useState<CurrentIdentity | null>(null);

  useEffect(() => {
    authApi
      .fetchMe()
      .then((me) => setIdentity({ userId: me.id, companyId: me.company.id }))
      .catch(() => setIdentity(null));
  }, []);

  return identity;
}
